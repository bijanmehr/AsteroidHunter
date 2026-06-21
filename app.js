/* app.js — boots Pyodide, loads the pure-Python core, runs the fixed-timestep
 * loop, and drives the title screen / difficulty select / play / attract states.
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
  const SRC_BASE = "src/asteroidhunter/"; // page lives at repo root; src/ is a sibling

  const canvas = document.getElementById("screen");
  const ctx = canvas.getContext("2d");
  const statusEl = document.getElementById("status");
  const menuPrompt = document.getElementById("menuPrompt");
  function setStatus(t) { if (statusEl) statusEl.textContent = t || ""; }

  let browser = null, game = null, demo = null, lastData = null, frame = 0;
  let state = "menu";       // "menu" (attract) | "play"
  let worldW = 4 / 3;       // world width in units (H is always 1) = canvas aspect

  function setAspectAll() {
    if (!browser) return;
    if (game) browser.set_aspect(game, worldW);
    if (demo) browser.set_aspect(demo, worldW);
  }
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    worldW = canvas.width / canvas.height;
    setAspectAll();
    if (lastData) Renderer.draw(ctx, lastData, worldW, 1, frame, state === "menu");
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();

  // ---- input -------------------------------------------------------------
  let bits = 0, pendingHyper = false, pendingFire = false, wantMenu = false;
  const KEYS = {
    ArrowLeft: BIT.LEFT, KeyA: BIT.LEFT,
    ArrowRight: BIT.RIGHT, KeyD: BIT.RIGHT,
    ArrowUp: BIT.THRUST, KeyW: BIT.THRUST,
  };
  window.addEventListener("keydown", (e) => {
    if (state !== "play") return;
    if (e.code in KEYS) { bits |= KEYS[e.code]; e.preventDefault(); }
    if (e.code === "Space" && !e.repeat) { pendingFire = true; e.preventDefault(); }
    if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && !e.repeat) { pendingHyper = true; e.preventDefault(); }
    if (e.code === "KeyR") { wantMenu = true; e.preventDefault(); }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code in KEYS) { bits &= ~KEYS[e.code]; e.preventDefault(); }
  });

  document.querySelectorAll("#pad [data-bit]").forEach((el) => {
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
  document.querySelectorAll("[data-preset]").forEach((el) => {
    el.addEventListener("click", () => startGame(el.getAttribute("data-preset")));
  });
  document.querySelectorAll('[data-action="menu"]').forEach((el) => {
    el.addEventListener("click", (e) => { e.preventDefault(); wantMenu = true; });
  });

  // ---- helpers -----------------------------------------------------------
  function readBuffer(retProxy) {
    const pb = retProxy.getBuffer("f64");
    const data = pb.data.slice();
    pb.release();
    retProxy.destroy();
    return data;
  }
  const seed = () => (Math.random() * 1e9) | 0;

  function startGame(preset) {
    if (!browser) return;
    if (game) { game.destroy(); game = null; }
    game = browser.new_game(preset, seed(), 1, worldW);
    lastData = readBuffer(browser.render(game));
    frame = 0;
    bits = 0; pendingFire = pendingHyper = wantMenu = false;
    state = "play";
    document.body.classList.add("playing");
  }
  function showMenu(score) {
    state = "menu";
    document.body.classList.remove("playing");
    if (menuPrompt) {
      menuPrompt.innerHTML = (score != null)
        ? "Game over &middot; score <b>" + score + "</b> &mdash; play again"
        : "Select difficulty";
    }
    ensureDemo();
  }
  function ensureDemo() {
    if (!demo && browser) demo = browser.new_game("pilot", seed(), 1, worldW);
  }

  // ---- boot --------------------------------------------------------------
  async function boot() {
    const pyodide = await loadPyodide();
    pyodide.FS.mkdirTree("/game/asteroidhunter/core");
    for (const f of PKG_FILES) {
      const res = await fetch(SRC_BASE + f);
      if (!res.ok) throw new Error("fetch failed: " + SRC_BASE + f + " (" + res.status + ")");
      pyodide.FS.writeFile("/game/asteroidhunter/" + f, await res.text());
    }
    pyodide.runPython("import sys; sys.path.insert(0, '/game')");
    browser = pyodide.pyimport("asteroidhunter.core.browser");

    ensureDemo();
    lastData = readBuffer(browser.render(demo));
    document.body.classList.remove("loading");
    if (menuPrompt) menuPrompt.textContent = "Select difficulty";

    let last = performance.now(), acc = 0;
    function loop(now) {
      acc = Math.min(MAX_ACC, acc + (now - last) / 1000);
      last = now;

      if (state === "play") {
        if (wantMenu) { wantMenu = false; showMenu(); }
        else {
          while (acc >= STEP) {
            const sbits = bits | (pendingHyper ? BIT.HYPER : 0) | (pendingFire ? BIT.FIRE : 0);
            pendingHyper = false; pendingFire = false;
            lastData = readBuffer(browser.step(game, sbits));
            acc -= STEP; frame++;
          }
          if (lastData && lastData[1] > 0.5) showMenu(lastData[0] | 0); // game over -> menu
        }
      }

      if (state === "menu") {           // attract: drifting field behind the title
        while (acc >= STEP) {
          let d = readBuffer(browser.step(demo, 0));
          if (d[1] > 0.5) { demo.destroy(); demo = browser.new_game("pilot", seed(), 1, worldW); d = readBuffer(browser.render(demo)); }
          lastData = d; acc -= STEP; frame++;
        }
        Renderer.draw(ctx, lastData, worldW, 1, frame, true);
      } else {
        Renderer.draw(ctx, lastData, worldW, 1, frame, false);
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  boot().catch((err) => {
    console.error(err);
    setStatus("load error — open the console");
    if (menuPrompt) menuPrompt.textContent = "failed to load :(";
  });
})();
