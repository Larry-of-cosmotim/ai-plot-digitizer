/**
 * Smart auto-extraction pipeline.
 *
 * Combines OCR (Tesseract.js) and optional vision model analysis to
 * automatically detect axes, colours, and extract data from a plot image
 * with zero manual configuration.
 *
 * @module ai/auto
 */

import { recognizeText, parseTickLabels, buildAxesFromTicks } from './ocr.js';
import { createVisionAdapter } from './vision.js';
import { loadImage, analyzeColors } from '../core/image.js';
import { extractData, formatResult } from '../core/extraction.js';
import { createAxesTransform } from '../core/axes.js';

/**
 * @typedef {object} AutoExtractionResult
 * @property {number[][]} data - Extracted [x, y] pairs.
 * @property {object} metadata
 * @property {import('./vision.js').VisionAnalysis} [visionAnalysis]
 * @property {import('./ocr.js').OcrResult} [ocrResult]
 * @property {object} axisConfig - The axes config that was used.
 * @property {string} detectionSource - "ocr", "vision", or "combined"
 */

/**
 * Fully automatic data extraction pipeline.
 *
 * Strategy:
 * 1. Run OCR to read tick labels → infer axis ranges + scale types
 * 2. If vision provider is available, also query vision model
 * 3. Merge/pick the best axis config
 * 4. Detect dominant non-background colours → pick data series colour
 * 5. Extract data points
 *
 * @param {string} imagePath
 * @param {object} [options]
 * @param {string} [options.visionProvider] - "openai" | "anthropic" | "google" | null
 * @param {object} [options.visionOptions] - Adapter options (apiKey, model, etc.)
 * @param {string} [options.color] - Override auto-detected colour.
 * @param {number} [options.tolerance=40]
 * @param {string} [options.method='averaging']
 * @param {string} [options.format='csv']
 * @param {function} [options.onProgress] - Progress callback: (step, detail) => void
 * @returns {Promise<AutoExtractionResult>}
 */
export async function autoExtract(imagePath, options = {}) {
  const {
    visionProvider,
    visionOptions = {},
    color: colorOverride,
    tolerance = 40,
    method = 'averaging',
    format = 'csv',
    onProgress,
  } = options;

  const progress = onProgress || (() => {});

  // ─── 1. Load image & analyse colours ─────────────────
  progress('image', 'Loading image...');
  const image = await loadImage(imagePath);
  const colors = analyzeColors(image.rawData, image.width * image.height, {
    tolerance: 120,
    top: 10,
  });

  // Pick the most prominent non-white/non-grey colour as data series
  const dataColor = colorOverride || pickDataColor(colors);
  progress('colors', `Data colour: ${dataColor}`);

  // ─── 2. OCR tick labels ──────────────────────────────
  progress('ocr', 'Running OCR on tick labels...');
  let ocrResult = null;
  let ocrAxes = null;
  try {
    ocrResult = await recognizeText(imagePath);
    const ticks = parseTickLabels(ocrResult.blocks, image.width, image.height);
    ocrAxes = buildAxesFromTicks(ticks);
    if (ocrAxes) {
      progress('ocr', `OCR found ${ticks.xTicks.values.length} X ticks, ${ticks.yTicks.values.length} Y ticks`);
    } else {
      progress('ocr', 'OCR could not determine axis ranges');
    }
  } catch (err) {
    progress('ocr', `OCR failed: ${err.message}`);
  }

  // ─── 3. Vision model (optional) ─────────────────────
  let visionAnalysis = null;
  let visionAxes = null;
  if (visionProvider) {
    progress('vision', `Querying ${visionProvider} vision model...`);
    try {
      const adapter = createVisionAdapter(visionProvider, visionOptions);
      visionAnalysis = await adapter.analyze(imagePath);
      progress('vision', `Vision confidence: ${(visionAnalysis.confidence * 100).toFixed(0)}%`);

      // Build axis config from vision analysis
      if (visionAnalysis.ranges && visionAnalysis.confidence > 0.3) {
        visionAxes = buildAxesFromVision(visionAnalysis, image.width, image.height);
      }
    } catch (err) {
      progress('vision', `Vision failed: ${err.message}`);
    }
  }

  // ─── 4. Pick best axis config ────────────────────────
  let axisConfig;
  let detectionSource;

  if (visionAxes && ocrAxes) {
    // Prefer vision if high confidence, otherwise OCR
    if (visionAnalysis.confidence > 0.7) {
      axisConfig = visionAxes;
      detectionSource = 'vision';
    } else {
      axisConfig = ocrAxes;
      detectionSource = 'ocr';
    }
    detectionSource = 'combined';
  } else if (visionAxes) {
    axisConfig = visionAxes;
    detectionSource = 'vision';
  } else if (ocrAxes) {
    axisConfig = ocrAxes;
    detectionSource = 'ocr';
  } else {
    throw new Error(
      'Could not auto-detect axes from this image. ' +
        'Try providing axis calibration manually with --axes.'
    );
  }

  progress('axes', `Using ${detectionSource} axis detection`);

  // ─── 5. Extract data ────────────────────────────────
  progress('extract', 'Extracting data points...');
  const result = await extractData(imagePath, axisConfig, {
    color: dataColor,
    tolerance,
    method,
  });

  progress('done', `Extracted ${result.data.length} points`);

  return {
    data: result.data,
    metadata: {
      ...result.metadata,
      autoDetected: true,
      detectionSource,
    },
    visionAnalysis,
    ocrResult,
    axisConfig,
    detectionSource,
  };
}

/**
 * Pick the most prominent non-background colour from colour analysis.
 *
 * Skips white, near-white, and grey colours.
 *
 * @param {import('../core/image.js').ColorInfo[]} colors
 * @returns {string} Hex colour string.
 */
function pickDataColor(colors) {
  for (const c of colors) {
    // Skip white/near-white
    if (c.r > 200 && c.g > 200 && c.b > 200) continue;
    // Skip greys (low saturation)
    const maxC = Math.max(c.r, c.g, c.b);
    const minC = Math.min(c.r, c.g, c.b);
    if (maxC - minC < 30 && maxC > 50) continue;
    return c.hex;
  }
  // Fallback to black
  return '#000000';
}

/**
 * Build axis config from vision model analysis.
 *
 * Assumes a standard plot layout where the plot area occupies
 * roughly the center 60-80% of the image.
 *
 * @param {import('./vision.js').VisionAnalysis} analysis
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {import('../core/axes.js').AxisConfig}
 */
function buildAxesFromVision(analysis, imageWidth, imageHeight) {
  const { ranges, scaleTypes } = analysis;

  // Estimate plot area (typical: 15% margins on left/bottom, 5% on right/top)
  const plotLeft = Math.round(imageWidth * 0.15);
  const plotRight = Math.round(imageWidth * 0.90);
  const plotTop = Math.round(imageHeight * 0.08);
  const plotBottom = Math.round(imageHeight * 0.82);

  return {
    type: 'xy',
    scale: {
      x: scaleTypes?.x || 'linear',
      y: scaleTypes?.y || 'linear',
    },
    points: [
      { pixel: [plotLeft, plotBottom], value: [ranges.xmin, null] },
      { pixel: [plotRight, plotBottom], value: [ranges.xmax, null] },
      { pixel: [plotLeft, plotBottom], value: [null, ranges.ymin] },
      { pixel: [plotLeft, plotTop], value: [null, ranges.ymax] },
    ],
  };
}
