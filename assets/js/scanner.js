/* Camera barcode scanner. Uses the browser's BarcodeDetector where it exists
 * (Android Chrome, macOS) and lazy-loads ZXing everywhere else (iPhone Safari,
 * desktop Linux/Windows). One frame loop drives both so the camera lifecycle
 * lives in one place. */
var Scanner = (function () {
  var ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
  var FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
  var stream = null, timer = null, decoder = null, zxingP = null;
  var gen = 0; // bumped by stop(); any async step from an older start() sees a mismatch and backs out

  function loadZxing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (zxingP) return zxingP;
    zxingP = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = ZXING_URL;
      s.crossOrigin = 'anonymous'; // CORS response, so the service worker can cache it for offline use
      s.onload = function () { resolve(window.ZXing); };
      s.onerror = function () { zxingP = null; reject(new Error('Could not load the scanner library. Check your connection, or type the number.')); };
      document.head.appendChild(s);
    });
    return zxingP;
  }

  // Each decoder exposes detect(video, canvas) -> Promise<{text, format}|null>; format is lower_snake.
  function makeDecoder() {
    if ('BarcodeDetector' in window) {
      return window.BarcodeDetector.getSupportedFormats().then(function (supported) {
        var fmts = FORMATS.filter(function (f) { return supported.indexOf(f) > -1; });
        if (!fmts.length) throw new Error('no formats');
        var det = new window.BarcodeDetector({ formats: fmts });
        return { kind: 'native', detect: function (video) { return det.detect(video).then(function (codes) { return codes.length ? { text: codes[0].rawValue, format: codes[0].format } : null; }); } };
      }).catch(function () { return zxingDecoder(); });
    }
    return zxingDecoder();
  }

  function zxingDecoder() {
    return loadZxing().then(function (Z) {
      var reader = new Z.MultiFormatReader();
      var hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.CODE_128]);
      hints.set(Z.DecodeHintType.TRY_HARDER, true);
      reader.setHints(hints);
      return {
        kind: 'zxing',
        detect: function (video, canvas) {
          var w = video.videoWidth, h = video.videoHeight;
          if (!w || !h) return Promise.resolve(null);
          // Scan the middle band where people aim; smaller frames decode faster.
          var cw = Math.min(w, 960), ch = Math.round(cw * 0.5), sx = (w - cw) / 2, sy = (h - ch) / 2;
          canvas.width = cw; canvas.height = ch;
          canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, sx, sy, cw, ch, 0, 0, cw, ch);
          try {
            var res = reader.decodeWithState(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas))));
            return Promise.resolve({ text: res.getText(), format: String(Z.BarcodeFormat[res.getBarcodeFormat()]).toLowerCase() });
          } catch (e) { return Promise.resolve(null); }
        }
      };
    });
  }

  // Mod-10 check digit used by UPC-A, EAN-8, EAN-13 and GTIN-14.
  function validGtin(code) {
    if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
    var digits = code.split('').map(Number), check = digits.pop(), sum = 0;
    digits.reverse().forEach(function (d, i) { sum += d * (i % 2 === 0 ? 3 : 1); });
    return (10 - (sum % 10)) % 10 === check;
  }

  // UPC-E (8 digits: number system, six digits, check) -> the UPC-A it abbreviates.
  // Its check digit belongs to the expanded UPC-A, so validate after expanding.
  function expandUpcE(code) {
    if (!/^[01]\d{7}$/.test(code)) return null;
    var ns = code[0], d = code.slice(1, 7), check = code[7], last = d[5], body;
    if (last <= '2') body = d[0] + d[1] + last + '0000' + d[2] + d[3] + d[4];
    else if (last === '3') body = d[0] + d[1] + d[2] + '00000' + d[3] + d[4];
    else if (last === '4') body = d[0] + d[1] + d[2] + d[3] + '00000' + d[4];
    else body = d[0] + d[1] + d[2] + d[3] + d[4] + '0000' + last;
    var upcA = ns + body + check;
    return validGtin(upcA) ? upcA : null;
  }

  // Normalised codes to look up, best first. Empty means "not a valid barcode".
  // With a known format the answer is unambiguous; a typed 8-digit number may be
  // EAN-8 or UPC-E, so both readings that pass their check digit are returned.
  function candidates(text, format) {
    text = String(text || '').trim();
    if (format === 'upc_e') { var a = expandUpcE(text); return a ? [a] : []; }
    if (format === 'code_128') return /^[\x20-\x7e]{4,}$/.test(text) ? [text] : [];
    if (format) return validGtin(text) ? [text] : [];
    if (/^\d{8}$/.test(text)) return [validGtin(text) ? text : null, expandUpcE(text)].filter(Boolean);
    return validGtin(text) ? [text] : [];
  }

  function stopTracks(s) { if (s) s.getTracks().forEach(function (t) { t.stop(); }); }

  function start(video, canvas, onCode, onError) {
    stop();
    var my = gen;
    var live = function () { return my === gen; };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onError(new Error('This browser cannot open the camera. Type the number instead.')); return; }
    var constraints = { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } };
    // Decoder first: if ZXing cannot load, the camera is never opened.
    (decoder ? Promise.resolve(decoder) : makeDecoder()).then(function (dec) {
      decoder = dec;
      if (!live()) throw null;
      return navigator.mediaDevices.getUserMedia(constraints);
    }).then(function (s) {
      if (!live()) { stopTracks(s); throw null; } // closed while the permission prompt was up
      stream = s;
      video.srcObject = s;
      video.setAttribute('playsinline', ''); video.muted = true;
      return video.play();
    }).then(function () {
      var last = null;
      var again = function (ms) { if (live()) timer = setTimeout(tick, ms); };
      var tick = function () {
        if (!live()) return;
        decoder.detect(video, canvas).then(function (hit) {
          if (!live()) return;
          var ok = hit && candidates(hit.text, hit.format).length;
          // Same value on two consecutive frames; an empty or invalid frame breaks the run.
          if (!ok) { last = null; return again(decoder.kind === 'native' ? 120 : 200); }
          var key = hit.format + ':' + hit.text;
          if (key === last) { stop(); if (navigator.vibrate) navigator.vibrate(60); onCode(hit.text, hit.format); return; }
          last = key;
          again(decoder.kind === 'native' ? 120 : 200);
        }).catch(function () { last = null; again(300); });
      };
      tick();
    }).catch(function (e) {
      if (!live() || e === null) return;
      stop(); // releases a stream acquired before video.play() failed
      var msg = e && e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser settings, or type the number.'
        : e && e.name === 'NotFoundError' ? 'No camera found. Type the number instead.' : (e && e.message) || 'Could not start the camera.';
      onError(new Error(msg));
    });
  }

  function stop() {
    gen++;
    clearTimeout(timer); timer = null;
    stopTracks(stream); stream = null;
  }

  function decoderKind() { return decoder ? decoder.kind : null; }

  return { start: start, stop: stop, validGtin: validGtin, expandUpcE: expandUpcE, candidates: candidates, decoderKind: decoderKind };
})();
