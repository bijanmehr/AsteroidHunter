/* app.js — boots Pyodide, loads the pure-Python core, runs the fixed-timestep
 * loop, feeds input as one integer bitmask, and draws the returned buffer.
 * The canvas fills the viewport; the world's aspect ratio matches the screen
 * (it's a torus), so there is no letterbox and no distortion, on any device.
 */
(function () {
  "use strict";

  const STEP = 1 / 60;
  const MAX_ACC = 0.25;
  const BIT = { LEFT: 1, RIGHT: 2, THRUST: 4, FIRE: 8, HYPER: 16 }; // match core/browser.py

  const PKG_FILES = [
    "__init__.py", "config.py",
    "core/__init__.py", "core/physics.py", "core/field.py",
    "core/world.py", "core/view.py", "core/browser.py",
  ];
  const SRC_BASE = "../src/asteroidhunter/"; // served from repo root, page at /web/

  const canvas = document.getElementById("screen");
  const ctx = canvas.getContext("2d");
  const statusEl = document.getElementById("status");
  function setStatus(t) { if (statusEl) statusEl.textContent = t || ""; }

  let browser = null, game = null, lastData = null, frame = 0;
  let worldW = 4 / 3; // world width in units (H is always 1); = canvas aspect

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    worldW = canvas.width / canvas.height;
    if (browser && game) browser.set_aspect(game, worldW);
    if (lastData) Renderer.draw(ctx, lastData, worldW, 1, frame);
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();

  // ---- input -------------------------------------------------------------
  let bits = 0;
  let pendingHyper = false; // hyperspace is edge-triggered (one jump per press)
  let pendingFire = false;  // keyboard fire is edge-triggered (one shot per press)
  let wantRestart = false;
  const KEYS = {
    ArrowLeft: BIT.LEFT, KeyA: BIT.LEFT,
    ArrowRight: BIT.RIGHT, KeyD: BIT.RIGHT,
    ArrowUp: BIT.THRUST, KeyW: BIT.THRUST,
  };
  window.addEventListener("keydown", (e) => {
    if (e.code in KEYS) { bits |= KEYS[e.code]; e.preventDefault(); }
    if (e.code === "Space" && !e.repeat) { pendingFire = true; e.preventDefault(); }
    if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.repeat) { pendingHyper = true; e.preventDefault(); }
    if (e.code === "KeyR") { wantRestart = true; e.preventDefault(); }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code in KEYS) { bits &= ~KEYS[e.code]; e.preventDefault(); }
  });

  document.querySelectorAll("[data-bit]").forEach((el) => {
    const name = el.getAttribute("data-bit");
    if (name === "HYPER") {
      const pulse = (e) => { pendingHyper = true; e.preventDefault(); };
      el.addEventListener("touchstart", pulse, { passive: false });
      el.addEventListener("mousedown", pulse);
      return;
    }
    const b = BIT[name];
    const on = (e) => { bits |= b; e.preventDefault(); };
    const off = (e) => { bits &= ~b; e.preventDefault(); };
    el.addEventListener("touchstart", on, { passive: false });
    el.addEventListener("touchend", off, { passive: false });
    el.addEventListener("touchcancel", off, { passive: false });
    el.addEventListener("mousedown", on);
    el.addEventListener("mouseup", off);
    el.addEventListener("mouseleave", off);
  });
  document.querySelectorAll('[data-action="restart"]').forEach((el) => {
    const fn = (e) => { wantRestart = true; e.preventDefault(); };
    el.addEventListener("touchstart", fn, { passive: false });
    el.addEventListener("mousedown", fn);
  });

  // ---- boot --------------------------------------------------------------
  function readBuffer(retProxy) {
    const pb = retProxy.getBuffer("f64");
    const data = pb.data.slice();
    pb.release();
    retProxy.destroy();
    return data;
  }

  function newGame() {
    if (game) { game.destroy(); game = null; }
    game = browser.new_game("pilot", (Math.random() * 1e9) | 0, 1, worldW);
    lastData = readBuffer(browser.render(game));
    frame = 0;
  }

  async function boot() {
    setStatus("loading pyodide…");
    const pyodide = await loadPyodide();
    setStatus("loading game core…");
    pyodide.FS.mkdirTree("/game/asteroidhunter/core");
    for (const f of PKG_FILES) {
      const res = await fetch(SRC_BASE + f);
      if (!res.ok) throw new Error("fetch failed: " + SRC_BASE + f + " (" + res.status + ")");
      pyodide.FS.writeFile("/game/asteroidhunter/" + f, await res.text());
    }
    pyodide.runPython("import sys; sys.path.insert(0, '/game')");
    browser = pyodide.pyimport("asteroidhunter.core.browser");
    newGame();
    setStatus("");

    let last = performance.now(), acc = 0;
    function loop(now) {
      acc = Math.min(MAX_ACC, acc + (now - last) / 1000);
      last = now;
      if (wantRestart) { wantRestart = false; newGame(); acc = 0; }
      while (acc >= STEP) {
        const sbits = bits | (pendingHyper ? BIT.HYPER : 0) | (pendingFire ? BIT.FIRE : 0);
        pendingHyper = false;
        pendingFire = false;
        lastData = readBuffer(browser.step(game, sbits));
        acc -= STEP;
        frame++;
      }
      Renderer.draw(ctx, lastData, worldW, 1, frame);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  boot().catch((err) => {
    console.error(err);
    setStatus("error: " + err.message + " — open the console.");
  });
})();
