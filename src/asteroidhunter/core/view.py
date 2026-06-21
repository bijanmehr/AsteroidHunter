"""Two readouts of the world, sharing one geometry pass:

* ``pack_render`` -> a flat float buffer the browser draws (Python simulates,
  JS draws; everything crossing is plain data).
* ``obs_vector``  -> the RL observation (fixed-size, every field in [-1, 1]).

Render buffer layout::

    [ score, game_over, wave, lives,  then 6 floats per entity: ]
    [ kind, x, y, angle, radius, flags ]

    kind: 0 ship | 2 bullet | 3 asteroid-L | 4 asteroid-M | 5 asteroid-S | 6 UFO
    flags: ship -> bit0 thrusting, bit1 invuln ; asteroid -> silhouette index
    n_entities = (len(buf) - 4) / 6
"""
from __future__ import annotations

import math

from .. import config as C
from .physics import COS, SIN, heading_rad, torus_delta

HEADER = 4
STRIDE = 6


# --- render ----------------------------------------------------------------
def pack_render(core):
    s0 = core.ships[0] if core.ships else None
    buf = [
        float(core.score[0]),
        1.0 if core.game_over else 0.0,
        float(core.wave),
        float(max(0, s0.lives)) if s0 else 0.0,
    ]
    for ship in core.ships:
        if ship.dead:
            continue
        flags = (1 if ship.thrusting else 0) | (2 if ship.invuln > 0 else 0)
        buf += [0.0, ship.x, ship.y, heading_rad(ship.hdg), C.SHIP_DRAW, float(flags)]
    for b in core.bullets:
        buf += [2.0, b.x, b.y, 0.0, C.SHIP_LEN * 0.13, 0.0]
    for a in core.asteroids:
        kind = 3.0 + (2 - a.size)  # large->3, medium->4, small->5
        buf += [kind, a.x, a.y, a.spin, a.radius, float(a.shape)]
    return buf


# --- observation -----------------------------------------------------------
def _clip(v):
    return -1.0 if v < -1.0 else (1.0 if v > 1.0 else v)


def _clip01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def _rel(ship, obj, size, w, h):
    dx = torus_delta(ship.x, obj.x, w)
    dy = torus_delta(ship.y, obj.y, h)
    dist = math.hypot(dx, dy)
    rvx = obj.vx - ship.vx
    rvy = obj.vy - ship.vy
    closing = -(dx * rvx + dy * rvy) / dist if dist > 1e-9 else 0.0
    return (dx, dy, dist, closing, rvx, rvy, size)


def _threat_key(r):
    closing, dist = r[3], r[2]
    if closing > 1e-6:
        return (0, dist / closing)
    return (1, dist)


def _emit(out, recs, k, has_size, d_half):
    for s in range(k):
        if s < len(recs):
            dx, dy, dist, closing, rvx, rvy, size = recs[s]
            out.append(1.0)
            out.append(_clip(dx / d_half))
            out.append(_clip(dy / d_half))
            out.append(_clip(dist / d_half) * 2.0 - 1.0)
            out.append(_clip(closing / C.V_NORM))
            out.append(_clip(rvx / C.V_NORM))
            out.append(_clip(rvy / C.V_NORM))
            if has_size:
                out.append((size or 0) / 2.0)
        else:
            out.extend([0.0] * (8 if has_size else 7))


def _fire_cooldown(core, i):
    owned = [b.life for b in core.bullets if b.owner == i]
    if len(owned) < C.FIRE_MAX:
        return 0
    return min(owned)


def obs_vector(core, i):
    cfg = core.cfg
    ship = core.ships[i]
    out = [
        COS[ship.hdg],
        SIN[ship.hdg],
        _clip(ship.vx / C.V_NORM),
        _clip(ship.vy / C.V_NORM),
        _clip(math.hypot(ship.vx, ship.vy) / C.V_NORM),
        _clip01(max(0, ship.lives) / C.MAX_LIVES_NORM),
        _clip01(_fire_cooldown(core, i) / C.BULLET_LIFE),
        1.0 if ship.invuln > 0 else 0.0,
    ]
    w, h, dh = core.W, core.H, core.D_HALF
    rocks = sorted((_rel(ship, a, a.size, w, h) for a in core.asteroids), key=_threat_key)
    _emit(out, rocks, cfg.k_asteroids, True, dh)

    bullets = sorted(
        (_rel(ship, b, None, w, h) for b in core.bullets if b.owner != i), key=_threat_key
    )
    _emit(out, bullets, cfg.k_bullets, False, dh)
    return out
