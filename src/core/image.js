/**
 * Image loading and pixel access module.
 *
 * Uses sharp for decoding and canvas for pixel-level access.
 * @module core/image
 */

import sharp from 'sharp';
import { createCanvas, loadImage as canvasLoadImage } from 'canvas';

/**
 * Load an image file and return pixel access helpers.
 *
 * @param {string} filePath - Path to PNG, JPG, or SVG image.
 * @param {object} [options] - Optional settings.
 * @param {object} [options.crop] - Crop region { left, top, width, height }.
 * @returns {Promise<ImageData>} Loaded image with pixel accessors.
 *
 * @typedef {object} ImageData
 * @property {number} width
 * @property {number} height
 * @property {Buffer} rawData - Raw RGBA pixel buffer.
 * @property {function(number, number): number[]} getPixel - Returns [r, g, b, a] at (x, y).
 */
export async function loadImage(filePath, options = {}) {
  let pipeline = sharp(filePath);

  if (options.crop) {
    pipeline = pipeline.extract(options.crop);
  }

  // Force RGBA output
  const { data, info } = await pipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  /**
   * Get the RGBA value of a single pixel.
   *
   * @param {number} x - Column (0-indexed).
   * @param {number} y - Row (0-indexed).
   * @returns {number[]} [r, g, b, a]
   */
  function getPixel(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      throw new RangeError(`Pixel (${x}, ${y}) out of bounds [${width}×${height}]`);
    }
    const offset = (y * width + x) * 4;
    return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
  }

  return { width, height, rawData: data, getPixel };
}

/**
 * Analyse dominant colours in an image.
 *
 * Groups pixels by RGB-space distance and returns the top colour clusters
 * sorted by pixel count (descending).
 *
 * @param {Buffer} rawData - RGBA pixel buffer.
 * @param {number} pixelCount - Total number of pixels (width * height).
 * @param {object} [options]
 * @param {number} [options.tolerance=120] - Max Euclidean RGB distance to merge into one group.
 * @param {number} [options.top=10] - Number of top colours to return.
 * @returns {ColorInfo[]} Top colours.
 *
 * @typedef {object} ColorInfo
 * @property {number} r
 * @property {number} g
 * @property {number} b
 * @property {string} hex - e.g. "#FF0000"
 * @property {number} pixels - Number of pixels in this group.
 * @property {number} percentage - Percentage of total image pixels.
 */
export function analyzeColors(rawData, pixelCount, options = {}) {
  const tolerance = options.tolerance ?? 120;
  const top = options.top ?? 10;
  const tolSq = tolerance * tolerance;

  // Color groups: each has running average and count
  const groups = [];

  for (let i = 0; i < rawData.length; i += 4) {
    let r = rawData[i];
    let g = rawData[i + 1];
    let b = rawData[i + 2];
    const a = rawData[i + 3];

    // Treat transparent pixels as white
    if (a === 0) {
      r = 255;
      g = 255;
      b = 255;
    }

    let matched = false;
    for (const group of groups) {
      const dr = group.r - r;
      const dg = group.g - g;
      const db = group.b - b;
      if (dr * dr + dg * dg + db * db <= tolSq) {
        const n = group.count;
        group.r = (group.r * n + r) / (n + 1);
        group.g = (group.g * n + g) / (n + 1);
        group.b = (group.b * n + b) / (n + 1);
        group.count += 1;
        matched = true;
        break;
      }
    }

    if (!matched) {
      groups.push({ r, g, b, count: 1 });
    }
  }

  groups.sort((a, b) => b.count - a.count);

  const toHex = (v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase();

  return groups.slice(0, top).map((g) => ({
    r: Math.round(g.r),
    g: Math.round(g.g),
    b: Math.round(g.b),
    hex: `#${toHex(g.r)}${toHex(g.g)}${toHex(g.b)}`,
    pixels: g.count,
    percentage: +((100 * g.count) / pixelCount).toFixed(2),
  }));
}
