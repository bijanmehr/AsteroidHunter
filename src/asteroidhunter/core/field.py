"""Seeded wave generation: where asteroids spawn and how fast they drift.

Everything draws from the world RNG passed in, so a given (seed, wave) always
produces the same field. World dimensions (w, h) are passed in because the
browser game uses a screen-shaped torus.
"""
from __future__ import annotations

import math

from .. import config as C
from .physics import Asteroid

_TWO_PI = 2.0 * math.pi


def _spawn_point(rng, ship_x, ship_y, min_dist, w, h):
    """A random point on the torus at least ``min_dist`` from the ship."""
    for _ in range(64):
        x = rng.random() * w
        y = rng.random() * h
        dx = min(abs(x - ship_x), w - abs(x - ship_x))
        dy = min(abs(y - ship_y), h - abs(y - ship_y))
        if dx * dx + dy * dy >= min_dist * min_dist:
            return x, y
    return (ship_x + 0.5 * w) % w, (ship_y + 0.5 * h) % h


def make_asteroid(rng, x, y, size, speed_mult):
    speed = (
        C.SHIP_LEN
        * rng.uniform(C.AST_SPEED_MIN, C.AST_SPEED_MAX)
        * C.AST_SPEED_SCALE[size]
        * speed_mult
    )
    ang = rng.random() * _TWO_PI
    return Asteroid(
        x=x,
        y=y,
        vx=speed * math.cos(ang),
        vy=speed * math.sin(ang),
        size=size,
        spin=rng.random() * _TWO_PI,
        dspin=(rng.random() - 0.5) * 0.06,
        shape=rng.randrange(C.N_SHAPES),
    )


def spawn_wave(rng, wave, ship_x, ship_y, speed_mult, w, h):
    """Return a fresh list of large asteroids for ``wave``."""
    n = C.wave_seed_count(wave)
    rocks = []
    min_dist = 0.30 * min(w, h) * 1.2
    for _ in range(n):
        x, y = _spawn_point(rng, ship_x, ship_y, min_dist, w, h)
        rocks.append(make_asteroid(rng, x, y, size=2, speed_mult=speed_mult))
    return rocks
