/**
 * Data extraction orchestrator.
 *
 * Ties together image loading, axis calibration, colour filtering,
 * point detection and export into a single pipeline.
 *
 * @module core/extraction
 */

import { loadImage } from './image.js';
import { createAxesTransform } from './axes.js';
import { filterByColor, detectBlobs, averagingWindow } from './detection.js';
import { exportCSV, exportJSON, exportTSV } from './export.js';

/**
 * Extract data points from a plot image.
 *
 * @param {string} imagePath - Path to the image file.
 * @param {import('./axes.js').AxisConfig} axisConfig - Axis calibration config.
 * @param {object} [options]
 * @param {string|number[]} [options.color="#000000"] - Target colour for detection.
 * @param {number} [options.tolerance=30] - Colour tolerance (Euclidean RGB distance).
 * @param {string} [options.method="averaging"] - Detection method: "blob" | "averaging".
 * @param {number} [options.dx=10] - Averaging window / merge distance in X (pixels).
 * @param {number} [options.dy=10] - Averaging window / merge distance in Y (pixels).
 * @param {number} [options.minDiameter=0] - Blob min diameter.
 * @param {number} [options.maxDiameter=5000] - Blob max diameter.
 * @param {object} [options.crop] - Optional crop region.
 * @returns {Promise<ExtractionResult>}
 *
 * @typedef {object} ExtractionResult
 * @property {number[][]} data - Array of [x, y] data-coordinate pairs.
 * @property {object} metadata
 */
export async function extractData(imagePath, axisConfig, options = {}) {
  const {
    color = '#000000',
    tolerance = 30,
    method = 'averaging',
    dx = 10,
    dy = 10,
    minDiameter = 0,
    maxDiameter = 5000,
    crop,
  } = options;

  // 1. Load image
  const image = await loadImage(imagePath, { crop });

  // 2. Create axis transform
  const axes = createAxesTransform(axisConfig);

  // 3. Apply colour filter
  const mask = filterByColor(image.rawData, image.width, image.height, color, tolerance);

  // 4. Run detection
  let pixelPoints;
  if (method === 'blob') {
    const blobs = detectBlobs(mask, image.width, image.height, {
      minDiameter,
      maxDiameter,
    });
    pixelPoints = blobs.map((b) => b.centroid);
  } else {
    // averaging window (default)
    pixelPoints = averagingWindow(mask, image.width, image.height, dx, dy);
  }

  // 5. Convert to data coordinates
  const data = pixelPoints.map((p) => {
    const d = axes.pixelToData(p.x, p.y);
    return [d.x, d.y];
  });

  // 6. Sort by x
  data.sort((a, b) => a[0] - b[0]);

  const metadata = {
    source: imagePath,
    points: data.length,
    method,
    color: typeof color === 'string' ? color : `rgb(${color.join(',')})`,
    tolerance,
    axisConfig,
  };

  return { data, metadata };
}

/**
 * Format extraction results into a string.
 *
 * @param {ExtractionResult} result
 * @param {string} [format="csv"] - "csv" | "json" | "tsv"
 * @param {object} [options] - Passed to the format function.
 * @returns {string}
 */
export function formatResult(result, format = 'csv', options = {}) {
  switch (format) {
    case 'json':
      return exportJSON(result.data, result.metadata);
    case 'tsv':
      return exportTSV(result.data, result.metadata, options);
    case 'csv':
    default:
      return exportCSV(result.data, result.metadata, options);
  }
}
