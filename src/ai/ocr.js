/**
 * OCR layer for reading axis labels and tick marks from plot images.
 *
 * Uses Tesseract.js for text recognition without external dependencies.
 *
 * @module ai/ocr
 */

import Tesseract from 'tesseract.js';

/**
 * Run OCR on an image and return all detected text blocks with positions.
 *
 * @param {string} imagePath - Path to the image.
 * @param {object} [options]
 * @param {string} [options.lang='eng'] - Tesseract language code.
 * @returns {Promise<OcrResult>}
 *
 * @typedef {object} OcrResult
 * @property {string} fullText - All detected text concatenated.
 * @property {OcrBlock[]} blocks - Individual text blocks with bounding boxes.
 * @property {number} confidence - Average confidence (0-100).
 *
 * @typedef {object} OcrBlock
 * @property {string} text
 * @property {number} confidence
 * @property {{ x: number, y: number, width: number, height: number }} bbox
 */
export async function recognizeText(imagePath, options = {}) {
  const lang = options.lang || 'eng';

  const { data } = await Tesseract.recognize(imagePath, lang);

  const blocks = data.words.map((w) => ({
    text: w.text,
    confidence: w.confidence,
    bbox: {
      x: w.bbox.x0,
      y: w.bbox.y0,
      width: w.bbox.x1 - w.bbox.x0,
      height: w.bbox.y1 - w.bbox.y0,
    },
  }));

  const avgConf =
    blocks.length > 0
      ? blocks.reduce((sum, b) => sum + b.confidence, 0) / blocks.length
      : 0;

  return {
    fullText: data.text,
    blocks,
    confidence: avgConf,
  };
}

/**
 * Try to parse tick-mark labels from OCR blocks and infer axis ranges.
 *
 * Heuristic approach:
 * - Identify numbers along bottom edge → X axis tick labels
 * - Identify numbers along left edge → Y axis tick labels
 * - Infer min/max from those numbers
 *
 * @param {OcrBlock[]} blocks - OCR text blocks.
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {TickParseResult}
 *
 * @typedef {object} TickParseResult
 * @property {{ values: number[], positions: number[] }} xTicks
 * @property {{ values: number[], positions: number[] }} yTicks
 * @property {{ xmin: number|null, xmax: number|null, ymin: number|null, ymax: number|null }} inferredRange
 * @property {string|null} xScaleHint - "linear" or "log" or null
 * @property {string|null} yScaleHint
 */
export function parseTickLabels(blocks, imageWidth, imageHeight) {
  const bottomThreshold = imageHeight * 0.75;
  const leftThreshold = imageWidth * 0.25;

  const xCandidates = [];
  const yCandidates = [];

  for (const block of blocks) {
    const num = parseNumber(block.text);
    if (num === null) continue;

    const centerY = block.bbox.y + block.bbox.height / 2;
    const centerX = block.bbox.x + block.bbox.width / 2;

    // Bottom edge numbers → X axis
    if (centerY > bottomThreshold) {
      xCandidates.push({ value: num, position: centerX });
    }
    // Left edge numbers → Y axis
    if (centerX < leftThreshold) {
      yCandidates.push({ value: num, position: centerY });
    }
  }

  // Sort by position
  xCandidates.sort((a, b) => a.position - b.position);
  yCandidates.sort((a, b) => a.position - b.position);

  const xValues = xCandidates.map((c) => c.value);
  const yValues = yCandidates.map((c) => c.value);

  return {
    xTicks: {
      values: xValues,
      positions: xCandidates.map((c) => c.position),
    },
    yTicks: {
      values: yValues,
      positions: yCandidates.map((c) => c.position),
    },
    inferredRange: {
      xmin: xValues.length > 0 ? Math.min(...xValues) : null,
      xmax: xValues.length > 0 ? Math.max(...xValues) : null,
      ymin: yValues.length > 0 ? Math.min(...yValues) : null,
      ymax: yValues.length > 0 ? Math.max(...yValues) : null,
    },
    xScaleHint: detectScaleType(xValues),
    yScaleHint: detectScaleType(yValues),
  };
}

/**
 * Try to parse a string as a number (supports scientific notation, commas).
 *
 * @param {string} text
 * @returns {number|null}
 */
function parseNumber(text) {
  const cleaned = text.replace(/[,\s]/g, '').replace(/^[—–-]$/, '');
  if (cleaned === '') return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Heuristic: detect if a sequence of tick values looks logarithmic.
 *
 * If ratios between consecutive values are roughly constant → log scale.
 *
 * @param {number[]} values - Sorted tick values.
 * @returns {string|null} "linear", "log", or null
 */
function detectScaleType(values) {
  if (values.length < 3) return null;

  // Sort numerically ascending for analysis (values may arrive in position order)
  const sorted = [...values].sort((a, b) => a - b);

  // Check for log: ratios between consecutive values should be constant
  const positives = sorted.filter((v) => v > 0);
  if (positives.length >= 3) {
    const ratios = [];
    for (let i = 1; i < positives.length; i++) {
      ratios.push(positives[i] / positives[i - 1]);
    }
    const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;
    const allClose = ratios.every((r) => Math.abs(r - avgRatio) / avgRatio < 0.3);
    if (allClose && avgRatio > 1.5) return 'log';
  }

  // Check for linear: differences between consecutive values should be constant
  const diffs = [];
  for (let i = 1; i < sorted.length; i++) {
    diffs.push(sorted[i] - sorted[i - 1]);
  }
  const avgDiff = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  if (avgDiff !== 0) {
    const allClose = diffs.every((d) => Math.abs(d - avgDiff) / Math.abs(avgDiff) < 0.3);
    if (allClose) return 'linear';
  }

  return null;
}

/**
 * Build an approximate axis calibration from OCR-parsed tick labels.
 *
 * Uses the first and last tick labels on each axis to define
 * the 4 calibration points.
 *
 * @param {TickParseResult} ticks
 * @returns {import('../core/axes.js').AxisConfig | null}
 */
export function buildAxesFromTicks(ticks) {
  const { xTicks, yTicks, xScaleHint, yScaleHint } = ticks;

  if (xTicks.values.length < 2 || yTicks.values.length < 2) {
    return null;
  }

  const xFirst = 0;
  const xLast = xTicks.values.length - 1;
  const yFirst = 0;
  const yLast = yTicks.values.length - 1;

  return {
    type: 'xy',
    scale: {
      x: xScaleHint || 'linear',
      y: yScaleHint || 'linear',
    },
    points: [
      { pixel: [xTicks.positions[xFirst], yTicks.positions[yLast]], value: [xTicks.values[xFirst], null] },
      { pixel: [xTicks.positions[xLast], yTicks.positions[yLast]], value: [xTicks.values[xLast], null] },
      { pixel: [xTicks.positions[xFirst], yTicks.positions[yLast]], value: [null, yTicks.values[yLast]] },
      { pixel: [xTicks.positions[xFirst], yTicks.positions[yFirst]], value: [null, yTicks.values[yFirst]] },
    ],
    _ocrConfidence: ticks.xTicks.values.length + ticks.yTicks.values.length,
  };
}
