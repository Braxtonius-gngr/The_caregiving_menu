/* Camera barcode scanner. Uses the browser's BarcodeDetector where it exists
 * (Android Chrome, macOS) and lazy-loads ZXing everywhere else (iPhone Safari,
 * desktop Linux/Windows). One frame loop drives both so the camera lifecycle
 * lives in one place. */
var Scanner = (function () {
  var ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
  var FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
  var stream = null, timer = null, running = false, decoder = null, zxingP = null;

  function loadZxing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (zxingP) return zxingP;
    zxingP = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = ZXING_URL;
      s.onload = function () { resolve(window.ZXing); };
      s.onerror = function () { zxingP = null; reject(new Error('Could not load the scanner library. Check your connection, or type the number.')); };
      document.head.appendChild(s);
    });
    return zxingP;
  }

  // Returns {detect(video, canvas) -> Promise<string|null>}
  function makeDecoder() {
    if ('BarcodeDetector' in window) {
      return window.BarcodeDetector.getSupportedFormats().then(function (supported) {
        var fmts = FORMATS.filter(function (f) { return supported.indexOf(f) > -1; });
        if (!fmts.length) throw new Error('no formats');
        var det = new window.BarcodeDetector({ formats: fmts });
        return { kind: 'native', detect: function (video) { return det.detect(video).then(function (codes) { return codes.length ? codes[0].rawValue : null; }); } };
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
            var bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
            return Promise.resolve(reader.decodeWithState(bmp).getText());
          } catch (e) { return Promise.resolve(null); }
        }
      };
    });
  }

  // UPC-A, EAN-8 and EAN-13 carry a check digit; reject misreads before a lookup.
  function validGtin(code) {
    if (!/^\d{8}$|^\d{12,14}$/.test(code)) return /^[\x20-\x7e]{4,}$/.test(code); // CODE_128: accept printable
    var digits = code.split('').map(Number), check = digits.pop(), sum = 0;
    digits.reverse().forEach(function (d, i) { sum += d * (i % 2 === 0 ? 3 : 1); });
    return (10 - (sum % 10)) % 10 === check;
  }

  function start(video, canvas, onCode, onError) {
    stop();
    running = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onError(new Error('This browser cannot open the camera. Type the number instead.')); return; }
    var constraints = { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } };
    Promise.all([navigator.mediaDevices.getUserMedia(constraints), decoder ? Promise.resolve(decoder) : makeDecoder()]).then(function (res) {
      if (!running) { res[0].getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = res[0]; decoder = res[1];
      video.srcObject = stream;
      video.setAttribute('playsinline', ''); video.muted = true;
      return video.play().then(function () {
        var last = null;
        var tick = function () {
          if (!running) return;
          decoder.detect(video, canvas).then(function (code) {
            if (!running) return;
            // Require the same value on two consecutive frames to avoid a one-off misread.
            if (code && validGtin(code)) {
              if (code === last) { stop(); if (navigator.vibrate) navigator.vibrate(60); onCode(code); return; }
              last = code;
            }
            timer = setTimeout(tick, decoder.kind === 'native' ? 120 : 200);
          }).catch(function () { timer = setTimeout(tick, 300); });
        };
        tick();
      });
    }).catch(function (e) {
      running = false;
      var msg = e && e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser settings, or type the number.'
        : e && e.name === 'NotFoundError' ? 'No camera found. Type the number instead.' : (e && e.message) || 'Could not start the camera.';
      onError(new Error(msg));
    });
  }

  function stop() {
    running = false;
    clearTimeout(timer); timer = null;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  function decoderKind() { return decoder ? decoder.kind : null; }

  return { start: start, stop: stop, validGtin: validGtin, decoderKind: decoderKind };
})();
