"""``AsteroidHunterCore`` — the N-ship simulation and single source of truth.

Speaks dict-of-agents (keys ``"ship_0"``, ``"ship_1"`` ...). The single-agent
Gymnasium adapter and the browser both drive this same object, so the human
game and the RL env are bit-for-bit the same physics.

The playfield is a torus of size ``self.W x self.H``. ``H`` is fixed (1.0);
``W`` defaults to 4:3 for the RL env but the browser overrides it (and can
change it live via :meth:`set_aspect`) so the game fills any screen with no
distortion.
"""
from __future__ import annotations

import math
import random

from .. import config as C
from . import field, view
from .physics import COS, SIN, Asteroid, Bullet, Ship, torus_delta, wrap

_TWO_PI = 2.0 * math.pi


class AsteroidHunterCore:
    def __init__(self, cfg: C.Config | None = None, aspect: float | None = None):
        self.cfg = cfg or C.preset("pilot")
        self.n = self.cfg.n_ships
        self.H = C.H
        self.W = aspect * self.H if aspect else C.W
        self.D_HALF = 0.5 * math.hypot(self.W, self.H)
        self.reset(0)

    @staticmethod
    def _aid(i: int) -> str:
        return "ship_%d" % i

    def set_aspect(self, aspect: float):
        """Re-shape the torus to a new width/height ratio in place (no reset).

        Existing entity x-positions are rescaled so the layout is preserved and
        everything stays in-bounds. Used by the browser on window resize.
        """
        new_w = aspect * self.H
        if new_w <= 0 or abs(new_w - self.W) < 1e-12:
            return
        sx = new_w / self.W
        for s in self.ships:
            s.x *= sx
        for b in self.bullets:
            b.x *= sx
        for a in self.asteroids:
            a.x *= sx
        self.W = new_w
        self.D_HALF = 0.5 * math.hypot(self.W, self.H)

    # -- lifecycle ----------------------------------------------------------
    def reset(self, seed: int | None = None):
        self.rng = random.Random(seed)
        self.episode_step = 0
        self.score = [0] * self.n
        self._next_extra = [C.EXTRA_LIFE_EVERY] * self.n
        self.bullets: list[Bullet] = []
        self.asteroids: list[Asteroid] = []
        self.wave = self.cfg.start_wave
        self.interwave = 0
        self._wave_done = False
        self.game_over = False
        self.ships: list[Ship] = []
        cx, cy = 0.5 * self.W, 0.5 * self.H
        for i in range(self.n):
            ang = _TWO_PI * i / max(1, self.n)
            off = 0.0 if self.n == 1 else 0.12 * self.H
            self.ships.append(
                Ship(
                    x=wrap(cx + off * math.cos(ang), self.W),
                    y=wrap(cy + off * math.sin(ang), self.H),
                    lives=self.cfg.lives,
                    invuln=C.RESPAWN_INVULN,
                    hdg=192,
                )
            )
        self._spawn_wave()
        self._ev = {i: {"dscore": 0, "life_lost": 0, "hyper": 0} for i in range(self.n)}
        return self._obs_all(), self._info_all(len(self.asteroids))

    # -- one tick -----------------------------------------------------------
    def step(self, actions=None):
        self._ev = {i: {"dscore": 0, "life_lost": 0, "hyper": 0} for i in range(self.n)}
        n_before = len(self.asteroids)
        self.episode_step += 1
        cleared = False
        if not self.game_over:
            for i, ship in enumerate(self.ships):
                act = actions.get(self._aid(i)) if actions else None
                self._apply_ship(i, ship, act)
            self._step_bullets()
            self._step_asteroids()
            self._collisions()
            cleared = self._wave_logic()
            self._extra_lives()
            self.game_over = all(s.dead for s in self.ships)
        else:
            self._step_asteroids()
        return self._package(cleared, n_before, len(self.asteroids))

    # -- ship update --------------------------------------------------------
    def _apply_ship(self, i, ship, a):
        if ship.invuln > 0:
            ship.invuln -= 1
        if ship.fire_cd > 0:
            ship.fire_cd -= 1
        if ship.hyper_cd > 0:
            ship.hyper_cd -= 1
        if ship.dead:
            ship.thrusting = False
            return
        if a is None:
            a = (1, 0, 0, 0)
        rot, thrust, fire, hyper = int(a[0]), int(a[1]), int(a[2]), int(a[3])

        d = rot - 1
        if d:
            ship.hdg = (ship.hdg + C.ROT_STEP * d) % C.HEADINGS

        if hyper and ship.hyper_cd == 0:
            self._hyperspace(i, ship)

        ship.thrusting = bool(thrust) and not ship.dead
        if ship.thrusting:
            ship.vx += C.THRUST_ACC * C.DT * COS[ship.hdg]
            ship.vy += C.THRUST_ACC * C.DT * SIN[ship.hdg]

        ship.vx *= C.DRAG
        ship.vy *= C.DRAG
        sp = math.hypot(ship.vx, ship.vy)
        if sp > C.MAX_SPEED:
            f = C.MAX_SPEED / sp
            ship.vx *= f
            ship.vy *= f

        ship.x = wrap(ship.x + ship.vx * C.DT, self.W)
        ship.y = wrap(ship.y + ship.vy * C.DT, self.H)

        if fire and ship.fire_cd == 0:
            if sum(1 for b in self.bullets if b.owner == i) < C.FIRE_MAX:
                self._fire(i, ship)
                ship.fire_cd = C.FIRE_DEBOUNCE

    def _fire(self, i, ship):
        nx, ny = COS[ship.hdg], SIN[ship.hdg]
        self.bullets.append(
            Bullet(
                x=wrap(ship.x + nx * C.SHIP_DRAW * 0.5, self.W),
                y=wrap(ship.y + ny * C.SHIP_DRAW * 0.5, self.H),
                vx=ship.vx + nx * C.BULLET_SPEED,
                vy=ship.vy + ny * C.BULLET_SPEED,
                life=C.BULLET_LIFE,
                owner=i,
            )
        )

    def _hyperspace(self, i, ship):
        self._ev[i]["hyper"] = 1
        ship.x = self.rng.random() * self.W
        ship.y = self.rng.random() * self.H
        ship.vx = ship.vy = 0.0
        ship.hyper_cd = C.HYPER_COOLDOWN
        if self.rng.random() < C.hyper_selfdestruct_p(len(self.asteroids)):
            self._lose_life(i, ship)
        else:
            ship.invuln = max(ship.invuln, C.HYPER_INVULN)

    # -- world update -------------------------------------------------------
    def _step_bullets(self):
        alive = []
        for b in self.bullets:
            b.life -= 1
            if b.life <= 0:
                continue
            b.x = wrap(b.x + b.vx * C.DT, self.W)
            b.y = wrap(b.y + b.vy * C.DT, self.H)
            alive.append(b)
        self.bullets = alive

    def _step_asteroids(self):
        for a in self.asteroids:
            a.x = wrap(a.x + a.vx * C.DT, self.W)
            a.y = wrap(a.y + a.vy * C.DT, self.H)
            a.spin += a.dspin

    def _collisions(self):
        dead_bullets = set()
        survivors = []
        spawned = []
        for a in self.asteroids:
            hit = None
            for bi, b in enumerate(self.bullets):
                if bi in dead_bullets:
                    continue
                dx = torus_delta(a.x, b.x, self.W)
                dy = torus_delta(a.y, b.y, self.H)
                if dx * dx + dy * dy <= a.radius * a.radius:
                    hit = bi
                    break
            if hit is not None:
                dead_bullets.add(hit)
                self._add_score(self.bullets[hit].owner, C.AST_SCORE[a.size])
                spawned.extend(self._split(a))
            else:
                survivors.append(a)
        if dead_bullets:
            self.bullets = [b for bi, b in enumerate(self.bullets) if bi not in dead_bullets]
        self.asteroids = survivors + spawned

        for i, ship in enumerate(self.ships):
            if ship.dead or ship.invuln > 0:
                continue
            for a in self.asteroids:
                dx = torus_delta(ship.x, a.x, self.W)
                dy = torus_delta(ship.y, a.y, self.H)
                rr = a.radius + C.SHIP_R
                if dx * dx + dy * dy <= rr * rr:
                    self._lose_life(i, ship)
                    break

    def _split(self, a):
        if a.size == 0:
            return []
        child = a.size - 1
        base = math.atan2(a.vy, a.vx)
        speed = math.hypot(a.vx, a.vy)
        out = []
        for s in (-1, 1):
            if len(self.asteroids) + len(out) >= C.ROCK_CAP:
                break
            ang = base + s * self.rng.uniform(0.3, 0.9)
            sp = speed * self.rng.uniform(1.05, 1.4)
            out.append(
                Asteroid(
                    x=a.x,
                    y=a.y,
                    vx=sp * math.cos(ang),
                    vy=sp * math.sin(ang),
                    size=child,
                    spin=self.rng.random() * _TWO_PI,
                    dspin=(self.rng.random() - 0.5) * 0.08,
                    shape=self.rng.randrange(C.N_SHAPES),
                )
            )
        return out

    # -- scoring / lives ----------------------------------------------------
    def _add_score(self, owner, pts):
        self.score[owner] += pts
        self._ev[owner]["dscore"] += pts

    def _lose_life(self, i, ship):
        ship.lives -= 1
        self._ev[i]["life_lost"] = 1
        if ship.lives <= 0:
            ship.dead = True
            ship.invuln = 0
        else:
            self._respawn(i, ship)

    def _respawn(self, i, ship):
        ship.x, ship.y = 0.5 * self.W, 0.5 * self.H
        ship.vx = ship.vy = 0.0
        ship.hdg = 192
        ship.invuln = C.RESPAWN_INVULN
        ship.fire_cd = ship.hyper_cd = 0

    def _extra_lives(self):
        for i, ship in enumerate(self.ships):
            if ship.dead:
                continue
            while self.score[i] >= self._next_extra[i]:
                ship.lives += 1
                self._next_extra[i] += C.EXTRA_LIFE_EVERY

    # -- waves --------------------------------------------------------------
    def _spawn_wave(self):
        sx, sy = (self.ships[0].x, self.ships[0].y) if self.ships else (0.5 * self.W, 0.5 * self.H)
        self.asteroids += field.spawn_wave(
            self.rng, self.wave, sx, sy, self.cfg.ast_speed_mult, self.W, self.H
        )

    def _wave_logic(self):
        cleared = False
        if not self.asteroids:
            if not self._wave_done:
                self._wave_done = True
                cleared = True
                self.interwave = C.INTERWAVE_DELAY
            elif self.interwave > 0:
                self.interwave -= 1
                if self.interwave == 0:
                    self.wave += 1
                    self._spawn_wave()
                    self._wave_done = False
        return cleared

    # -- observation / reward packaging ------------------------------------
    def obs_vector(self, i):
        return view.obs_vector(self, i)

    def _obs_all(self):
        return {self._aid(i): self.obs_vector(i) for i in range(self.n)}

    def _info_all(self, n_ast):
        return {
            self._aid(i): {
                "true_score": self.score[i],
                "lives": max(0, self.ships[i].lives),
                "wave": self.wave,
                "n_asteroids": n_ast,
                "episode_step": self.episode_step,
            }
            for i in range(self.n)
        }

    def _package(self, cleared, n_before, n_after):
        gamma = 0.99
        phi_b = 0.3 * (C.N_CAP - n_before)
        phi_a = 0.3 * (C.N_CAP - n_after)
        truncate = self.episode_step >= self.cfg.max_steps
        obs, rew, term, trunc, info = {}, {}, {}, {}, {}
        infos = self._info_all(n_after)
        for i in range(self.n):
            aid = self._aid(i)
            ev = self._ev[i]
            r = (
                ev["dscore"] / 100.0
                + (10.0 if cleared else 0.0)
                - (10.0 if ev["life_lost"] else 0.0)
                - 0.01
                - (0.3 if ev["hyper"] else 0.0)
                + gamma * phi_a
                - phi_b
            )
            obs[aid] = self.obs_vector(i)
            rew[aid] = r
            term[aid] = self.ships[i].dead
            trunc[aid] = truncate
            info[aid] = infos[aid]
            info[aid]["shaped_reward"] = r
        return obs, rew, term, trunc, info

    # -- render snapshot for the browser -----------------------------------
    def render_buffer(self):
        return view.pack_render(self)
