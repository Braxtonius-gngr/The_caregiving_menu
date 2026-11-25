/* Navigation that behaves like an app:
 * - The phone's Back button closes the photo viewer, then the open window (sheet), then goes to
 *   the previous screen. At Today it asks for a second press before leaving the app.
 * - Tapping outside a window, or pressing Back, asks before throwing away anything typed.
 * - Background sync never wipes a half-typed form on a screen: it waits until you leave the box,
 *   and keeps what you typed.
 * - Tap any photo to open it full screen; pinch, double-tap or scroll to zoom, drag to look around.
 * Loaded last, so it wraps the final versions of showScreen, openSheet, closeSheet and refresh. */

var Nav = { popPending: false, queue: [], noPush: false, fromPop: false, sheetDirty: false, screenDirty: {}, refreshPending: false, exitArmed: false };

function navSheetOpen() { var s = document.getElementById('sheet'); return !!s && !s.classList.contains('hidden'); }
function navZoomOpen() { return !!document.getElementById('zoom'); }
function navIsField(el) { return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'button' && el.type !== 'file'; }
function navPush(state) { if (Nav.popPending) Nav.queue.push(state); else { try { history.pushState(state, ''); } catch (e) { /* unserializable */ } } }
// Remove our own entry (sheet or zoom) after closing it with a button, without acting on the pop.
function navDrop(kind) {
  var q = Nav.queue;
  if (q.length && q[q.length - 1].tcm === kind) { q.pop(); return; }
  if (!Nav.popPending && history.state && history.state.tcm === kind) { Nav.popPending = true; history.back(); }
}

/* ---------- screens ---------- */
var _navShowScreen = showScreen;
showScreen = function (name, arg) {
  var oldSeg = document.querySelector('#screen .seg'), segLeft = oldSeg ? oldSeg.scrollLeft : 0, sameScreen = currentScreen === name;
  _navShowScreen(name, arg);
  var seg = document.querySelector('#screen .seg');
  if (seg) {
    if (sameScreen) seg.scrollLeft = segLeft;
    var on = seg.querySelector('.on, [aria-selected="true"]');
    if (on) { var sr = seg.getBoundingClientRect(), br = on.getBoundingClientRect(); if (br.left < sr.left || br.right > sr.right) seg.scrollLeft += (br.left - sr.left) - (sr.width - br.width) / 2; }
  }
  if (Nav.noPush) return;
  Nav.screenDirty = {}; Nav.refreshPending = false;
  var a = typeof arg === 'string' || typeof arg === 'number' ? arg : null, st = history.state;
  if (st && st.tcm === 'screen' && st.name === currentScreen && st.arg === a) return;
  if (!st || !st.tcm) { try { history.replaceState({ tcm: 'root' }, ''); } catch (e) { /* ignore */ } } // first screen: mark where the app begins
  navPush({ tcm: 'screen', name: currentScreen, arg: a });
};

// A refresh the person caused (they saved something): redraw now, typed boxes start fresh.
var _navRefresh = refresh;
refresh = function () { Nav.screenDirty = {}; Nav.refreshPending = false; Nav.noPush = true; try { _navRefresh(); } finally { Nav.noPush = false; } };
// A refresh caused by background sync: never interrupt typing, and keep what was typed.
function bgRefresh() {
  var scr = document.getElementById('screen'), a = document.activeElement;
  if (scr && navIsField(a) && scr.contains(a)) { Nav.refreshPending = true; return; }
  var keep = Nav.screenDirty, y = window.scrollY;
  Array.prototype.forEach.call(scr.querySelectorAll('input[id], textarea[id], select[id]'), function (el) {
    if (el.type === 'file' || el.type === 'hidden' || keep[el.id] !== undefined) return;
    if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) keep[el.id] = el.checked; }
    else if (el.value && el.value !== el.defaultValue) keep[el.id] = el.value;
  });
  Nav.noPush = true; try { _navRefresh(); } finally { Nav.noPush = false; }
  Object.keys(keep).forEach(function (id) {
    var el = document.getElementById(id); if (!el || !scr.contains(el)) return;
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = keep[id]; else el.value = keep[id];
  });
  Nav.screenDirty = keep; window.scrollTo(0, y);
}
function navRunPending() {
  if (!Nav.refreshPending) return;
  var scr = document.getElementById('screen'), a = document.activeElement;
  if (scr && navIsField(a) && scr.contains(a)) return;
  Nav.refreshPending = false; bgRefresh();
}
document.addEventListener('focusout', function () { setTimeout(navRunPending, 80); });
setInterval(navRunPending, 3000); // in case a browser skips focusout
function navTrack(e) {
  var t = e.target; if (!navIsField(t) || t.hasAttribute('data-autosave')) return; // autosaved boxes are never lost
  if (t.closest('#sheetBody')) Nav.sheetDirty = true;
  else if (t.id && t.closest('#screen')) Nav.screenDirty[t.id] = (t.type === 'checkbox' || t.type === 'radio') ? t.checked : t.value;
}
document.addEventListener('input', navTrack);
document.addEventListener('change', navTrack);

/* ---------- windows (sheets) ---------- */
var _navOpenSheet = openSheet;
openSheet = function (html) {
  var was = navSheetOpen();
  _navOpenSheet(html);
  Nav.sheetDirty = false;
  if (!was) navPush({ tcm: 'sheet' });
};
var _navCloseSheet = closeSheet;
closeSheet = function () {
  var was = navSheetOpen();
  _navCloseSheet();
  Nav.sheetDirty = false;
  if (was && !Nav.fromPop) navDrop('sheet');
};
// Tap outside or Back: ask before losing typed work.
function sheetDiscardOk() { return !Nav.sheetDirty || confirm('Close without saving? What you typed here will be lost.'); }
function dismissSheet() { if (sheetDiscardOk()) closeSheet(); }

/* ---------- Back button ---------- */
window.addEventListener('popstate', function (e) {
  if (Nav.popPending) {
    Nav.popPending = false;
    var q = Nav.queue; Nav.queue = [];
    q.forEach(function (s) { try { history.pushState(s, ''); } catch (err) { /* ignore */ } });
    return;
  }
  if (navZoomOpen()) { Nav.fromPop = true; zoomClose(); Nav.fromPop = false; return; }
  if (navSheetOpen()) {
    if (!sheetDiscardOk()) { navPush({ tcm: 'sheet' }); return; }
    Nav.fromPop = true; closeSheet(); Nav.fromPop = false; return;
  }
  var st = e.state;
  if (!st || st.tcm === 'root') {
    // Leaving the app: ask for a second press unless one just came.
    if (Nav.exitArmed) { history.back(); return; }
    Nav.exitArmed = true; setTimeout(function () { Nav.exitArmed = false; }, 2500);
    toast('Press Back again to leave the app');
    navPush({ tcm: 'screen', name: currentScreen, arg: null });
    return;
  }
  if (st.tcm === 'sheet' || st.tcm === 'zoom') { history.back(); return; } // stale entry
  if (st.tcm === 'screen') { Nav.noPush = true; try { showScreen(st.name, st.arg == null ? undefined : st.arg); } finally { Nav.noPush = false; } }
});

/* ---------- photo viewer with zoom ---------- */
function zoomImage(src, alt) {
  if (!src) return;
  zoomClose(true);
  var z = document.createElement('div');
  z.id = 'zoom'; z.className = 'zoom'; z.setAttribute('role', 'dialog'); z.setAttribute('aria-label', 'Photo');
  z.innerHTML = '<img alt="' + esc(alt || 'Photo') + '"><button type="button" class="zoom-close" aria-label="Close photo" onclick="zoomClose()">&times;</button><div class="zoom-hint">Pinch or double-tap to zoom</div>';
  z.querySelector('img').src = src;
  document.body.appendChild(z);
  zoomWire(z);
  navPush({ tcm: 'zoom' });
}
function zoomClose(silent) {
  var z = document.getElementById('zoom'); if (!z) return;
  z.remove();
  if (!silent && !Nav.fromPop) navDrop('zoom');
}
function zoomWire(z) {
  var img = z.querySelector('img'), s = 1, x = 0, y = 0, pts = {}, start = null, lastTap = 0, moved = false;
  var apply = function () {
    if (s <= 1.01) { s = 1; x = 0; y = 0; }
    img.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
  };
  var dist = function () { var p = Object.keys(pts).map(function (k) { return pts[k]; }); return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };
  z.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.zoom-close')) return;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY }; moved = false;
    var n = Object.keys(pts).length;
    start = n === 2 ? { d: dist(), s: s } : { px: e.clientX, py: e.clientY, x: x, y: y };
    try { z.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  z.addEventListener('pointermove', function (e) {
    if (!pts[e.pointerId] || !start) return;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var n = Object.keys(pts).length;
    if (n === 2 && start.d) { s = Math.min(6, Math.max(1, start.s * dist() / start.d)); moved = true; apply(); }
    else if (n === 1 && start.px != null && s > 1) { x = start.x + e.clientX - start.px; y = start.y + e.clientY - start.py; moved = true; apply(); }
    else if (n === 1 && start.px != null && Math.hypot(e.clientX - start.px, e.clientY - start.py) > 8) moved = true;
  });
  var up = function (e) {
    var wasTap = !moved && Object.keys(pts).length === 1;
    delete pts[e.pointerId];
    var left = Object.keys(pts);
    start = left.length === 1 ? { px: pts[left[0]].x, py: pts[left[0]].y, x: x, y: y } : null;
    if (e.type !== 'pointerup' || !wasTap || e.target.closest('.zoom-close')) return;
    var now = Date.now();
    if (now - lastTap < 320) { // double-tap: zoom in around the tap, or back out
      if (s > 1) s = 1; else { s = 2.5; var r = img.getBoundingClientRect(); x = (r.left + r.width / 2 - e.clientX) * 1.5; y = (r.top + r.height / 2 - e.clientY) * 1.5; }
      apply(); lastTap = 0; return;
    }
    lastTap = now;
    if (e.target === z && s === 1) setTimeout(function () { if (lastTap === now) zoomClose(); }, 330); // tap the dark area to close
  };
  z.addEventListener('pointerup', up);
  z.addEventListener('pointercancel', up);
  z.addEventListener('wheel', function (e) { e.preventDefault(); s = Math.min(6, Math.max(1, s * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); apply(); }, { passive: false });
}
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && navZoomOpen()) zoomClose(); });
// Any picture not already part of a button or link opens in the viewer.
document.addEventListener('click', function (e) {
  var img = e.target.closest && e.target.closest('img');
  if (!img || !img.src || img.closest('#zoom') || img.classList.contains('hidden')) return;
  var holder = img.closest('button, a, [onclick], .tappable');
  if (holder && holder.id !== 'sheet') return; // the sheet backdrop's own onclick does not count
  e.preventDefault(); zoomImage(img.src, img.alt);
});
