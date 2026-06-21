"""Gymnasium adapter for AsteroidHunter (single-agent).

This is the ONLY module that imports numpy/gymnasium, so ``import
asteroidhunter`` (and the browser path) stay dependency-free. The N-agent
``ParallelEnv`` is deferred to the MARL roadmap; the core already speaks
dict-of-agents, so it is a thin add later.
"""
from __future__ import annotations

from dataclasses import replace

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from . import config as C
from .core.world import AsteroidHunterCore


class AsteroidHunterEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, preset: str = "pilot", config: C.Config | None = None, seed=None):
        cfg = config or C.preset(preset)
        cfg = replace(cfg, n_ships=1)  # this adapter is single-agent
        self.cfg = cfg
        self.core = AsteroidHunterCore(cfg)
        dim = C.obs_dim(cfg)
        self.observation_space = spaces.Box(-1.0, 1.0, shape=(dim,), dtype=np.float32)
        self.action_space = spaces.MultiDiscrete([3, 2, 2, 2])
        self._default_seed = seed

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        s = seed if seed is not None else self._default_seed
        obs, info = self.core.reset(s)
        return np.asarray(obs["ship_0"], dtype=np.float32), info["ship_0"]

    def step(self, action):
        a = tuple(int(x) for x in np.asarray(action).reshape(-1))
        obs, rew, term, trunc, info = self.core.step({"ship_0": a})
        return (
            np.asarray(obs["ship_0"], dtype=np.float32),
            float(rew["ship_0"]),
            bool(term["ship_0"]),
            bool(trunc["ship_0"]),
            info["ship_0"],
        )
