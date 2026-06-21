"""Physics primitives: heading lookup tables, entity state, integration.

Trig is taken from precomputed 256-entry tables keyed on the integer ship
heading. This keeps the hot path off ``math.sin``/``math.cos`` (so native and
Pyodide stay bit-identical) and matches the original arcade's byte-heading.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .. import config as C

_TWO_PI = 2.0 * math.pi

# Heading h -> unit vector. h == 0 points along +x; +y is "down" (screen).
COS = [math.cos(_TWO_PI * i / C.HEADINGS) for i in range(C.HEADINGS)]
SIN = [math.sin(_TWO_PI * i / C.HEADINGS) for i in range(C.HEADINGS)]


def heading_rad(h: int) -> float:
    return _TWO_PI * (h % C.HEADINGS) / C.HEADINGS


def wrap(p: float, size: float) -> float:
    """Toroidal wrap of a single coordinate into [0, size)."""
    if p < 0.0:
        return p + size
    if p >= size:
        return p - size
    return p


def torus_delta(a: float, b: float, size: float) -> float:
    """Shortest signed delta b-a on a wrapped axis (result in [-size/2, size/2))."""
    d = b - a
    if d > 0.5 * size:
        d -= size
    elif d < -0.5 * size:
        d += size
    return d


@dataclass
class Ship:
    x: float
    y: float
    vx: float = 0.0
    vy: float = 0.0
    hdg: int = 192              # 192/256 == pointing "up" (-y)
    lives: int = 3
    invuln: int = 0
    fire_cd: int = 0
    hyper_cd: int = 0
    thrusting: bool = False
    dead: bool = False         # all lives gone -> agent terminated


@dataclass
class Bullet:
    x: float
    y: float
    vx: float
    vy: float
    life: int
    owner: int = 0


@dataclass
class Asteroid:
    x: float
    y: float
    vx: float
    vy: float
    size: int                  # 0 small, 1 medium, 2 large
    spin: float = 0.0          # cosmetic rotation, radians
    dspin: float = 0.0         # cosmetic spin rate, radians/tick
    shape: int = 0             # cosmetic silhouette index

    @property
    def radius(self) -> float:
        return C.AST_RADIUS[self.size]
