/*
 * ImplantRef label scanner.
 *  1. Barcode: native BarcodeDetector where it supports Data Matrix (Android Chrome), otherwise the
 *     bundled ZXing decoder (iPhone Safari). GS1 GTIN → REF via data/gtin-data.js; HIBC product code → REF.
 *  2. Printed text: on-device OCR (bundled Tesseract, loaded only when first needed) reading "REF …".
 * Only REFs that exist in the catalogue are ever returned. Camera frames stay on the device and are never stored.
 * Usage: ImplantRefScan.open({ onResult({candidates, info, via}), onCancel() })
 */
(() => {
  "use strict";
  const C = window.ImplantRefCore;
  const BASE = (document.currentScript && document.currentScript.src.replace(/src\/scan\.js(?:\?.*)?$/, "")) || "./";
  const ZXING_SRC = BASE + "src/vendor/zxing-0.21.3.min.js";
  const TESS_DIR = BASE + "src/vendor/tesseract/";
  const LANG_DIR = BASE + "data/ocr";
  let refIndex = null;
  const index = () => refIndex || (refIndex = C.buildRefIndex(window.IMPLANTREF_DATA.records));

  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        delete loaded[src];
        reject(new Error("Could not load " + src.split("/").pop() + " (offline?)"));
      };
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  /* ------------------------------------------------------------ barcode */
  let nativeDetector = null;
  let zx = null;
  async function barcodeEngine() {
    if (nativeDetector || zx) return;
    try {
      if ("BarcodeDetector" in window) {
        const fmts = await window.BarcodeDetector.getSupportedFormats();
        if (fmts.includes("data_matrix")) {
          nativeDetector = new window.BarcodeDetector({ formats: fmts.filter((f) => ["data_matrix", "code_128", "qr_code", "ean_13", "gs1_databar", "code_39"].includes(f)) });
          return;
        }
      }
    } catch (e) {
      /* fall through to ZXing */
    }
    await loadScript(ZXING_SRC);
    const Z = window.ZXing;
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.CODE_39]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    zx = { Z, reader, hints };
  }

  function luminance(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data;
    const lum = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    return lum;
  }

  // Overlapping square tiles (sides 60% and 90% of the shorter edge, half-side stride, plus edge-aligned):
  // ZXing's Data Matrix detector struggles when the symbol shares the frame with lots of text,
  // but finds it reliably in a tighter, square crop.
  function tilesFor(W, H) {
    const out = [];
    for (const k of [0.6, 0.9]) {
      const s = Math.round(Math.min(W, H) * k), st = Math.max(1, Math.round(s / 2));
      const xs = [], ys = [];
      for (let x = 0; x + s <= W; x += st) xs.push(x);
      for (let y = 0; y + s <= H; y += st) ys.push(y);
      if (xs[xs.length - 1] !== W - s) xs.push(W - s);
      if (ys[ys.length - 1] !== H - s) ys.push(H - s);
      for (const y of ys) for (const x of xs) out.push([x, y, s]);
    }
    return out;
  }
  let tileCursor = 0;

  /** Decode a barcode from a canvas. exhaustive: try every tile (photos); otherwise one tile per call (live video). */
  async function decodeBarcode(canvas, exhaustive) {
    await barcodeEngine();
    if (nativeDetector) {
      const r = await nativeDetector.detect(canvas);
      return r && r[0] ? r[0].rawValue : null;
    }
    const { Z, reader, hints } = zx;
    const tryDecode = (lum, w, h) => {
      try {
        const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, w, h)));
        return reader.decode(bmp, hints).getText();
      } catch (e) {
        return null;
      } finally {
        reader.reset && reader.reset();
      }
    };
    const region = (x, y, w, h, rotate) => {
      const c = document.createElement("canvas");
      c.width = rotate ? h : w;
      c.height = rotate ? w : h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (rotate) {
        ctx.translate(h, 0);
        ctx.rotate(Math.PI / 2);
      }
      ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      return tryDecode(luminance(ctx, c.width, c.height), c.width, c.height);
    };
    const W = canvas.width, H = canvas.height;
    let text = region(0, 0, W, H, false);
    if (text) return text;
    const all = tilesFor(W, H);
    const tiles = exhaustive ? all : [all[tileCursor++ % all.length]];
    for (const [x, y, side] of tiles) {
      text = region(x, y, side, side, false);
      if (text) return text;
    }
    // 1D codes printed vertically
    return exhaustive ? region(0, 0, W, H, true) : null;
  }

  /* ---------------------------------------------------------------- OCR */
  let ocrWorker = null;
  let ocrLoading = null;
  function ensureOcr(onProgress) {
    if (ocrWorker) return Promise.resolve(ocrWorker);
    if (ocrLoading) return ocrLoading;
    ocrLoading = (async () => {
      await loadScript(TESS_DIR + "tesseract.min.js");
      const w = await window.Tesseract.createWorker("eng", 1, {
        workerPath: TESS_DIR + "worker.min.js",
        corePath: TESS_DIR,
        langPath: LANG_DIR,
        workerBlobURL: false,
        gzip: true,
        cacheMethod: "write",
        logger: (m) => onProgress && m && typeof m.progress === "number" && onProgress(m),
      });
      await w.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1" });
      ocrWorker = w;
      return w;
    })().catch((e) => {
      ocrLoading = null;
      throw e;
    });
    return ocrLoading;
  }

  /** Grey, contrast-stretched, upscaled copy of a canvas region for OCR. */
  function prepForOcr(src) {
    const scale = Math.min(2.5, Math.max(1, 1400 / src.width));
    const c = document.createElement("canvas");
    c.width = Math.round(src.width * scale);
    c.height = Math.round(src.height * scale);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    let lo = 255, hi = 0;
    const lum = new Uint8ClampedArray(d.length / 4);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      lum[j] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = Math.max(1, hi - lo);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = ((lum[j] - lo) * 255) / span;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  async function readText(canvas, onProgress) {
    const w = await ensureOcr(onProgress);
    const { data } = await w.recognize(prepForOcr(canvas));
    return data && data.text ? data.text : "";
  }

  /* ----------------------------------------------------------------- UI */
  let state = null;

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function open(opts = {}) {
    if (state) close();
    const box = el(`<div class="scan-overlay" role="dialog" aria-modal="true" aria-label="Scan a product label">
<div class="scan-stage"><video class="scan-video" playsinline muted autoplay></video><div class="scan-frame" aria-hidden="true"></div>
<div class="scan-top"><button class="scan-btn" data-scan="close" aria-label="Close scanner">✕</button><span class="scan-title">Scan label</span><button class="scan-btn hidden" data-scan="torch" aria-label="Torch" aria-pressed="false">☀︎</button></div>
<div class="scan-bottom"><div class="scan-status" aria-live="polite">Starting camera…</div>
<div class="scan-actions"><button class="scan-btn wide" data-scan="ocr">Read REF now</button><label class="scan-btn wide">Use a photo<input type="file" accept="image/*" capture="environment" class="hidden" data-scan="photo"></label></div>
<div class="scan-hint">Point at the barcode or the printed <b>REF</b>. Nothing is uploaded or stored.</div></div></div></div>`);
    document.body.appendChild(box);
    document.body.classList.add("scan-open");
    state = { box, opts, stream: null, timer: null, busy: false, ocrBusy: false, started: Date.now(), lastOcr: 0, ocrVotes: {}, gs1Info: null, done: false };
    const status = (t) => {
      const s = box.querySelector(".scan-status");
      if (s) s.textContent = t;
    };
    state.status = status;
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-scan]");
      if (!b) return;
      const a = b.dataset.scan;
      if (a === "close") cancel();
      else if (a === "torch") toggleTorch(b);
      else if (a === "ocr") runOcrNow();
    });
    box.querySelector('[data-scan="photo"]').addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) fromPhoto(f);
      e.target.value = "";
    });
    document.addEventListener("keydown", onKey);
    startCamera();
    // Warm the barcode engine immediately; OCR loads lazily.
    barcodeEngine().catch(() => {});
  }

  function onKey(e) {
    if (e.key === "Escape" && state) cancel();
  }

  async function startCamera() {
    const v = state.box.querySelector("video");
    if (!state) return;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      state.status("Camera not available here — use a photo of the label instead.");
      state.box.classList.add("photo-only");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (!state) return stream.getTracks().forEach((t) => t.stop());
      state.stream = stream;
      v.srcObject = stream;
      await v.play().catch(() => {});
      if (!state) return;
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch) state.box.querySelector('[data-scan="torch"]').classList.remove("hidden");
      if (caps.focusMode && caps.focusMode.includes("continuous")) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
      state.status("Looking for a barcode…");
      loop();
    } catch (e) {
      if (!state) return;
      state.status(e && e.name === "NotAllowedError" ? "Camera permission was declined. Allow camera access in Settings, or use a photo." : "Camera could not start — use a photo of the label instead.");
      state.box.classList.add("photo-only");
    }
  }

  /**
   * Copy what is inside the on-screen guide frame (or the whole visible picture) into a canvas.
   * The video is shown with object-fit: cover, so screen coordinates are mapped back to camera pixels.
   */
  function frameCanvas(full) {
    const v = state.box.querySelector("video");
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return null;
    const vr = v.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const ox = vr.left + (vr.width - vw * scale) / 2, oy = vr.top + (vr.height - vh * scale) / 2;
    const target = full ? vr : state.box.querySelector(".scan-frame").getBoundingClientRect();
    let sx = (target.left - ox) / scale, sy = (target.top - oy) / scale;
    let sw = target.width / scale, sh = target.height / scale;
    // a little margin around the frame helps the decoder; clamp to the camera image
    if (!full) {
      sx -= sw * 0.06;
      sy -= sh * 0.1;
      sw *= 1.12;
      sh *= 1.2;
    }
    sx = Math.max(0, sx);
    sy = Math.max(0, sy);
    sw = Math.min(vw - sx, sw);
    sh = Math.min(vh - sy, sh);
    if (sw < 8 || sh < 8) return null;
    const c = document.createElement("canvas");
    const k = Math.min(1, 1280 / sw);
    c.width = Math.round(sw * k);
    c.height = Math.round(sh * k);
    c.getContext("2d", { willReadFrequently: true }).drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  function loop() {
    if (!state || state.done) return;
    state.timer = setTimeout(async () => {
      if (!state || state.done) return;
      if (!state.busy) {
        state.busy = true;
        try {
          const c = frameCanvas(false);
          if (c) {
            const text = await decodeBarcode(c);
            if (text) onBarcode(text);
          }
        } catch (e) {
          /* keep scanning */
        }
        state && (state.busy = false);
      }
      // After a short wait without a usable barcode, read the printed REF as well.
      if (state && !state.done && !state.ocrBusy && Date.now() - state.started > 1800 && Date.now() - state.lastOcr > 1400) autoOcr();
      loop();
    }, 180);
  }

  function onBarcode(text) {
    if (!state || state.done) return;
    const res = C.resolveBarcode(text, window.IMPLANTREF_GTIN || {}, index());
    if (res.candidates.length) return finish({ candidates: res.candidates, info: res.info, via: res.kind });
    if (res.kind === "gs1" && !state.gs1Info) {
      state.gs1Info = res.info;
      state.status(`Barcode read (GTIN ${res.info.gtin}) but it isn't in ImplantRef's UDI table — reading the printed REF…`);
    }
  }

  async function autoOcr() {
    if (!state || state.ocrBusy) return;
    state.ocrBusy = true;
    state.lastOcr = Date.now();
    try {
      if (!ocrWorker) state.status(state.gs1Info ? state.box.querySelector(".scan-status").textContent : "Looking for a barcode or the printed REF…");
      const c = frameCanvas(false);
      if (!c) return;
      const text = await readText(c, (m) => {
        if (state && !ocrWorker && m.status && /loading|initializ/i.test(m.status)) state.status("Preparing text reader (first time only)…");
      });
      handleOcr(text, false);
    } catch (e) {
      state && state.status("Text reader unavailable (" + e.message + "). Barcode scanning still works.");
    } finally {
      if (state) state.ocrBusy = false;
    }
  }

  function handleOcr(text, decisive) {
    if (!state || state.done) return;
    const cands = C.refsFromText(text, index());
    if (!cands.length) return;
    const top = cands[0];
    const key = top.manufacturer + "|" + top.articleNumber;
    state.ocrVotes[key] = (state.ocrVotes[key] || 0) + 1;
    // Accept immediately when read next to "REF" or on an explicit read; otherwise require two matching reads.
    if (decisive || top.score >= 13 || state.ocrVotes[key] >= 2) {
      finish({ candidates: cands.slice(0, 5), info: state.gs1Info || {}, via: "ocr", text });
    } else state.status(`Reading… ${top.articleNumber}?`);
  }

  async function runOcrNow() {
    if (!state) return;
    state.status("Reading the printed text…");
    try {
      while (state && state.ocrBusy) await new Promise((r) => setTimeout(r, 120));
      if (!state) return;
      state.ocrBusy = true;
      const c = frameCanvas(true);
      if (!c) return state.status("Camera not ready yet.");
      const text = await readText(c);
      if (!state) return;
      state.ocrBusy = false;
      const cands = C.refsFromText(text, index());
      if (cands.length) return handleOcr(text, true);
      state.status("No catalogue REF found in that view. Fill the frame with the REF line and try again.");
    } catch (e) {
      state && state.status("Text reader unavailable (" + e.message + ").");
    } finally {
      if (state) state.ocrBusy = false;
    }
  }

  async function fromPhoto(file) {
    if (!state) return;
    state.status("Reading photo…");
    try {
      const img = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const i = new Image();
        i.onload = () => {
          URL.revokeObjectURL(url);
          resolve(i);
        };
        i.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("unreadable image"));
        };
        i.src = url;
      });
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
      const code = await decodeBarcode(c, true).catch(() => null);
      if (code) {
        onBarcode(code);
        if (!state || state.done) return;
      }
      state.status("Reading the printed text…");
      const text = await readText(c, (m) => m.status && /loading|initializ/i.test(m.status) && state && state.status("Preparing text reader (first time only)…"));
      if (!state) return;
      const cands = C.refsFromText(text, index());
      if (cands.length) return finish({ candidates: cands.slice(0, 5), info: state.gs1Info || {}, via: "ocr", text });
      state.status(state.gs1Info ? `GTIN ${state.gs1Info.gtin} isn't in the UDI table and no REF could be read. Type the REF instead.` : "No barcode or catalogue REF found in that photo. Try closer, flatter and well lit.");
    } catch (e) {
      state && state.status("Couldn't read that photo (" + e.message + ").");
    }
  }

  async function toggleTorch(btn) {
    const track = state && state.stream && state.stream.getVideoTracks()[0];
    if (!track) return;
    const on = btn.getAttribute("aria-pressed") !== "true";
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      btn.setAttribute("aria-pressed", String(on));
    } catch (e) {
      /* unsupported */
    }
  }

  function finish(result) {
    if (!state || state.done) return;
    state.done = true;
    const cb = state.opts.onResult;
    if (navigator.vibrate) navigator.vibrate(60);
    close();
    // Unique by manufacturer + REF, best first
    const seen = new Set();
    result.candidates = result.candidates.filter((c) => {
      const k = c.manufacturer + "|" + c.articleNumber;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    cb && cb(result);
  }

  function cancel() {
    const cb = state && state.opts.onCancel;
    close();
    cb && cb();
  }

  function close() {
    if (!state) return;
    clearTimeout(state.timer);
    state.done = true;
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    state.box.remove();
    document.body.classList.remove("scan-open");
    document.removeEventListener("keydown", onKey);
    state = null;
  }

  window.ImplantRefScan = { open, close, _test: { decodeBarcode, readText, ensureOcr, onBarcode: (t) => onBarcode(t), isOpen: () => !!state } };
})();
