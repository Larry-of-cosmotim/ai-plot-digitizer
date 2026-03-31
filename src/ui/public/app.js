/* ── AI Plot Digitizer — Browser UI ──────────────────────────────── */
/* globals: none — vanilla ES5-compatible JS for broad compat          */

(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return document.querySelectorAll(sel); };

  // ── State ────────────────────────────────────────────────────────

  var state = {
    imageBase64: null,
    imageWidth: 0,
    imageHeight: 0,
    calibPoints: [null, null, null, null], // { pixelX, pixelY }
    currentCalibIdx: 0,
    extractedData: null,
    extractedMeta: null,
  };

  // ── DOM refs ─────────────────────────────────────────────────────

  var dropZone     = $('#drop-zone');
  var fileInput    = $('#file-input');
  var canvas       = $('#plot-canvas');
  var ctx          = canvas.getContext('2d');
  var imgInfo      = $('#image-info');
  var imgDims      = $('#img-dimensions');
  var calibSection = $('#calibration-section');
  var detectSection = $('#detection-section');
  var resultsSection = $('#results-section');
  var resultsInfo  = $('#results-info');
  var resultsText  = $('#results-text');
  var extractStatus = $('#extract-status');
  var colorPicker  = $('#data-color');
  var colorHex     = $('#data-color-hex');
  var tolSlider    = $('#tolerance');
  var tolVal       = $('#tol-val');
  var btnExtract   = $('#btn-extract');

  var plotImage = new Image();

  // ── Helpers ──────────────────────────────────────────────────────

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function formatResult(data, format) {
    if (!data || data.length === 0) return '';
    if (format === 'json') {
      return JSON.stringify(data.map(function (p) { return { x: p[0], y: p[1] }; }), null, 2);
    }
    var sep = format === 'tsv' ? '\t' : ',';
    var header = 'x' + sep + 'y';
    var rows = data.map(function (p) { return p[0] + sep + p[1]; });
    return header + '\n' + rows.join('\n') + '\n';
  }

  // ── Image Loading ────────────────────────────────────────────────

  function loadImageFromFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var dataUrl = e.target.result;
      // Extract base64 without prefix
      state.imageBase64 = dataUrl.split(',')[1];

      plotImage.onload = function () {
        state.imageWidth = plotImage.naturalWidth;
        state.imageHeight = plotImage.naturalHeight;

        canvas.width = plotImage.naturalWidth;
        canvas.height = plotImage.naturalHeight;

        redrawCanvas();
        show(canvas);
        show(imgInfo);
        imgDims.textContent = plotImage.naturalWidth + ' × ' + plotImage.naturalHeight + 'px';
        hide(dropZone);

        // Show next steps
        show(calibSection);
        show(detectSection);
        resetCalibration();

        // Auto-detect dominant colour
        autoDetectColor();
      };
      plotImage.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  // Drag & drop
  dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', function () {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      loadImageFromFile(e.dataTransfer.files[0]);
    }
  });
  // Also allow clicking the whole drop zone
  dropZone.addEventListener('click', function (e) {
    if (e.target.tagName !== 'INPUT') fileInput.click();
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files.length > 0) {
      loadImageFromFile(fileInput.files[0]);
    }
  });

  // Clear image
  $('#btn-clear-image').addEventListener('click', function () {
    state.imageBase64 = null;
    state.extractedData = null;
    hide(canvas);
    hide(imgInfo);
    hide(calibSection);
    hide(detectSection);
    hide(resultsSection);
    show(dropZone);
    resetCalibration();
  });

  // ── Auto colour detection ────────────────────────────────────────

  function autoDetectColor() {
    fetch('/api/colors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: state.imageBase64, top: 10 }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.colors && data.colors.length > 0) {
          // Find the first non-white, non-grey colour
          for (var i = 0; i < data.colors.length; i++) {
            var c = data.colors[i];
            if (c.r > 200 && c.g > 200 && c.b > 200) continue;
            var range = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
            if (range < 30 && Math.max(c.r, c.g, c.b) > 50) continue;
            colorPicker.value = c.hex;
            colorHex.value = c.hex;
            return;
          }
        }
      })
      .catch(function () { /* ignore */ });
  }

  // ── Canvas Drawing ───────────────────────────────────────────────

  function redrawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(plotImage, 0, 0);

    // Draw calibration markers
    var labels = ['X₁', 'X₂', 'Y₁', 'Y₂'];
    var colors = ['#e94560', '#e94560', '#53a8b6', '#53a8b6'];
    for (var i = 0; i < 4; i++) {
      var pt = state.calibPoints[i];
      if (!pt) continue;
      ctx.save();
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 2;

      // Crosshair
      ctx.beginPath();
      ctx.moveTo(pt.pixelX - 10, pt.pixelY);
      ctx.lineTo(pt.pixelX + 10, pt.pixelY);
      ctx.moveTo(pt.pixelX, pt.pixelY - 10);
      ctx.lineTo(pt.pixelX, pt.pixelY + 10);
      ctx.stroke();

      // Circle
      ctx.beginPath();
      ctx.arc(pt.pixelX, pt.pixelY, 8, 0, Math.PI * 2);
      ctx.stroke();

      // Label
      ctx.fillStyle = colors[i];
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(labels[i], pt.pixelX + 12, pt.pixelY - 4);
      ctx.restore();
    }

    // Draw extracted data points
    if (state.extractedData && state.extractedData.length > 0) {
      // We need to reverse-transform data→pixel, but we don't have that easily.
      // Instead, re-fetch or store pixel coords. For now, skip overlay.
      // TODO: overlay detected points on canvas
    }
  }

  // ── Calibration ──────────────────────────────────────────────────

  function resetCalibration() {
    state.calibPoints = [null, null, null, null];
    state.currentCalibIdx = 0;
    $$('.calib-pixel').forEach(function (el) { el.textContent = '—'; });
    $$('.calib-value').forEach(function (el) { el.value = ''; });
    updateCalibHighlight();
  }

  function updateCalibHighlight() {
    $$('.calib-row').forEach(function (row, i) {
      row.style.opacity = (i === state.currentCalibIdx) ? '1' : '0.5';
      row.style.borderLeftColor = (i === state.currentCalibIdx) ? '#e94560' : 'transparent';
      row.style.borderLeftWidth = '3px';
      row.style.borderLeftStyle = 'solid';
      row.style.paddingLeft = '8px';
    });
  }

  // Click on canvas to place calibration point
  canvas.addEventListener('click', function (e) {
    if (state.currentCalibIdx >= 4) return;

    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    var px = Math.round((e.clientX - rect.left) * scaleX);
    var py = Math.round((e.clientY - rect.top) * scaleY);

    var idx = state.currentCalibIdx;
    state.calibPoints[idx] = { pixelX: px, pixelY: py };

    var row = $('.calib-row[data-idx="' + idx + '"]');
    row.querySelector('.calib-pixel').textContent = '(' + px + ', ' + py + ')';

    state.currentCalibIdx++;
    updateCalibHighlight();
    redrawCanvas();
  });

  // Manual calibrate button stays active
  $('#btn-manual-calib').addEventListener('click', function () {
    $('#btn-manual-calib').classList.add('active');
    $('#btn-auto-calib').classList.remove('active');
    resetCalibration();
  });

  // ── Colour sync ──────────────────────────────────────────────────

  colorPicker.addEventListener('input', function () {
    colorHex.value = colorPicker.value;
  });
  colorHex.addEventListener('change', function () {
    if (/^#[0-9a-fA-F]{6}$/.test(colorHex.value)) {
      colorPicker.value = colorHex.value;
    }
  });
  tolSlider.addEventListener('input', function () {
    tolVal.textContent = tolSlider.value;
  });

  // ── Export format change ─────────────────────────────────────────

  $('#export-format').addEventListener('change', function () {
    if (state.extractedData) {
      resultsText.value = formatResult(state.extractedData, $('#export-format').value);
    }
  });

  // ── Extract ──────────────────────────────────────────────────────

  btnExtract.addEventListener('click', async function () {
    if (!state.imageBase64) {
      extractStatus.textContent = 'Please upload an image first.';
      show(extractStatus);
      return;
    }

    // Build axis config from calibration points
    var points = [];
    var allSet = true;
    for (var i = 0; i < 4; i++) {
      var pt = state.calibPoints[i];
      var row = $('.calib-row[data-idx="' + i + '"]');
      var val = parseFloat(row.querySelector('.calib-value').value);
      if (!pt || isNaN(val)) { allSet = false; break; }

      if (i < 2) {
        // X calibration points
        points.push({ pixel: [pt.pixelX, pt.pixelY], value: [val, null] });
      } else {
        // Y calibration points
        points.push({ pixel: [pt.pixelX, pt.pixelY], value: [null, val] });
      }
    }

    if (!allSet) {
      extractStatus.textContent = 'Please set all 4 calibration points and values.';
      show(extractStatus);
      return;
    }

    btnExtract.disabled = true;
    show(extractStatus);
    extractStatus.textContent = 'Extracting...';

    try {
      var axisConfig = {
        type: 'xy',
        scale: { x: $('#scale-x').value, y: $('#scale-y').value },
        points: points,
      };

      var resp = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: state.imageBase64,
          axes: axisConfig,
          options: {
            color: colorPicker.value,
            tolerance: parseInt(tolSlider.value, 10),
            method: $('#det-method').value,
          },
        }),
      });

      var result = await resp.json();
      if (result.error) throw new Error(result.error);

      state.extractedData = result.data;
      state.extractedMeta = {
        axisConfig: axisConfig,
        metadata: result.metadata,
      };

      // Show results
      show(resultsSection);
      resultsInfo.textContent = '✅ Extracted ' + state.extractedData.length + ' data points';
      resultsText.value = formatResult(state.extractedData, $('#export-format').value);
      extractStatus.textContent = 'Done!';
      btnExtract.disabled = false;

      redrawCanvas();
    } catch (err) {
      extractStatus.textContent = 'Error: ' + err.message;
      btnExtract.disabled = false;
    }
  });

  // ── Download & Copy ──────────────────────────────────────────────

  $('#btn-download').addEventListener('click', function () {
    if (!state.extractedData) return;
    var format = $('#export-format').value;
    var data = formatResult(state.extractedData, format);
    var blob = new Blob([data], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'plot-data.' + format;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#btn-copy').addEventListener('click', function () {
    if (!state.extractedData) return;
    var format = $('#export-format').value;
    var data = formatResult(state.extractedData, format);
    navigator.clipboard.writeText(data).then(function () {
      var orig = resultsInfo.textContent;
      resultsInfo.textContent = '📋 Copied to clipboard!';
      setTimeout(function () { resultsInfo.textContent = orig; }, 2000);
    });
  });

  // ── Auto-calibrate (OCR) ─────────────────────────────────────────

  $('#btn-auto-calib').addEventListener('click', async function () {
    if (!state.imageBase64) return;

    $('#btn-auto-calib').classList.add('active');
    $('#btn-manual-calib').classList.remove('active');

    var msgEl = $('#auto-calib-msg');
    var statusEl = $('#auto-calib-status');
    show(statusEl);
    msgEl.textContent = '🔍 Running OCR on tick labels...';

    try {
      var resp = await fetch('/api/detect-axes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: state.imageBase64 }),
      });
      var data = await resp.json();

      if (data.axes) {
        // Fill in calibration from OCR
        data.axes.points.forEach(function (pt, i) {
          state.calibPoints[i] = { pixelX: pt.pixel[0], pixelY: pt.pixel[1] };
          var row = $('.calib-row[data-idx="' + i + '"]');
          row.querySelector('.calib-pixel').textContent = '(' + pt.pixel[0] + ', ' + pt.pixel[1] + ')';
          var val = pt.value[0] != null ? pt.value[0] : pt.value[1];
          if (val != null) row.querySelector('.calib-value').value = val;
        });
        state.currentCalibIdx = 4;
        updateCalibHighlight();

        if (data.axes.scale) {
          $('#scale-x').value = data.axes.scale.x || 'linear';
          $('#scale-y').value = data.axes.scale.y || 'linear';
        }

        redrawCanvas();
        var pct = (data.confidence * 100).toFixed(0);
        msgEl.textContent = '✓ OCR detected axes (confidence: ' + pct + '%). Review values above.';
      } else {
        msgEl.textContent = '⚠ Could not auto-detect axes. Please calibrate manually.';
      }
    } catch (err) {
      msgEl.textContent = 'Error: ' + err.message;
    }
  });

  // ── Init ─────────────────────────────────────────────────────────

  updateCalibHighlight();

})();
