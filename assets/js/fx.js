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
      if (e.type === 'ring') drawRing(e, p); else if (e.type === 'flash') drawFlash(e, p); else if (e.type === 'nova') drawNova(e, p); else drawSpark(e, p);
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
    } else {
      var soft = [{ off: 0, w: 1.8, a: 0.9, c: c.frost, dash: [4, 2.5] }];
      effects.push(ring({ k: k, r0: 4, r1: far, ease: 'out', body: 0.26, crests: soft, start: now, dur: t, fout: 0.68 }));
      effects.push(ring({ k: k * 0.55, r0: far, r1: far * 0.14, ease: 'inout', body: 0.26, crests: soft, start: now + t * 0.86, dur: t * 1.3, fin: 0.14, fout: 0.3, drift: -0.2 }));
    }
    if (!running) { running = true; requestAnimationFrame(frame); }
  }
  function centre(el) { var b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }
  return { burst: burst, still: still, centre: centre };
})();
function fxBurst(x, y, k) { FX.burst(x, y, k); }
function fxFromEl(el, k) { if (el) { var c = FX.centre(el); FX.burst(c[0], c[1], k); } }
