"""Pyodide entry points. Input is one integer bitmask; output is a flat
``array('d')`` render buffer. No game logic lives in JavaScript.
"""
from __future__ import annotations

import array

from .. import config as C
from .world import AsteroidHunterCore

# input bit flags (must match web/app.js)
LEFT = 1
RIGHT = 2
THRUST = 4
FIRE = 8
HYPER = 16


def new_game(preset="pilot", seed=0, n_ships=1, aspect=None):
    cfg = C.preset(str(preset), n_ships=int(n_ships))
    game = AsteroidHunterCore(cfg, aspect=float(aspect) if aspect else None)
    game.reset(int(seed))
    return game


def set_aspect(game, aspect):
    game.set_aspect(float(aspect))


def _decode(bits):
    bits = int(bits)
    rot = 0 if (bits & LEFT) else (2 if (bits & RIGHT) else 1)
    return (rot, 1 if bits & THRUST else 0, 1 if bits & FIRE else 0, 1 if bits & HYPER else 0)


def step(game, bits):
    game.step({"ship_0": _decode(bits)})
    return array.array("d", game.render_buffer())


def render(game):
    return array.array("d", game.render_buffer())
