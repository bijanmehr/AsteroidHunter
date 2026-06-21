```
        /\
       /  \      A S T E R O I D   H U N T E R
      / /\ \
     /_/  \_\    Atari's 1979 ASTEROIDS, rebuilt as a deterministic
                 browser game + reinforcement-learning environment.
```

One pure-Python, stdlib-only physics core is the single source of truth. It runs
**natively** (as a Gymnasium env) and **in the browser** (via Pyodide) so the
game you play and the environment an agent will train on are bit-for-bit the
same simulation.

## Play

**Online:** <https://bijanmehr.github.io/AsteroidHunter/> · [manual](https://bijanmehr.github.io/AsteroidHunter/docs.html)

**Locally:**
```bash
bash scripts/serve.sh           # serves on :8000
# open http://localhost:8000/
```

No build step — Pyodide loads the Python core straight from `src/`.

**Controls:** ← → rotate · ↑ thrust · Space fire · Shift hyperspace · R menu. Pick a difficulty (rookie / pilot / ace) on the title screen.

## Use the environment (optional)

```bash
pip install -e ".[env]"
```

```python
import gymnasium as gym
import asteroidhunter
asteroidhunter.register()
env = gym.make("AsteroidHunter-v0")      # or AsteroidHunterEnv(preset="ace")
obs, info = env.reset(seed=0)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
```

- **Observation:** 100-dim float vector in `[-1, 1]` (ship state + k-nearest
  asteroids/bullets, threat-sorted).
- **Action:** `MultiDiscrete([3, 2, 2, 2])` = (rotate, thrust, fire, hyperspace).
- **Reward:** score + wave-clear − death − time − hyperspace + potential-based
  shaping. `info["true_score"]` is the honest benchmark metric.

## Layout

```
src/asteroidhunter/
  config.py        constants + difficulty presets (rookie/pilot/ace)
  env.py           Gymnasium adapter (only file importing numpy/gymnasium)
  core/            pure-stdlib sim: physics · field · world · view · browser
index.html         the browser game, served at the repo root
app.js · renderer.js · vectorfont.js · docs.html · favicon.svg
docs/              design spec + interface contract
```

**Scope:** game + environment. Training, policy export, in-browser AI replay,
the UFO/saucer, and multi-agent modes are on the roadmap (see `docs/`).
