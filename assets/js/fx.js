/* Menthol burst (P-020 motion). One full-screen canvas, drawn at the screen's pixel density every frame,
 * so rings stay sharp at every size. Fires only when something gets done:
 *   fxBurst(x, y, 1)    all clear (the last missed dose ticked): green out, quick back in, white and gold out with sparks
 *   fxBurst(x, y, .55)  a save (a dose ticked): out, then back in
 *   fxBurst(x, y, .35)  a tab change: a light out and back
 * Small bursts never fire within 1.1s of each other; "reduce motion" turns all of it off. Colours come from tokens.css. */
var FX = (function () {
  var canvas = null, g = null, dpr = 1, effects = [], running = false, lastBurst = -Infinity;
  function still() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function setup() {
    if (canvas) return;
    canvas = document.createElement('canvas'); canvas.id = 'fx'; canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas); g = canvas.getContext('2d'); size();
    window.addEventListener('resize', size);
  }
  function size() { if (!canvas) return; dpr = Math.min(window.devicePixelRatio || 1, 3); canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); }
  function rgb(v) { var d = document.createElement('i'); d.style.color = v; document.body.appendChild(d); var c = getComputedStyle(d).color; d.remove(); return (c.match(/[\d.]+/g) || [0, 0, 0]).map(Number).slice(0, 3); }
  function col(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')'; }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  var ease = {
    out: function (t) { return 1 - Math.pow(1 - t, 3.2); },
    inout: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    quick: function (t) { return t * t * (1.6 - 0.6 * t); }
  };
  // Fade in quickly, hold, then dissipate along a long soft tail.
  function env(p, inEnd, fadeStart) { return smooth(p / inEnd) * (1 - smooth((p - fadeStart) / (1 - fadeStart))); }

  function drawRing(e, p) {
    var r = e.r0 + (e.r1 - e.r0) * ease[e.ease](p), a = e.k * env(p, e.fin, e.fout);
    if (a < 0.003 || r < 1) return;
    var x = e.x * dpr, y = e.y * dpr, R = r * dpr, body = Math.max(6, r * e.body) * dpr, c = e.c;
    var gr = g.createRadialGradient(x, y, Math.max(0, R - body), x, y, R + 3 * dpr);
    gr.addColorStop(0, col(c.mint, 0));
    gr.addColorStop(0.55, col(c.mint, a * 0.14));
    gr.addColorStop(0.86, col(c.main, a * 0.42));
    gr.addColorStop(0.95, col(c.edge, a * 0.95));
    gr.addColorStop(1, col(c.edge, 0));
    g.beginPath(); g.arc(x, y, R + 3 * dpr, 0, Math.PI * 2); g.arc(x, y, Math.max(0, R - body), 0, Math.PI * 2, true);
    g.fillStyle = gr; g.fill();
    g.save(); g.translate(x, y); g.rotate(e.spin + p * e.drift);
    e.crests.forEach(function (cr, i) {
      g.beginPath(); g.arc(0, 0, Math.max(1, R - cr.off * dpr), 0, Math.PI * 2);
      g.lineWidth = cr.w * dpr; g.strokeStyle = col(cr.c, a * cr.a);
      g.setLineDash([cr.dash[0] * dpr, cr.dash[1] * dpr]); g.lineDashOffset = (i * 3 + p * 40) * dpr;
      g.stroke();
    });
    g.restore(); g.setLineDash([]);
  }
  function drawFlash(e, p) {
    var a = e.k * env(p, 0.12, 0.2); if (a < 0.003) return;
    var R = (40 + 120 * ease.out(p)) * dpr, x = e.x * dpr, y = e.y * dpr, c = e.c;
    var gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, col(c.frost, a)); gr.addColorStop(0.3, col(c.mint, a * 0.55)); gr.addColorStop(0.65, col(c.main, a * 0.16)); gr.addColorStop(1, col(c.main, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
  }
  // Plasma bloom where the ring meets itself (owner's pick, "more miasma"): soft clouds drift out and dissolve,
  // a white core blooms, a thin shockwave runs ahead of the gold, and two layers of electric filaments curl and
  // writhe, each fading out along its length. Gradients only (no blur filters), so it stays smooth on a phone.
  function drawNova(e, p) {
    var x = e.x * dpr, y = e.y * dpr, c = e.c, t = p * e.dur;
    // the miasma: soft plasma clouds, slowly drifting outward
    var ca = env(p, 0.08, 0.35);
    if (ca > 0.003) e.clouds.forEach(function (cl) {
      var d = cl.dist * (0.3 + 0.7 * ease.out(p)) * dpr, th = cl.ang + p * cl.spin;
      var cx = x + Math.cos(th) * d, cy = y + Math.sin(th) * d, R = cl.size * (0.7 + 0.5 * ease.out(p)) * dpr;
      var gr = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      gr.addColorStop(0, col(c[cl.c], ca * cl.a)); gr.addColorStop(0.45, col(c[cl.c], ca * cl.a * 0.45)); gr.addColorStop(1, col(c[cl.c], 0));
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    });
    // white-hot core
    var a = env(p, 0.05, 0.22);
    if (a > 0.003) {
      var R0 = (18 + 110 * ease.out(Math.min(1, p * 1.6))) * dpr, gr0 = g.createRadialGradient(x, y, 0, x, y, R0);
      gr0.addColorStop(0, col(c.frost, a)); gr0.addColorStop(0.16, col(c.frost, a * 0.92)); gr0.addColorStop(0.38, col(c.gold, a * 0.5));
      gr0.addColorStop(0.7, col(c.mint, a * 0.14)); gr0.addColorStop(1, col(c.gold, 0));
      g.fillStyle = gr0; g.beginPath(); g.arc(x, y, R0, 0, Math.PI * 2); g.fill();
    }
    // thin shockwave, riding ahead of the gold ring
    var sp = Math.min(1, p / 0.3);
    if (sp < 1) {
      g.beginPath(); g.arc(x, y, (8 + e.reach * 0.8 * ease.out(sp)) * dpr, 0, Math.PI * 2);
      g.lineWidth = 6 * dpr; g.strokeStyle = col(c.gold, (1 - sp) * 0.25); g.stroke();
      g.lineWidth = 1.6 * dpr; g.strokeStyle = col(c.frost, 1 - sp); g.stroke();
    }
    // filaments: long faint wisps behind, shorter bright ones in front; each fades towards its tip
    var fa = env(p, 0.06, 0.5); if (fa < 0.01) return;
    var grow = ease.out(Math.min(1, p * 1.5));
    g.lineCap = 'round';
    e.fils.forEach(function (f) {
      var px = x, py = y;
      for (var s = 1; s <= 14; s++) {
        var u = s / 14, r = f.len * u * grow * dpr;
        var th = f.a + Math.sin(u * 4 + t * 0.008 + f.ph) * 0.3 * u + f.curl * u * u * 0.9;
        var nx = x + Math.cos(th) * r, ny = y + Math.sin(th) * r, aa = fa * f.b * Math.pow(1 - u, 0.8);
        g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny);
        g.lineWidth = (f.b > 0.6 ? 5 : 7) * dpr; g.strokeStyle = col(c.mint, aa * 0.22); g.stroke();
        g.lineWidth = (f.b > 0.6 ? 1.3 : 0.9) * dpr; g.strokeStyle = col(c.frost, aa); g.stroke();
        px = nx; py = ny;
      }
    });
  }
  /* ---------- the Rx finale ----------
   * The ℞ glyph is drawn once off screen and sampled into ~1500 points, each with a little depth. Particles burst out of
   * the centre and spring into the glyph, which turns gently around its upright axis (a perspective projection, so it reads
   * as 3D), shimmers, then falls back into the page: it tips away, shrinks into depth and fades, and a small ripple
   * opens where it lands (owner, 2026-11-27).
   * Light mode draws normally; dark mode adds light (glow), since added light vanishes on a pale page. */
  var rxCache = {};
  function rxPoints(size) {
    size = Math.round(size);
    if (rxCache[size]) return rxCache[size];
    var cv = document.createElement('canvas'), s = size, cx = cv.getContext('2d');
    cv.width = s; cv.height = s;
    var draw = function (txt, font) { cx.clearRect(0, 0, s, s); cx.fillStyle = 'black'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.font = font; cx.fillText(txt, s / 2, s * 0.52); };
    draw('℞', '700 ' + Math.round(s * 0.86) + 'px "Segoe UI Symbol", "Apple Symbols", "Noto Sans Symbols", "DejaVu Sans", serif');
    var data = cx.getImageData(0, 0, s, s).data, filled = 0;
    for (var i = 3; i < data.length; i += 4) if (data[i] > 128) filled++;
    if (filled < s * s * 0.02) { draw('Rx', 'italic 700 ' + Math.round(s * 0.62) + 'px Georgia, serif'); data = cx.getImageData(0, 0, s, s).data; filled = 0; for (i = 3; i < data.length; i += 4) if (data[i] > 128) filled++; }
    var want = 1500, step = Math.max(1, Math.sqrt(filled / want)), pts = [];
    for (var yy = 0; yy < s; yy += step) for (var xx = 0; xx < s; xx += step) {
      var jx = xx + Math.random() * step, jy = yy + Math.random() * step, k = ((jy | 0) * s + (jx | 0)) * 4 + 3;
      if (data[k] > 128) pts.push({ x: jx / s - 0.5, y: jy / s - 0.5, z: (Math.random() - 0.5) * 0.08,
        vx: (Math.random() - 0.5), vy: (Math.random() - 0.5), vz: (Math.random() - 0.5), r: 0.6 + Math.random() * 1.1,
        c: Math.random() < 0.55 ? 'gold' : Math.random() < 0.7 ? 'frost' : 'mint', tw: 6 + Math.random() * 14, ph: Math.random() * 6 });
    }
    rxCache[size] = { size: s, pts: pts };
    return rxCache[size];
  }
  function easeOutBack(t) { var c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function drawRx(e, p) {
    var S = e.pts.size * dpr, cx0 = e.x * dpr, cy0 = e.y * dpr, c = e.c, dark = isDark();
    // phases: 0–.32 burst and gather, .32–.6 hold and turn, .6–1 fall back into the page and fade
    var gather = clamp01(p / 0.32), hold = clamp01((p - 0.32) / 0.28), sink = clamp01((p - 0.6) / 0.4), fall = ease.inout(sink);
    var alpha = smooth(p / 0.06) * (1 - smooth((sink - 0.4) / 0.6));
    if (alpha < 0.004) return;
    var turn = e.spin * (0.55 * (1 - ease.out(gather)) + 0.22 * Math.sin(hold * Math.PI) + 0.2 * fall);
    var cosT = Math.cos(turn), sinT = Math.sin(turn);
    // falling: the top tips away from us (a turn about the level axis) while the whole glyph shrinks into depth
    var tilt = 1.15 * fall, cosX = Math.cos(tilt), sinX = Math.sin(tilt);
    var zoom = 1 - 0.86 * fall, f = 1.6;
    g.save();
    g.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    // soft bloom behind the glyph
    var bloomR = S * 0.62 * zoom, bloom = g.createRadialGradient(cx0, cy0, 0, cx0, cy0, bloomR);
    bloom.addColorStop(0, col(c.gold, alpha * (dark ? 0.28 : 0.2) * (0.6 + 0.4 * gather)));
    bloom.addColorStop(0.45, col(c.mint, alpha * 0.1));
    bloom.addColorStop(1, col(c.main, 0));
    g.fillStyle = bloom; g.beginPath(); g.arc(cx0, cy0, bloomR, 0, Math.PI * 2); g.fill();
    var g1 = easeOutBack(gather), t = p * e.dur;
    for (var i = 0; i < e.pts.pts.length; i++) {
      var q = e.pts.pts[i];
      // burst: start scattered around the centre, spring into place
      var bx = q.vx * 0.9 * (1 - g1), by = q.vy * 0.9 * (1 - g1), bz = q.vz * 0.6 * (1 - g1);
      // as it falls, the points draw in a little and trail behind, like something sinking through water
      var lag = 1 - 0.25 * fall * (0.5 + 0.5 * Math.sin(q.ph));
      var px = (q.x + bx) * lag, py = (q.y + by) * lag, pz = q.z + bz;
      var rx = px * cosT + pz * sinT, rz = -px * sinT + pz * cosT;
      var ry = py * cosX - rz * sinX, rz2 = py * sinX + rz * cosX;
      var persp = f / (f + rz2 * 1.2), sx = cx0 + rx * S * persp * zoom, sy = cy0 + ry * S * persp * zoom;
      var tw = 0.6 + 0.4 * Math.sin(q.ph + t * 0.001 * q.tw);
      var a = alpha * tw * (0.55 + 0.45 * persp);
      if (a < 0.01) continue;
      var r = q.r * dpr * persp * (0.75 + 0.25 * zoom);
      g.fillStyle = col(c[q.c], a);
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
      if (q.c === 'gold' && i % 3 === 0) { g.fillStyle = col(c.frost, a * 0.5); g.beginPath(); g.arc(sx, sy, r * 0.45, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  }
  var darkMemo = { at: 0, v: false };
  function isDark() {
    var now = performance.now();
    if (now - darkMemo.at > 1000) { var b = rgb('var(--surface-page)'); darkMemo = { at: now, v: (b[0] + b[1] + b[2]) / 3 < 100 }; }
    return darkMemo.v;
  }
  function drawSpark(e, p) {
    var q = ease.out(p), a = env(p, 0.1, 0.45) * (0.55 + 0.45 * Math.sin(e.phase + p * e.tw));
    if (a < 0.01) return;
    var x = (e.x + e.dx * q) * dpr, y = (e.y + e.dy * q) * dpr, R = e.size * (1 - 0.4 * p) * dpr;
    var gr = g.createRadialGradient(x, y, 0, x, y, R * 3);
    gr.addColorStop(0, col(e.c, a)); gr.addColorStop(0.35, col(e.c, a * 0.5)); gr.addColorStop(1, col(e.c, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, R * 3, 0, Math.PI * 2); g.fill();
  }
  function frame(now) {
    g.clearRect(0, 0, canvas.width, canvas.height);
    effects = effects.filter(function (e) { return now < e.start + e.dur; });
    effects.forEach(function (e) {
      var p = (now - e.start) / e.dur; if (p < 0) return;
      if (e.type === 'ring') drawRing(e, p); else if (e.type === 'flash') drawFlash(e, p); else if (e.type === 'nova') drawNova(e, p); else if (e.type === 'rx') drawRx(e, p); else drawSpark(e, p);
    });
    if (effects.length) requestAnimationFrame(frame); else { running = false; g.clearRect(0, 0, canvas.width, canvas.height); }
  }
  function burst(x, y, k) {
    var now = performance.now();
    if (still() || (k < 1 && now - lastBurst < 1100)) return;
    setup(); lastBurst = now;
    var far = Math.max(Math.hypot(x, y), Math.hypot(innerWidth - x, y), Math.hypot(x, innerHeight - y), Math.hypot(innerWidth - x, innerHeight - y)) * 1.06;
    var c = { main: rgb('var(--calm)'), mint: rgb('var(--mint)'), frost: rgb('var(--frost)'), gold: rgb('var(--gold)') };
    var green = { main: c.main, mint: c.mint, edge: c.mint, frost: c.frost };
    var t = 700 + 1000 * k, spin = Math.random() * Math.PI * 2;
    function ring(o) { var r = { type: 'ring', x: x, y: y, spin: spin, drift: 0.25, fin: 0.06, fout: 0.55, c: green }; for (var key in o) r[key] = o[key]; return r; }
    effects.push({ type: 'flash', x: x, y: y, k: Math.min(1, k + 0.15), c: green, start: now, dur: 900 });
    if (k >= 1) {
      var dense = [{ off: 0, w: 2.2, a: 1, c: c.frost, dash: [2.5, 1.5] }, { off: 3, w: 1.2, a: 0.7, c: c.mint, dash: [1.2, 2.2] }];
      // The way back runs all the way to the point it started from; where it meets, a supernova launches the gold.
      var back = t * 0.6, bounce = t * 0.88 + back;
      effects.push(ring({ k: 1, r0: 4, r1: far, ease: 'out', body: 0.16, crests: dense, start: now, dur: t, fout: 0.7 }));
      effects.push(ring({ k: 0.9, r0: far, r1: 0, ease: 'quick', body: 0.16, crests: dense, start: now + t * 0.88, dur: back, fin: 0.1, fout: 0.93, drift: -0.35 }));
      var fils = [], clouds = [], reach = Math.min(far, 420);
      for (var j = 0; j < 18; j++) {
        var bright = j % 3 !== 0;   // two in three are short and bright; one in three is a long faint wisp
        fils.push({ a: (j / 18) * Math.PI * 2 + Math.random() * 0.3, len: reach * (bright ? 0.22 + Math.random() * 0.16 : 0.4 + Math.random() * 0.2),
          b: bright ? 0.9 : 0.45, ph: Math.random() * 6, curl: (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6) });
      }
      ['mint', 'main', 'gold', 'mint', 'main'].forEach(function (k, i) {
        clouds.push({ c: k, ang: (i / 5) * Math.PI * 2 + Math.random() * 0.8, dist: reach * (0.08 + Math.random() * 0.14), size: 60 + Math.random() * 60,
          a: k === 'gold' ? 0.22 : 0.3, spin: (Math.random() - 0.5) * 0.6 });
      });
      effects.push({ type: 'nova', x: x, y: y, c: { frost: c.frost, gold: c.gold, mint: c.mint, main: c.main }, fils: fils, clouds: clouds, reach: reach, start: now + bounce - 40, dur: 1400 });
      var goldC = { main: c.gold, mint: c.gold, edge: c.gold, frost: c.frost };
      var interlaced = [{ off: 0, w: 2, a: 1, c: c.gold, dash: [3, 2] }, { off: 2.6, w: 1.6, a: 1, c: c.frost, dash: [2, 3] }, { off: 5.4, w: 1.4, a: 0.85, c: c.gold, dash: [1.5, 2.5] }];
      effects.push(ring({ k: 1, r0: 0, r1: far, ease: 'out', body: 0.14, crests: interlaced, c: goldC, start: now + bounce, dur: t * 1.35, fin: 0.05, fout: 0.38, drift: -0.5 }));
      for (var i = 0; i < 40; i++) {
        var ang = Math.random() * Math.PI * 2, d = far * (0.35 + Math.random() * 0.65);
        effects.push({ type: 'spark', x: x, y: y, dx: Math.cos(ang) * d, dy: Math.sin(ang) * d,
          c: i % 2 ? c.gold : c.frost, size: 1.2 + Math.random() * 1.6, phase: Math.random() * 6, tw: 10 + Math.random() * 14,
          start: now + bounce + Math.random() * 160, dur: t * (1.1 + Math.random() * 0.5) });
      }
      // The finale: the energy gathers into a glowing Rx that turns in depth, then falls back into the page.
      var rxAt = now + bounce + 60, rxSize = Math.min(innerWidth, innerHeight) * 0.5;
      effects.push({ type: 'rx', x: x, y: y, c: { frost: c.frost, gold: c.gold, mint: c.mint, main: c.main }, start: rxAt, dur: 2600,
        pts: rxPoints(rxSize), spin: Math.random() < 0.5 ? -1 : 1 });
      // where it lands, one quiet ripple in gold and frost
      effects.push(ring({ k: 0.5, r0: 2, r1: rxSize * 0.75, ease: 'out', body: 0.3, crests: [{ off: 0, w: 1.4, a: 0.8, c: c.gold, dash: [3, 2] }, { off: 3, w: 1, a: 0.6, c: c.frost, dash: [1.5, 2.5] }],
        start: rxAt + 2600 * 0.84, dur: 1500, fin: 0.05, fout: 0.5 }));
    } else {
      // Every other touch: one slow ring out to the edges, no return (owner, 2026-11-27).
      var soft = [{ off: 0, w: 1.8, a: 0.9, c: c.frost, dash: [4, 2.5] }];
      effects.push(ring({ k: k, r0: 4, r1: far, ease: 'out', body: 0.26, crests: soft, start: now, dur: 1100 + 1600 * k, fout: 0.6 }));
    }
    if (!running) { running = true; requestAnimationFrame(frame); }
  }
  function centre(el) { var b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }
  return { burst: burst, still: still, centre: centre };
})();
function fxBurst(x, y, k) { FX.burst(x, y, k); }
function fxFromEl(el, k) { if (el) { var c = FX.centre(el); FX.burst(c[0], c[1], k); } }

// Where the last tap landed, so a save can burst from the button that was pressed.
var FX_lastTap = { x: innerWidth / 2, y: innerHeight / 2 };
document.addEventListener('pointerdown', function (e) { FX_lastTap = { x: e.clientX, y: e.clientY }; }, true);
