"""AsteroidHunter — a deterministic recreation of Atari's 1979 ASTEROIDS,
playable in the browser (via Pyodide) and usable as an RL environment.

The simulation core (``asteroidhunter.core``) is pure stdlib. Gymnasium/numpy
are only touched by ``asteroidhunter.env`` and only when you import it, so
``import asteroidhunter`` stays dependency-free (and Pyodide-friendly).
"""

__version__ = "0.1.0"


def register():
    """Lazily register the Gymnasium environment.

    Call this only in an environment where ``gymnasium`` is installed; it is
    never invoked on the pure-stdlib / browser path.
    """
    from gymnasium.envs.registration import register as _register

    _register(
        id="AsteroidHunter-v0",
        entry_point="asteroidhunter.env:AsteroidHunterEnv",
    )
