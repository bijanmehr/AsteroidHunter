/* Renderer — pure canvas painting from the Python frame buffer. No game logic.
 *
 * Buffer: [ score, game_over, wave, lives,  then 6 per entity: kind,x,y,angle,radius,flags ]
 *   kind: 0 ship | 2 bullet | 3 asteroid-L | 4 asteroid-M | 5 asteroid-S | 6 UFO
 *   ship flags: bit0 thrusting, bit1 invuln ; asteroid flags: silhouette index
 *
 * Style targets the original 1979 vector look: thin white strokes, sharp
 * (mitered) corners, a slender ship with a concave engine notch, and craggy
 * angular rocks.
 */
(function () {
  "use strict";

  const HEADER = 4;
  const STRIDE = 6;
  const PHOS = "#ffffff";

  // Ship outline in local coords (fx = forward/along-heading, fy = sideways),
  // in units of the ship radius. Order draws the two hull sides then the
  // concave rear notch (the classic engine cut-out).
  const SHIP = [
    [-0.42, -0.40], // rear left
    [0.62, 0.0],    // nose
    [-0.42, 0.40],  // rear right
    [-0.20, 0.0],   // rear notch (forward of the corners -> concave)
  ];
  const FLAME = [
    [-0.20, -0.22],
    [-0.66, 0.0],
    [-0.20, 0.22],
  ];

  // Craggy rock silhouettes: radius multipliers around the circle (deep notches
  // + sharp miter joins read as angular vector rocks, not smooth blobs).
  const SHAPES = [
    [1.0, 0.86, 0.62, 0.92, 0.5, 0.84, 1.0, 0.58, 0.9, 1.0, 0.48, 0.8],
    [0.7, 1.0, 0.84, 0.5, 0.9, 1.0, 0.6, 0.95, 0.46, 0.86, 1.0, 0.72],
    [1.0, 0.6, 0.9, 1.0, 0.5, 0.82, 0.95, 0.55, 1.0, 0.7, 0.9, 0.5],
    [0.56, 0.9, 1.0, 0.64, 0.95, 0.5, 0.86, 1.0, 0.6, 0.9, 0.46, 1.0],
  ];

  function poly(ctx, pts, close) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (close) ctx.closePath();
    ctx.stroke();
  }

  // local (fx,fy) -> world pixel, given center, heading a, scale r
  function L(x, y, a, r, fx, fy) {
    const c = Math.cos(a), s = Math.sin(a);
    return [x + (fx * c - fy * s) * r, y + (fx * s + fy * c) * r];
  }

  // Replicate a draw across torus edges when near a border.
  function wrapped(ctx, x, y, r, cw, ch, fn) {
    const ox = x < r ? cw : x > cw - r ? -cw : 0;
    const oy = y < r ? ch : y > ch - r ? -ch : 0;
    fn(x, y);
    if (ox) fn(x + ox, y);
    if (oy) fn(x, y + oy);
    if (ox && oy) fn(x + ox, y + oy);
  }

  function ship(ctx, x, y, a, r, flags, frame) {
    if ((flags & 2) && Math.floor(frame / 6) % 2 === 0) return; // invuln blink
    if ((flags & 1) && Math.floor(frame / 2) % 2 === 0) {       // thrust flame flicker
      poly(ctx, FLAME.map((p) => L(x, y, a, r, p[0], p[1])), false);
    }
    poly(ctx, SHIP.map((p) => L(x, y, a, r, p[0], p[1])), true);
  }

  function asteroid(ctx, x, y, spin, r, shapeIdx) {
    const s = SHAPES[(((shapeIdx | 0) % SHAPES.length) + SHAPES.length) % SHAPES.length];
    const n = s.length, step = (Math.PI * 2) / n;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const ang = spin + i * step;
      pts.push([x + Math.cos(ang) * r * s[i], y + Math.sin(ang) * r * s[i]]);
    }
    poly(ctx, pts, true);
  }

  function bullet(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.4, r), 0, Math.PI * 2);
    ctx.fill();
  }

  function hud(ctx, cw, ch, score, wave, lives) {
    const VF = window.VectorFont;
    const h = Math.round(ch * 0.045);
    if (VF) {
      VF.drawText(ctx, String(score).padStart(2, "0"), Math.round(cw * 0.025), Math.round(ch * 0.03), h, { color: PHOS });
      const wtxt = "WAVE " + wave;
      VF.drawText(ctx, wtxt, cw - VF.measure(wtxt, h) - cw * 0.025, ch * 0.03, h, { color: PHOS });
    }
    const r = ch * 0.028;
    for (let i = 0; i < lives; i++) {
      ctx.save();
      ctx.lineWidth = Math.max(1, ch * 0.003);
      ship(ctx, cw * 0.03 + r + i * r * 1.7, ch * 0.115, -Math.PI / 2, r, 0, 0);
      ctx.restore();
    }
  }

  function center(ctx, cw, ch, big, small) {
    const VF = window.VectorFont;
    if (!VF) return;
    VF.drawText(ctx, big, cw / 2, ch * 0.4, Math.round(ch * 0.085), { align: "center", color: PHOS });
    if (small) VF.drawText(ctx, small, cw / 2, ch * 0.55, Math.round(ch * 0.04), { align: "center", color: PHOS });
  }

  const Renderer = {
    draw(ctx, buf, W, H, frame, attract) {
      const cw = ctx.canvas.width, ch = ctx.canvas.height;
      const S = cw / W; // world->pixel (canvas matches world aspect, so no distortion)
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);
      if (!buf || buf.length < HEADER) return;

      const score = buf[0] | 0, gameOver = buf[1] > 0.5, wave = buf[2] | 0, lives = buf[3] | 0;

      ctx.save();
      ctx.strokeStyle = PHOS;
      ctx.fillStyle = PHOS;
      ctx.lineWidth = Math.max(1, ch * 0.003);
      ctx.lineJoin = "miter";
      ctx.miterLimit = 3;
      ctx.lineCap = "round";
      ctx.shadowColor = PHOS;
      ctx.shadowBlur = Math.max(1, ch * 0.0035);

      for (let i = HEADER; i + STRIDE <= buf.length; i += STRIDE) {
        const kind = buf[i] | 0;
        if (attract && kind < 3) continue; // attract backdrop: drifting rocks only
        const x = buf[i + 1] * S, y = buf[i + 2] * S;
        const ang = buf[i + 3], r = buf[i + 4] * S, flags = buf[i + 5];
        if (kind === 0) {
          wrapped(ctx, x, y, r, cw, ch, (px, py) => ship(ctx, px, py, ang, r, flags, frame));
        } else if (kind === 2) {
          wrapped(ctx, x, y, r, cw, ch, (px, py) => bullet(ctx, px, py, r));
        } else if (kind >= 3 && kind <= 5) {
          wrapped(ctx, x, y, r, cw, ch, (px, py) => asteroid(ctx, px, py, ang, r, flags));
        }
      }
      ctx.restore();

      if (!attract) {
        ctx.save();
        ctx.strokeStyle = PHOS;
        ctx.fillStyle = PHOS;
        ctx.lineJoin = "miter";
        ctx.lineCap = "round";
        ctx.shadowColor = PHOS;
        ctx.shadowBlur = Math.max(1, ch * 0.003);
        hud(ctx, cw, ch, score, wave, lives);
        if (gameOver) center(ctx, cw, ch, "GAME OVER", "PRESS R FOR MENU");
        ctx.restore();
      }
    },
  };

  window.Renderer = Renderer;
})();
