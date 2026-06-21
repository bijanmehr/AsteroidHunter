/*
 * vectorfont.js — self-contained, dependency-free vector (stroke) font.
 *
 * Styled after the 1979 Atari Asteroids vector font: thin white strokes on
 * black. Plain browser script (NO ES modules, NO external dependencies).
 * Exposes a single global: window.VectorFont
 *
 * Public API:
 *   VectorFont.drawText(ctx, text, x, y, height, opts)
 *   VectorFont.measure(text, height, opts)
 *
 * Glyphs are defined on a normalized grid:
 *   gx in [0, 0.6]  (glyph drawing width)
 *   gy in [0, 1]    (cell height; gy = 0 is the TOP of the cell)
 * Each glyph is an array of strokes; each stroke is an array of [gx, gy]
 * points rendered as a single polyline (moveTo / lineTo ... stroke).
 */
(function (global) {
  'use strict';

  // Drawing width of a glyph on the normalized grid. The full monospaced
  // advance is W plus letterSpacing; glyph cell height is normalized to 1.
  var W = 0.6;

  // Convenience corner / midpoint coordinates on the grid.
  var L = 0.0;        // left edge
  var R = W;          // right edge (0.6)
  var CX = W / 2;     // horizontal center (0.3)
  var T = 0.0;        // top
  var B = 1.0;        // bottom
  var CY = 0.5;       // vertical center

  // ---------------------------------------------------------------------------
  // Glyph definitions.
  // Each entry maps a character to an array of strokes (polylines).
  // ---------------------------------------------------------------------------
  var GLYPHS = {};

  // ----- Letters A-Z ---------------------------------------------------------

  GLYPHS['A'] = [
    [[L, B], [CX, T], [R, B]],          // the two diagonals forming the peak
    [[0.12, 0.62], [0.48, 0.62]]        // crossbar
  ];

  GLYPHS['B'] = [
    [[L, T], [L, B]],                                   // left spine
    [[L, T], [0.42, T], [R, 0.16], [0.42, CY], [L, CY]],// upper bowl
    [[L, CY], [0.45, CY], [R, 0.7], [0.42, B], [L, B]]  // lower bowl
  ];

  GLYPHS['C'] = [
    [[R, 0.18], [0.42, T], [0.18, T], [L, 0.18], [L, 0.82], [0.18, B], [0.42, B], [R, 0.82]]
  ];

  GLYPHS['D'] = [
    [[L, T], [L, B]],                                   // left spine
    [[L, T], [0.36, T], [R, 0.28], [R, 0.72], [0.36, B], [L, B]] // bowl
  ];

  GLYPHS['E'] = [
    [[R, T], [L, T], [L, B], [R, B]],   // top, left spine, bottom
    [[L, CY], [0.46, CY]]               // middle bar
  ];

  GLYPHS['F'] = [
    [[R, T], [L, T], [L, B]],           // top bar + left spine
    [[L, CY], [0.46, CY]]              // middle bar
  ];

  GLYPHS['G'] = [
    [[R, 0.18], [0.42, T], [0.18, T], [L, 0.18], [L, 0.82], [0.18, B], [0.42, B], [R, 0.82], [R, 0.56], [0.34, 0.56]]
  ];

  GLYPHS['H'] = [
    [[L, T], [L, B]],                  // left spine
    [[R, T], [R, B]],                  // right spine
    [[L, CY], [R, CY]]                 // crossbar
  ];

  GLYPHS['I'] = [
    [[L, T], [R, T]],                  // top serif
    [[CX, T], [CX, B]],               // stem
    [[L, B], [R, B]]                  // bottom serif
  ];

  GLYPHS['J'] = [
    [[R, T], [R, 0.8], [0.42, B], [0.18, B], [L, 0.8], [L, 0.66]]
  ];

  GLYPHS['K'] = [
    [[L, T], [L, B]],                  // left spine
    [[R, T], [L, CY]],                 // upper diagonal into spine
    [[0.16, 0.42], [R, B]]            // lower diagonal out
  ];

  GLYPHS['L'] = [
    [[L, T], [L, B], [R, B]]
  ];

  GLYPHS['M'] = [
    [[L, B], [L, T], [CX, 0.4], [R, T], [R, B]]
  ];

  GLYPHS['N'] = [
    [[L, B], [L, T], [R, B], [R, T]]
  ];

  GLYPHS['O'] = [
    // Plain rounded rectangle ring, NO slash (disambiguated from 0).
    [[0.18, T], [0.42, T], [R, 0.18], [R, 0.82], [0.42, B], [0.18, B], [L, 0.82], [L, 0.18], [0.18, T]]
  ];

  GLYPHS['P'] = [
    [[L, B], [L, T], [0.42, T], [R, 0.16], [0.42, CY], [L, CY]]
  ];

  GLYPHS['Q'] = [
    [[0.18, T], [0.42, T], [R, 0.18], [R, 0.82], [0.42, B], [0.18, B], [L, 0.82], [L, 0.18], [0.18, T]], // ring
    [[0.36, 0.72], [R, B]]            // tail
  ];

  GLYPHS['R'] = [
    [[L, B], [L, T], [0.42, T], [R, 0.16], [0.42, CY], [L, CY]], // bowl + spine
    [[0.3, CY], [R, B]]              // leg
  ];

  GLYPHS['S'] = [
    // Classic S approximated with segments (top curve down, then bottom curve).
    [[R, 0.18], [0.42, T], [0.18, T], [L, 0.18], [L, 0.4], [0.18, CY], [0.42, CY], [R, 0.6], [R, 0.82], [0.42, B], [0.18, B], [L, 0.82]]
  ];

  GLYPHS['T'] = [
    [[L, T], [R, T]],                 // top bar
    [[CX, T], [CX, B]]               // stem
  ];

  GLYPHS['U'] = [
    [[L, T], [L, 0.78], [0.18, B], [0.42, B], [R, 0.78], [R, T]]
  ];

  GLYPHS['V'] = [
    [[L, T], [CX, B], [R, T]]
  ];

  GLYPHS['W'] = [
    [[L, T], [0.14, B], [CX, 0.5], [0.46, B], [R, T]]
  ];

  GLYPHS['X'] = [
    [[L, T], [R, B]],
    [[R, T], [L, B]]
  ];

  GLYPHS['Y'] = [
    [[L, T], [CX, CY], [R, T]],       // upper V
    [[CX, CY], [CX, B]]              // stem
  ];

  GLYPHS['Z'] = [
    [[L, T], [R, T], [L, B], [R, B]]
  ];

  // ----- Digits 0-9 ----------------------------------------------------------

  GLYPHS['0'] = [
    // Same ring as O, WITH a slash to disambiguate from the letter O.
    [[0.18, T], [0.42, T], [R, 0.18], [R, 0.82], [0.42, B], [0.18, B], [L, 0.82], [L, 0.18], [0.18, T]],
    [[L, 0.82], [R, 0.18]]           // slash
  ];

  GLYPHS['1'] = [
    [[0.16, 0.2], [CX, T], [CX, B]], // flag + stem
    [[0.14, B], [0.46, B]]           // base
  ];

  GLYPHS['2'] = [
    [[L, 0.18], [0.18, T], [0.42, T], [R, 0.18], [R, 0.36], [L, B], [R, B]]
  ];

  GLYPHS['3'] = [
    [[L, 0.16], [0.18, T], [0.42, T], [R, 0.16], [0.36, CY], [R, 0.6], [R, 0.82], [0.42, B], [0.18, B], [L, 0.84]]
  ];

  GLYPHS['4'] = [
    [[0.42, B], [0.42, T], [L, 0.62], [R, 0.62]]
  ];

  GLYPHS['5'] = [
    [[R, T], [L, T], [L, 0.46], [0.42, 0.42], [R, 0.6], [R, 0.82], [0.42, B], [0.18, B], [L, 0.82]]
  ];

  GLYPHS['6'] = [
    [[R, 0.16], [0.42, T], [0.18, T], [L, 0.18], [L, 0.82], [0.18, B], [0.42, B], [R, 0.82], [R, 0.6], [0.42, 0.46], [0.18, 0.46], [L, 0.58]]
  ];

  GLYPHS['7'] = [
    [[L, T], [R, T], [0.24, B]]
  ];

  GLYPHS['8'] = [
    [[0.3, T], [0.18, T], [L, 0.16], [0.18, CY], [0.42, CY], [R, 0.16], [0.42, T], [0.18, T]], // upper loop
    [[0.18, CY], [L, 0.66], [0.18, B], [0.42, B], [R, 0.66], [0.42, CY]]                       // lower loop
  ];

  GLYPHS['9'] = [
    [[L, 0.84], [0.18, B], [0.42, B], [R, 0.82], [R, 0.18], [0.42, T], [0.18, T], [L, 0.18], [L, 0.4], [0.18, 0.54], [0.42, 0.54], [R, 0.42]]
  ];

  // ----- Punctuation ---------------------------------------------------------

  GLYPHS[' '] = [];                    // space: blank advance, no strokes

  GLYPHS['.'] = [
    [[0.28, 0.92], [0.32, 0.92]]      // small dot near baseline
  ];

  GLYPHS[':'] = [
    [[0.28, 0.32], [0.32, 0.32]],     // upper dot
    [[0.28, 0.72], [0.32, 0.72]]      // lower dot
  ];

  GLYPHS['-'] = [
    [[0.14, CY], [0.46, CY]]          // horizontal dash
  ];

  GLYPHS['/'] = [
    [[L, B], [R, T]]                  // forward slash
  ];

  GLYPHS['!'] = [
    [[CX, T], [CX, 0.66]],            // stem
    [[CX, 0.9], [CX, 0.92]]           // dot
  ];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // Normalize a single character to a key present in GLYPHS, or null.
  function glyphFor(ch) {
    if (ch >= 'a' && ch <= 'z') ch = ch.toUpperCase();
    return Object.prototype.hasOwnProperty.call(GLYPHS, ch) ? GLYPHS[ch] : null;
  }

  // The monospaced horizontal advance (in pixels) for a single glyph, given
  // the cell height and per-character letter spacing.
  function advance(height, letterSpacing) {
    return W * height + letterSpacing;
  }

  // Resolve options with defaults.
  function resolveOpts(height, opts) {
    opts = opts || {};
    return {
      align: opts.align || 'left',
      color: opts.color != null ? opts.color : '#fff',
      lineWidth: opts.lineWidth != null ? opts.lineWidth : Math.max(1, height * 0.08),
      letterSpacing: opts.letterSpacing != null ? opts.letterSpacing : height * 0.28
    };
  }

  // ---------------------------------------------------------------------------
  // Measure: total pixel width for a string (monospaced advance per char).
  // The final character does NOT contribute a trailing letterSpacing gap.
  // ---------------------------------------------------------------------------
  function measure(text, height, opts) {
    if (text == null) return 0;
    text = String(text);
    var o = resolveOpts(height, opts);
    var n = text.length;
    if (n === 0) return 0;
    // n glyph widths + (n - 1) inter-character gaps.
    return n * (W * height) + (n - 1) * o.letterSpacing;
  }

  // ---------------------------------------------------------------------------
  // drawText: render a string of stroke glyphs.
  // ---------------------------------------------------------------------------
  function drawText(ctx, text, x, y, height, opts) {
    if (ctx == null || text == null) return;
    text = String(text);
    var o = resolveOpts(height, opts);

    // Resolve alignment by measuring total width first.
    var startX = x;
    if (o.align === 'center') {
      startX = x - measure(text, height, opts) / 2;
    } else if (o.align === 'right') {
      startX = x - measure(text, height, opts);
    }

    ctx.save();
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var penX = startX;
    var step = advance(height, o.letterSpacing); // glyph width + spacing

    for (var i = 0; i < text.length; i++) {
      var strokes = glyphFor(text.charAt(i));
      if (strokes && strokes.length) {
        for (var s = 0; s < strokes.length; s++) {
          var pts = strokes[s];
          if (!pts || pts.length === 0) continue;
          ctx.beginPath();
          for (var p = 0; p < pts.length; p++) {
            var px = penX + pts[p][0] * height; // gx scaled by height (gx already <= 0.6)
            var py = y + pts[p][1] * height;    // gy scaled by height; y is top of cell
            if (p === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }
      // Unknown chars (and space) simply advance, drawing nothing.
      penX += step;
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  global.VectorFont = {
    drawText: drawText,
    measure: measure,
    // Exposed for inspection/testing; not required by the public contract.
    glyphs: GLYPHS,
    width: W
  };

})(typeof window !== 'undefined' ? window : this);
