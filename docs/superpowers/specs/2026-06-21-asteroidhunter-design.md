# AsteroidHunter — Design Spec

*A faithful, deterministic recreation of Atari's 1979 ASTEROIDS that is simultaneously a human-playable browser game and a reinforcement-learning environment.*

**Status:** approved design, 2026-06-21
**Models the architecture of:** [MultiLander](https://github.com/bijanmehr/MultiLander)

---

## 0. Scope of this build

**In scope now:** the deterministic physics **core**, the RL **environment** (full Gymnasium contract — observation/action/reward, `check_env` passing), and the human-playable **browser game** (PLAY mode).

**Explicitly deferred (built later, not now):** model training, `train_template.py`, JSON **policy export**, and the browser **LOAD-AI / AGENT-VIEW** policy replay. The environment is built in full so it is *ready* for an agent later; we simply do not train or wire up policy replay in this build.

Everything below is written so that adding training later changes **nothing** in the core, env contract, or observation pipeline — only adds new files (`train/`, `examples/train_template.py`) and re-enables two browser buttons.

---

## 1. Overview & goals

AsteroidHunter is a deterministic, **stdlib-only Python physics core** that is the single source of truth, surfaced two ways: a **Gymnasium-style RL environment** for native use, and a **Pyodide/WASM** module that drives a Canvas game in the browser. Same boundary rule as MultiLander: *Python simulates, JS draws, everything crossing the boundary is plain data.*

**Users:** RL researchers/learners who will `pip install` and `gymnasium.make("AsteroidHunter-v0")`; players who open the GitHub Pages site.

**Success criteria:**
1. Byte-identical determinism native↔browser given `(seed, action_sequence)`.
2. Faithful 1979 feel (authentic constants, §3).
3. `gymnasium.utils.env_checker.check_env` passes.
4. The game is smoothly human-playable at 60 Hz on GitHub Pages.
5. N-ship-ready core, with single-agent as the default published surface.

---

## 2. Architecture — single core, dual surface

```
                       ┌─────────────────────────────────────────┐
                       │   src/asteroidhunter/core/   (PURE)      │
                       │   stdlib only: math, random, array, json │
                       │   world.py · physics.py · field.py       │
                       │   view.py · browser.py                   │
                       └───────────────┬──────────────┬───────────┘
                                       │ imports core │ imports core
              ┌────────────────────────┘              └──────────────────────┐
     ┌────────▼─────────┐                                      ┌─────────────▼──────────┐
     │  env.py (RL)     │                                      │ browser.py (PYODIDE)   │
     │  Gymnasium Env   │                                      │ new_game / step        │
     │  single-agent    │                                      │ int bits in → float[]  │
     │  numpy/gym ONLY  │                                      │ (same py3-none-any whl)│
     │  here            │                                      └─────────────┬──────────┘
     └──────────────────┘                                      ┌─────────────▼──────────┐
                                                               │ web/ (JS shell, NO     │
       (later) train/ + examples/  ─ ─ ─ ─ ─ deferred ─ ─ ─    │ game logic): app.js    │
                                                               │ renderer.js · vectorfont│
                                                               └────────────────────────┘
```

**Hard rule:** `core/` and `browser.py` import **only the Python standard library** (`math`, `random`, `array`, `json`). numpy/gymnasium/pettingzoo live **exclusively** in `env.py` (and, later, `train/`), which the core never imports. The wheel is therefore `py3-none-any` and loads in Pyodide with zero binary dependencies. Purity is enforced by a subprocess test that imports the package and asserts numpy is absent from `sys.modules`.

**Data flow — one browser frame.** JS `requestAnimationFrame` runs a fixed-timestep accumulator (`DT = 1/60`). Each pending step: JS packs held keys into one **integer bitmask** → `pyStep(bits)` → Python decodes to an action, calls `core.step(...)` once, returns a flat `array.array('d')` that Pyodide hands JS as a `Float64Array` (single copy, no per-entity proxies). JS draws only the latest buffer. No game logic in JS; no drawing in Python.

**Data flow — one env `step()`.** `env.step(action)` (a `MultiDiscrete` vector) → `core.step({"ship_0": action})` advances physics exactly one fixed tick → core returns per-agent `(obs, reward, terminated, truncated, info)` → the single-agent adapter unwraps `"ship_0"` and returns the idiomatic 5-tuple. **The same `core.step` runs in both surfaces**, which is what guarantees the human game and the env are identical.

---

## 3. The physics core (authentic constants)

Fixed **60 Hz** tick (`DT = 1/60 s`). Playfield is a **toroidal continuous space** `[0, W] × [0, H]`, `W = 1.333`, `H = 1.0` (4:3), wrapping on all four edges. **1 ship-length (sl) = W/25 ≈ 0.0533** world units (screen ≈ 25 ship-lengths wide). Speeds are quoted in sl/s and converted by `×0.0533` to world units/s, then `×DT` per tick.

### Constants

| Domain | Quantity | Value |
|---|---|---|
| **Tick** | rate / dt | 60 Hz / 0.016667 s, fixed |
| **Playfield** | size (4:3 toroidal) | W=1.333, H=1.0; 1 sl = W/25 |
| **Ship** | rotation rate | 270°/s (≈4.5°/tick; normalized — original ≈210–280°/s) |
| | thrust accel | 60 sl/s² (≈0.3 s / ~19 ticks to the 17 sl/s clamp) |
| | drag (per tick) | velocity ×= 0.99/tick (half-life ≈1.15 s; ~30% speed remains after 2 s) |
| | max speed | 17 sl/s (hard clamp) |
| | hitbox radius | 0.4 sl |
| | respawn invulnerability | **120 ticks (2.0 s)**, surfaced via `invuln_flag` in obs |
| | screen wrap | all 4 edges, Newtonian inertia |
| **Bullets** | max simultaneous | **4** |
| | lifetime | **75 ticks (1.25 s)** — shot covers ~85% of the 25-sl screen at 17 sl/s |
| | speed | 17 sl/s + ship velocity (inherited) |
| | fire gating | 4-cap + lifetime; 1-tick fire debounce |
| | `cooldown` (obs) | ticks until a bullet slot frees: 0 if <4 live bullets, else min remaining lifetime among the 4 (range [0, 75]) |
| | hitbox | point (≈0.02 sl) |
| **Hyperspace** | reappear delay | 30 ticks (0.5 s) |
| | self-destruct prob | `clamp(0.05 + 0.01·N_asteroids, 0.05, 0.40)` — softened modern floor (authentic baseline ≈0.25; see §10) |
| | landing check | none (can rematerialize on a rock) |
| **Asteroids** | radii L/M/S | 1.2 / 0.6 / 0.3 sl |
| | split | L → 2×M → 2×S → destroyed; children get randomized heading (±angle) + speed roll |
| | drift speed | uniform(4.0, 6.5) sl/s, size-scaled (small ×1.6, medium ×1.25, large ×1.0) |
| | wave seed count | `min(4 + 2·(wave−1), 11)`, spawned at edges away from ship |
| | on-screen rock cap | 27 |
| | inter-wave delay | 48 ticks (0.8 s) |
| **Scoring** | L / M / S | **20 / 50 / 100** |
| | (saucer — roadmap) | large 200, small 1000 (capped at 200 in reward, §5) |
| **Lives** | starting | 3 (preset-dependent, §4) |
| | extra life | +1 every 10,000 points |
| | score rollover | 99,990 |

### Normalization & derived constants (used by the shared obs builder)

| Constant | Value | Use |
|---|---|---|
| `D` (half-diagonal) | `0.5·hypot(W,H)` ≈ 0.833 | normalizes all positions/distances to [−1,1] |
| `V_NORM` | 34 sl/s (= 2× ship max) | normalizes all velocities, `rel_v*`, and `closing_rate` (bullets reach ~2× ship speed) |
| `MAX_LIVES_NORM` | 10 | `lives_norm = clip(lives/10, 0, 1)` — fixed cap so extra-life accrual never breaks the [−1,1] bound |
| `BULLET_LIFE` | 75 ticks | divisor for `cooldown_norm` |
| `N_CAP` | 27 (= on-screen rock cap) | used by the reward potential Φ (§4) |

**Determinism trick:** `sin/cos` come from a **precomputed 256-entry lookup table** keyed on the integer heading byte — this dodges platform-libm last-ULP divergence between native Python and Pyodide on the parity-critical path.

### Core modules (all pure stdlib)

- `core/physics.py` — `ShipState`, `BulletState`, `AsteroidState` dataclasses + free `step()` functions (semi-implicit Euler: velocity then position; heading wrapped to `(−π, π]`; toroidal position wrap). Holds the sin/cos lookup table.
- `core/field.py` — seeded wave generation: asteroid positions/headings/speeds/sizes, edge-spawn-away-from-ship logic, cosmetic star seed.
- `core/world.py` — `AsteroidHunterCore`: the N-ship simulation owner and state machine (spawn → play → split → wave-clear → respawn → game-over). Holds `self.rng = random.Random(seed)`. Order-independent step: snapshot pre-step state, resolve all ship moves, then collisions.
- `core/view.py` — `pack_render(world) → array.array('d')` (flat float buffer for the browser) **and** `obs_vector(world, ship_i) → list[float]` (the RL observation; **one shared builder** for env and browser).
- `core/browser.py` — Pyodide entry points: `new_game`, `step` (human PLAY). `ai_step` is stubbed/deferred until policy replay is built.
- `core/autopilot.py` — *(deferred to roadmap)* deterministic rule-based attract-mode pilot (nearest-threat aim-and-fire + evade); pure stdlib, not a trained policy. Listed for completeness; **not built in this scope**.

---

## 4. The RL environment contract

### API: one core, two adapters

The world is **shared** (one asteroid field; later one UFO; later ship-ship collisions), so it is owned by `AsteroidHunterCore`, which always speaks **dict-of-agents**. Two thin published adapters:

- **`AsteroidHunterEnv(gymnasium.Env)`** — **the only adapter built in this scope**; idiomatic single-agent (N=1); returns plain tuples.
- **`AsteroidHunterParallelEnv(pettingzoo.ParallelEnv)`** — *deferred (MARL roadmap), not implemented now*. The core already speaks dict-of-agents, so this is a thin add later; `pettingzoo` is an optional `marl` extra, not a required dependency.

```python
# single-agent (default)
def reset(self, *, seed=None, options=None) -> tuple[np.ndarray, dict]
def step(self, action: np.ndarray) -> tuple[np.ndarray, float, bool, bool, dict]

# N-agent (roadmap)
def reset(self, seed=None, options=None) -> tuple[dict, dict]
def step(self, actions: dict[str, np.ndarray]) -> tuple[dict, dict, dict, dict, dict]
```

Agent ids are stable strings `"ship_0", "ship_1", …`; `possible_agents` is fixed so `observation_space(agent)` is always answerable. The single-agent adapter simply unwraps `"ship_0"`.

### Observation vector (float32, every field in [−1, 1])

MVP config: **`k_asteroids = 8`, `k_bullets = 4`** (incoming/enemy bullets only — **own bullets excluded**), **no UFO**, **n_ships = 1**.

| Block | Fields per slot | Floats | Slots | Subtotal |
|---|---|---|---|---|
| Self (ego ship) | `cosθ, sinθ, vx, vy, speed, lives_norm, cooldown_norm, invuln_flag` | 8 | 1 | 8 |
| Asteroids | `present, dx, dy, dist, closing_rate, rel_vx, rel_vy, size_norm` | 8 | 8 | 64 |
| Bullets (incoming) | `present, dx, dy, dist, closing_rate, rel_vx, rel_vy` | 7 | 4 | 28 |
| UFO (roadmap) | `present, dx, dy, dist, closing_rate, rel_vx, rel_vy, is_firing` | 8 | 0/1 | 0 |
| Other ships (MARL roadmap) | `present, dx, dy, dist, rel_vx, rel_vy, heading_cos, heading_sin` | 8 | n−1 | 0 |

**Dimensionality:** `OBS_DIM = 8 + 8·k_asteroids + 7·k_bullets + 8·include_ufo + 8·(n_ships−1)`.
**MVP value:** `8 + 64 + 28 + 0 + 0 = 100`. (With UFO later: 108. With n_ships=3 + UFO: 124.)

**Normalization.** Positions/distances ÷ half-diagonal `D ≈ 0.833`, then mapped to [−1,1] and clipped. Velocities, `rel_v*`, and `closing_rate` ÷ `V_NORM = 34 sl/s`, clipped to [−1,1]. Angles always `(cosθ, sinθ)` (never raw radians). `lives_norm = clip(lives/MAX_LIVES_NORM, 0, 1)` with `MAX_LIVES_NORM = 10` (extra lives can push `lives` above the preset start, so the clip is mandatory). `cooldown_norm = cooldown/BULLET_LIFE` (= cooldown/75), `size_norm = size_idx/2`. Flags are 0.0/1.0. All normalization constants are defined in §3.

**Padding.** Each slot leads with `present` (1.0 real / 0.0 empty); all other fields of an empty slot are 0.0.

**Stable slot ordering.** Each block sorted **threat-then-proximity**: primary key = time-to-collision `dist / max(closing_rate, ε)` ascending (incoming first); objects with `closing_rate ≤ 0` sort after all incoming, by raw distance ascending. Slot 0 is always "most dangerous." Deterministic given world state. Other ships (later) sorted by distance.

`OBS_DIM` is **fixed per config** — `k_*` / `include_ufo` / `n_ships` are constructor args, never runtime-varying — so the `Box` shape is constant.

### Action space

Factored **`MultiDiscrete([3, 2, 2, 2])`**, zero-based:

| idx | meaning | values | semantics |
|---|---|---|---|
| 0 | rotate | {0,1,2} | → {−1,0,+1} via `value − 1` |
| 1 | thrust | {0,1} | off / on |
| 2 | fire | {0,1} | no-op / fire (gated by 4-cap + debounce) |
| 3 | hyperspace | {0,1} | no-op / random teleport |

Each agent in MARL gets its own identical `MultiDiscrete([3,2,2,2])`.

### Reward function

```
γ = the trainer's discount (used only by the PBRS term; default 0.99).
Φ(s) = 0.3 · (N_CAP − N_asteroids(s))      # NON-NEGATIVE potential (N_CAP = 27); rises as the field clears

r_t =  1.0 · (Δscore_t / 100)        # Δscore from 20/50/100 rocks; saucer term capped at 200 (inactive until UFO)
    + 10.0 · 1[wave_cleared_t]
    − 10.0 · lost_life_t
    −  0.01                          # constant per-step time cost
    −  0.3 · hyperspace_used_t
    + γ·Φ(s_{t+1}) − Φ(s_t)          # potential-based shaping (Ng/Harada/Russell 1999); policy-invariant
```

**Why a non-negative Φ:** at constant N the shaping term equals `(γ−1)·Φ(s) ≤ 0` — a small *negative* drift that **reinforces** the time cost. Destroying a rock raises Φ and pays ≈ +0.3 per unit reduction; a large→2×medium split lowers Φ and is mildly penalized. (Had Φ been `−0.3·N`, constant-N idling would earn a *positive* `+0.3·(1−γ)·N` drift that can exceed the −0.01 time cost — exactly the idling exploit §5 prevents. The non-negative form removes it.)

**While `include_ufo=False` (this build) the saucer term is inert**, so §8 reward tests assert only the rock / wave-clear / death / time / hyperspace / PBRS terms.

**No reward clipping** (it would collapse 20/50/100 into one value and kill the aiming skill); standardize returns at the trainer (PopArt / VecNormalize) instead. `info["true_score"]` (raw cumulative game score) is **the only benchmark metric** — a high shaped reward with low `true_score` *is* the reward-hack detector. (Reward terms are defined now and exercised by env tests; no agent is trained against them in this build.)

### Termination vs truncation

- `terminated = True` when all lives lost (terminal MDP state).
- `truncated = True` when `episode_step ≥ max_steps` (default **2000**, ≈33 s).
- Never both for the same cause. **MARL (later):** per-agent dicts; a ship that loses all lives gets `terminated[agent]=True` that step, then is removed from `self.agents` next step; episode ends when `not env.agents`; a global timeout sets `truncated=True` for all survivors at once.

### info dict (per agent — diagnostics/logging)

```python
{ "true_score": int,            # raw cumulative game score — THE benchmark metric
  "shaped_reward": float, "lives": int, "wave": int,
  "n_asteroids": int, "n_bullets_incoming": int, "ufo_present": bool,
  "real_entity_counts": {"asteroids": int, "bullets": int},
  "episode_step": int }
```

### Seeding / determinism

All randomness (spawns, splits, hyperspace destination + self-destruct roll, and later UFO timing/aim) draws from a single `self.rng = random.Random(seed)` created in `reset(seed)`. No module-level `random`; no `time`/`os.urandom`/`secrets`; no `set`/`hash`-ordering dependence. `reset(seed=s)` fully reseeds. Same config + seed + action sequence ⇒ identical streams. Physics is resolved from a pre-step snapshot so agent-dict iteration order cannot affect state.

### Reset semantics

`reset(seed=s)` restores a fresh episode and is the determinism anchor — it sets `self.rng = random.Random(s)`, `score = 0`, `lives = preset.lives`, `wave = preset.start_wave`, `episode_step = 0`, clears all bullets, re-centers the ship at rest with the 120-tick spawn invuln, and regenerates the starting wave field from the new rng. `episode_step` is incremented **before** the `episode_step ≥ max_steps` check, so exactly `max_steps` `step()` calls occur before truncation.

### Difficulty presets

A frozen `PRESETS` table; the default env uses **`pilot`**.

| Preset | Lives | Asteroid speed × | Start wave |
|---|---|---|---|
| `rookie` | 5 | 0.7 | 1 |
| `pilot` *(default)* | 3 | 1.0 | 1 |
| `ace` | 3 | 1.3 | 3 |

(Other knobs — UFO on/off, bullet cap — remain available on the `Config` dataclass for later curriculum work.)

---

## 5. Reward-hacking defenses

| Exploit | What the agent does | Defeated by |
|---|---|---|
| **Corner camping / idling** | sit still, never engage | `−0.01` time cost **plus** the shaping drift `(γ−1)·Φ ≤ 0` keep inaction strictly negative (the non-negative Φ guarantees this — see §4). **Never add a positive survival bonus.** |
| **Lurking / saucer farming** (historical Asteroids exploit) | keep 1 rock alive, farm 1000-pt saucers across the wrap forever | `+10` wave-clear beats farming; time cost taxes the wait; **saucer Δscore capped at 200**. |
| **Spin-to-stall** | rotate forever, never fire | time cost taxes it; drifting rocks eventually force a `−10` death. Rotation itself is correctly free. |
| **Pacifism** | avoid combat to never die | time cost + the ≤0 shaping drift make not-clearing strictly worse; no positive idle term to harvest. |
| **Single-rock re-farming** | re-create splits to farm | splitting raises N → negative PBRS bump; small rocks pay most, so finishing dominates. |
| **Hyperspace spam** | teleport to dodge instead of aiming | `−0.3`/use; net positive only when it averts a real `−10` death. |
| **Wrap-camping a fragment** | keep one slow fragment alive for "shaping income" | there is none — at constant N the shaping drift is ≤0; only clearing the last rock (N→0) collects the big Φ jump, and `w_clear` pays only at N=0. |

---

## 6. Browser game (PLAY mode now; policy replay later)

JS owns the clock via `requestAnimationFrame` + a fixed-timestep accumulator (`DT=1/60`, `MAX_ACC` clamp ~5 steps to survive tab stalls). **Never** use Pyodide's asyncio loop for pacing. The Python `step` callable is fetched **once** at boot and cached — never `runPython(str)` per frame.

**Boundary per frame.**
- **In:** one integer bitmask `bits` (left=1, right=2, thrust=4, fire=8, hyperspace=16). Near-zero FFI cost.
- **Out:** one flat `array.array('d')` → JS `Float64Array` (single copy). Layout: `[score, game_over, then 5 floats per entity: (kind, x, y, angle, radius)]`. The only retained `PyProxy` is the game handle; switching ship-count/preset constructs a fresh game and `.destroy()`s the old proxy.

**Frame-buffer schema (frozen in CONTRACT.md):** `buf[0] = score`, `buf[1] = game_over` (0.0/1.0); entities begin at index 2 at 5 floats each, so `n_entities = (len(buf) − 2) / 5`. The integer `kind` code:

| kind | entity | kind | entity |
|---|---|---|---|
| 0 | ship | 3 | asteroid L |
| 1 | ship (invuln / blinking) | 4 | asteroid M |
| 2 | bullet | 5 | asteroid S |

`6 = UFO` is reserved for the roadmap. `renderer.js` switches purely on `kind` and holds no game logic; `test_render` pins this map.

**Controls:** ←/→ rotate, ↑ thrust, Space fire, Shift (or a touch button) hyperspace. Synthetic button codes let touch arcade buttons feed the same held-key set.

**Buttons:** **PLAY** is built now (keyboard supplies bits). **LOAD AI** and **AGENT VIEW** are **deferred** (they require a trained policy); their slots/UI may be stubbed/hidden until policy replay is implemented.

### Policy JSON schema (documented now, implemented later)

Recorded here so the env/obs pipeline stays compatible; **not built in this scope.** `mlp-tanh-argmax/v1`, dependency-free; `W[o][i]` row-major out×in so `y[o]=b[o]+Σ_i W[o][i]·x[i]`; `obs_norm` applied before layer 0 as `x=clip((raw−mean)/std, −clip, +clip)`; the 9-logit head is split `[3,2,2,2]` and arg-maxed per factor (ties → lowest index).

```json
{
  "format": "asteroidhunter.policy", "version": 1,
  "obs_dim": 100, "act_dim": 4, "action_type": "multidiscrete", "nvec": [3,2,2,2],
  "obs_norm": { "mean": ["…100"], "std": ["…100"], "clip": 5.0 },
  "layers": [
    { "in": 100, "out": 64, "activation": "tanh", "W": ["…64×100"], "b": ["…64"] },
    { "in": 64,  "out": 64, "activation": "tanh", "W": ["…64×64"],  "b": ["…64"] },
    { "in": 64,  "out": 9,  "activation": "identity", "W": ["…9×64"], "b": ["…9"] }
  ],
  "output": "factored_argmax", "factor_sizes": [3,2,2,2]
}
```

---

## 7. Repository layout (mirrors MultiLander)

```
.github/workflows/pages.yml      pytest gate + build wheel + deploy web/ to Pages
.gitignore                       ignore .venv, caches, web/assets/*.whl
README.md                        project overview (ASCII ship art + tagline)
pyproject.toml                   hatchling; name=asteroidhunter; [env]=gymnasium+numpy; [marl] extra (deferred)=pettingzoo
docs/
  CONTRACT.md                    frozen Py⇄JS interface (boundary, obs, action, frame schema, policy)
  superpowers/specs/2026-06-21-asteroidhunter-design.md   this spec
examples/
  README.md                      (later) how to run training + LOAD AI flow
scripts/
  build_web.sh                   python -m build --wheel → web/assets/*.whl
  serve.sh                       python -m http.server 8000 --directory web
src/asteroidhunter/
  __init__.py                    __version__; lazy gymnasium.register("AsteroidHunter-v0")
  config.py                      frozen Config dataclass + PRESETS (rookie/pilot/ace)
  env.py                         AsteroidHunterEnv (single-agent); ONLY file importing gym/numpy  (ParallelEnv → MARL roadmap)
  core/
    __init__.py                  pure-stdlib marker
    physics.py                   ShipState/BulletState/AsteroidState + step(); sin/cos lookup table
    field.py                     seeded wave generation
    world.py                     AsteroidHunterCore: N-ship state machine + dict-of-agents reset/step
    view.py                      pack_render → array('d'); obs_vector → list[float] (shared builder)
    browser.py                   Pyodide entry: new_game/step (ai_step deferred)
tests/                           (see §8)
web/
  index.html                     canvas + controls + Pyodide <script>
  app.js                         boot, 60 Hz accumulator loop, input bitmask, Python boundary
  renderer.js                    pure canvas painting, no game logic
  vectorfont.js                  Atari stroke font, no game logic
  docs.html                      same-theme in-browser manual

# deferred to roadmap: core/policy.py, core/autopilot.py (attract-mode pilot), env.py ParallelEnv,
# examples/train_template.py, train/, web LOAD-AI/AGENT-VIEW wiring
```

---

## 8. Testing strategy

| Test file | Pins |
|---|---|
| `test_physics.py` | rotation rate, thrust accel, drag, max-speed clamp, screen-wrap, bullet lifetime, inertia inheritance |
| `test_field.py` | same seed → byte-identical field; wave count `min(4+2(n−1),11)`; edge-spawn-away-from-ship; size/speed bounds |
| `test_game.py` | state machine, split L→2M→2S, scoring 20/50/100, wave-clear, hyperspace death-prob bounds, respawn invuln window, terminal no-op, frame schema, scripted-sequence determinism |
| `test_obs.py` | `OBS_DIM=100` + formula; **every field ∈ [−1,1]** incl. `lives_norm` after extra-life accrual and fast (inherited-velocity) bullets; padding (`present` flag); threat-sort stability; `cooldown_norm`/`V_NORM`/`MAX_LIVES_NORM` correctness |
| `test_env.py` | `check_env`; Box/MultiDiscrete shapes; `make("AsteroidHunter-v0")`; seed reproducibility; terminated vs truncated; subprocess test that `import asteroidhunter` does NOT import numpy |
| `test_presets.py` | exact rookie/pilot/ace values + plumbing |
| `test_parity.py` | **golden-hash:** scripted actions → SHA-256 of packed `(x,y,angle)` bits; run natively in CI **and** in a headless `node`+Pyodide harness; assert identical hash |
| `test_render.py` | frame-buffer schema: `kind` code map, `game_over` ∈ {0,1}, `n_entities = (len−2)/5` |
| `test_multi.py` *(roadmap)* | N-ship collisions, dict-of-agents step, mid-episode death, order-independence |

CI runs `pytest -q` as a deploy gate. Determinism asserted as byte-identical output; purity asserted by spawning a fresh interpreter via `subprocess` and inspecting `sys.modules`.

---

## 9. Build phases

**Phase 0 — Scaffold.** Repo tree, `pyproject.toml` (`py3-none-any`), lazy registration, empty pure-stdlib `core/`, CI skeleton. *Done:* `import asteroidhunter` works and pulls in no numpy (subprocess test green).

**Phase 1 — Physics core.** `physics.py` + `field.py` + `world.py`: ship (rotate/thrust/drag/max-speed/wrap), 4-cap bullets, hyperspace, asteroids splitting L→M→S, waves, lives, scoring, respawn invuln. Sin/cos lookup table. *Done:* `test_physics`/`test_field`/`test_game` green; a scripted run is byte-identical across two invocations.

**Phase 2 — RL environment.** `env.py` single-agent adapter, `view.obs_vector` (100-dim), reward (§4), termination/truncation, info with `true_score`, seeding, `config.py` presets. *Done:* `check_env` passes; seed reproducibility holds; `test_env`/`test_obs`/`test_presets` green.

**Phase 3 — Browser game.** `browser.py` (`new_game`/`step`, int-bits in / float-buffer out), `web/app.js` RAF accumulator, `renderer.js` vector drawing, `vectorfont.js`, `index.html`. Build wheel → `web/assets/`. *Done:* human-playable at 60 Hz on Pages; `test_parity` golden hash matches native↔Pyodide.

### Roadmap (after this build)

- **Training enablement:** `core/policy.py` forward pass, `examples/train_template.py` (incl. a `(1+1)` hill-climb baseline) + JSON policy export, and browser **LOAD AI / AGENT VIEW** replay (the AI runs *in Pyodide* so it sees the exact training obs pipeline).
- **Fast-follow — UFO:** saucer entity (large 200 / small 1000; size 1.5 / 0.75 sl; horizontal traverse; spawn interval shrinks with score, floor 32 ticks; small-saucer aim narrows with score). Flip `include_ufo=True` → OBS_DIM 108; saucer reward capped at 200. Seeds the ships-vs-UFO MARL mode.
- **Fast-follow — MARL:** activate `AsteroidHunterParallelEnv` with `mode ∈ {coop, versus}`. Co-op: team-shared score/wave/death, per-agent PBRS over shared `N_total`. Versus: zero-sum, ship-ship collisions on, last-ship-standing ends it. Obs adds `8·(n−1)` other-ship block.
- **Attract mode:** `core/autopilot.py`, a deterministic rule-based demo pilot for the title screen (no training needed).

---

## 10. Resolved decisions (from design review)

- Hyperspace death model: **count-scaled** `clamp(0.05 + 0.01·N, 0.05, 0.40)` — a deliberately **softened** floor; the authentic arcade baseline is ≈25% (open for you to make it more brutal).
- Own bullets in obs: **excluded** (obs = 100 dims).
- Saucer reward: **capped at 200** (defeats lurking) — relevant when UFO lands.
- `max_steps`: **2000**.
- Respawn invulnerability: **120 ticks (2 s)**, surfaced via `invuln_flag`.
- Difficulty presets: **rookie / pilot / ace** (default `pilot`).
- Policy head: **single 9-logit head** split `[3,2,2,2]` (relevant when training lands).
- Build scope: **game + env only**; training, policy export, and policy replay are deferred (§0).

*Spec-review fixes (2026-06-21):* bullet lifetime set to **75 ticks** (full-screen shot); reward potential made **non-negative** `Φ = 0.3·(27 − N)` to fix an idling-drift sign bug; defined normalization constants **`V_NORM=34`, `MAX_LIVES_NORM=10`, `D≈0.833`, `BULLET_LIFE=75`** and the `cooldown` meaning (all obs fields now provably ∈ [−1,1]); added the render **`kind`-code map** + frame schema; specified **`reset()` semantics** and the `episode_step` truncation boundary; corrected the thrust/drag annotations; and scoped **ParallelEnv/pettingzoo as deferred** (single-agent env only now, `marl` extra).
