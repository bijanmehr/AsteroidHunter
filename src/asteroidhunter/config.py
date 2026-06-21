"""Static configuration, physical constants, and difficulty presets.

Pure stdlib. Physical quantities are expressed in *world units* derived from
ship-lengths (sl). The playfield is a 4:3 torus ``[0, W) x [0, H)`` with the
origin at the top-left and **y increasing downward** (matching the canvas), so
"up" on screen is the ``-y`` direction.

All speeds in the design spec are quoted in sl/s; ``_sl()`` converts them to
world-units/s. They are multiplied by ``DT`` per tick inside the core.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, replace

# --- Playfield -------------------------------------------------------------
W = 4.0 / 3.0           # default playfield width (the env stays 4:3; the browser
H = 1.0                 # game overrides W to match the screen aspect ratio)
DT = 1.0 / 60.0         # fixed 60 Hz tick
# Entity scale is tied to the FIXED height so apparent size is consistent on any
# aspect ratio; the screen just shows more/less width. ~45 ship-lengths tall.
SHIP_LEN = H / 45.0


def _sl(v: float) -> float:
    """ship-lengths/sec -> world-units/sec."""
    return v * SHIP_LEN


# --- Ship ------------------------------------------------------------------
HEADINGS = 256                      # heading is an integer in [0, 256)
ROT_STEP = 3                        # heading units per tick (3/256 turn ~= 4.22 deg)
THRUST_ACC = _sl(60.0)             # world u / s^2
MAX_SPEED = _sl(17.0)              # world u / s (hard clamp)
DRAG = 0.99                         # velocity multiplier per tick
SHIP_R = _sl(0.4)                  # collision radius
SHIP_DRAW = _sl(1.6)               # nose-to-tail draw length
INVULN_TICKS = 120                  # spawn protection (2.0 s)
RESPAWN_INVULN = 120
HYPER_INVULN = 30

# --- Bullets ---------------------------------------------------------------
BULLET_SPEED = _sl(17.0)
BULLET_LIFE = 75                    # ticks (~85% of screen width)
FIRE_MAX = 6                        # max simultaneous bullets per ship
FIRE_DEBOUNCE = 8                   # min ticks between shots (~7.5/s autofire; clean single taps)

# --- Hyperspace ------------------------------------------------------------
HYPER_COOLDOWN = 30


def hyper_selfdestruct_p(n_asteroids: int) -> float:
    """Count-scaled self-destruct probability (softened modern floor)."""
    return min(0.40, max(0.05, 0.05 + 0.01 * n_asteroids))


# --- Asteroids -------------------------------------------------------------
# size index: 0 = small, 1 = medium, 2 = large
AST_RADIUS = (_sl(0.3), _sl(0.6), _sl(1.2))
AST_SPEED_SCALE = (1.6, 1.25, 1.0)          # small, medium, large
AST_SPEED_MIN = 4.0                          # sl/s (before size scaling)
AST_SPEED_MAX = 6.5
AST_SCORE = (100, 50, 20)                    # small, medium, large
N_SHAPES = 4                                  # cosmetic silhouette variants
ROCK_CAP = 27
INTERWAVE_DELAY = 48                          # ticks between waves


def wave_seed_count(wave: int) -> int:
    return min(4 + 2 * (wave - 1), 11)


# --- Lives / score ---------------------------------------------------------
EXTRA_LIFE_EVERY = 10000
SCORE_ROLLOVER = 100000

# --- Observation / normalization constants ---------------------------------
D_HALF = 0.5 * math.hypot(W, H)
V_NORM = _sl(34.0)                  # 2x ship max speed
MAX_LIVES_NORM = 10
N_CAP = ROCK_CAP                    # for the reward potential Phi


@dataclass(frozen=True)
class Config:
    """Per-game tunables (presets set the difficulty-facing ones)."""
    lives: int = 3
    ast_speed_mult: float = 1.0
    start_wave: int = 1
    n_ships: int = 1
    k_asteroids: int = 8
    k_bullets: int = 4
    include_ufo: bool = False
    max_steps: int = 2000


PRESETS = {
    "rookie": Config(lives=5, ast_speed_mult=0.7, start_wave=1),
    "pilot": Config(lives=3, ast_speed_mult=1.0, start_wave=1),
    "ace": Config(lives=3, ast_speed_mult=1.3, start_wave=3),
}


def preset(name: str = "pilot", **overrides) -> Config:
    base = PRESETS.get(name, PRESETS["pilot"])
    return replace(base, **overrides) if overrides else base


def obs_dim(cfg: Config) -> int:
    return (
        8
        + 8 * cfg.k_asteroids
        + 7 * cfg.k_bullets
        + (8 if cfg.include_ufo else 0)
        + 8 * (cfg.n_ships - 1)
    )
