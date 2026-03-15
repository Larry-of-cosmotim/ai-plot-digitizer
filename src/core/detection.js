/**
 * Point detection algorithms for plot digitization.
 *
 * Provides colour-based pixel filtering, connected-component blob detection,
 * and an averaging-window algorithm for extracting data from line plots.
 *
 * @module core/detection
 */

/**
 * Parse a colour specification to [r, g, b].
 *
 * @param {string|number[]} color - Hex string "#RRGGBB" or [r, g, b] array.
 * @returns {number[]} [r, g, b]
 */
export function parseColor(color) {
  if (Array.isArray(color)) return color.slice(0, 3);
  const hex = color.replace(/^#/, '');
  if (hex.length !== 6) throw new Error(`Invalid hex colour: ${color}`);
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/**
 * Filter image pixels by colour distance, producing a binary mask.
 *
 * @param {Buffer} rawData - RGBA pixel buffer.
 * @param {number} width - Image width.
 * @param {number} height - Image height.
 * @param {string|number[]} targetColor - Colour to match.
 * @param {number} [tolerance=30] - Max Euclidean distance in RGB space.
 * @returns {Set<number>} Set of flat pixel indices (y * width + x) that match.
 */
export function filterByColor(rawData, width, height, targetColor, tolerance = 30) {
  const [tr, tg, tb] = parseColor(targetColor);
  const tolSq = tolerance * tolerance;
  const mask = new Set();

  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    const dr = rawData[offset] - tr;
    const dg = rawData[offset + 1] - tg;
    const db = rawData[offset + 2] - tb;
    if (dr * dr + dg * dg + db * db <= tolSq) {
      mask.add(i);
    }
  }
  return mask;
}

/**
 * Connected-component blob detection with 8-connectivity.
 *
 * @param {Set<number>} binaryData - Foreground pixel indices.
 * @param {number} width
 * @param {number} height
 * @param {object} [options]
 * @param {number} [options.minDiameter=0] - Minimum blob diameter (pixels).
 * @param {number} [options.maxDiameter=5000] - Maximum blob diameter (pixels).
 * @returns {BlobInfo[]}
 *
 * @typedef {object} BlobInfo
 * @property {{ x: number, y: number }} centroid - Centre of mass (+ 0.5 px offset).
 * @property {number} area - Pixel count.
 * @property {number} moment - Second moment of inertia about centroid.
 * @property {number} diameter - Equivalent circle diameter.
 */
export function detectBlobs(binaryData, width, height, options = {}) {
  const minDia = options.minDiameter ?? 0;
  const maxDia = options.maxDiameter ?? 5000;

  const visited = new Set();
  const blobs = [];

  for (const idx of binaryData) {
    if (visited.has(idx)) continue;
    visited.add(idx);

    const startX = idx % width;
    const startY = Math.floor(idx / width);

    // BFS flood-fill
    const pixels = [{ x: startX, y: startY }];
    let cx = startX;
    let cy = startY;
    let count = 1;

    let qi = 0;
    while (qi < pixels.length) {
      const { x: bx, y: by } = pixels[qi++];
      for (let nx = bx - 1; nx <= bx + 1; nx++) {
        for (let ny = by - 1; ny <= by + 1; ny++) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (visited.has(ni) || !binaryData.has(ni)) continue;
          visited.add(ni);
          pixels.push({ x: nx, y: ny });
          // Running average centroid
          cx = (cx * count + nx) / (count + 1);
          cy = (cy * count + ny) / (count + 1);
          count++;
        }
      }
    }

    // Compute moment of inertia
    let moment = 0;
    for (const { x, y } of pixels) {
      moment += (x - cx) * (x - cx) + (y - cy) * (y - cy);
    }

    const diameter = 2 * Math.sqrt(count / Math.PI);
    if (diameter >= minDia && diameter <= maxDia) {
      blobs.push({
        centroid: { x: cx + 0.5, y: cy + 0.5 },
        area: count,
        moment,
        diameter,
      });
    }
  }

  return blobs;
}

/**
 * Averaging-window algorithm for line-plot data extraction.
 *
 * Scans each column for foreground blobs (vertical groups), then merges
 * nearby detections within a spatial window to produce averaged points.
 *
 * @param {Set<number>} binaryData - Foreground pixel indices.
 * @param {number} width
 * @param {number} height
 * @param {number} [dx=10] - Horizontal merge window (pixels).
 * @param {number} [dy=10] - Vertical gap threshold / merge window (pixels).
 * @returns {{ x: number, y: number }[]} Detected pixel positions.
 */
export function averagingWindow(binaryData, width, height, dx = 10, dy = 10) {
  // Phase 1: scan columns, find vertical blobs
  const candidates = []; // { x, y, alive }

  for (let col = 0; col < width; col++) {
    const blobYs = [];       // average y of each vertical blob
    const blobCounts = [];
    let lastRow = -2 * dy;   // sentinel

    for (let row = 0; row < height; row++) {
      if (binaryData.has(row * width + col)) {
        if (row > lastRow + dy) {
          // New vertical blob
          blobYs.push(row);
          blobCounts.push(1);
        } else {
          // Extend current blob
          const bi = blobYs.length - 1;
          const n = blobCounts[bi];
          blobYs[bi] = (blobYs[bi] * n + row) / (n + 1);
          blobCounts[bi] = n + 1;
        }
        lastRow = row;
      }
    }

    for (const blobY of blobYs) {
      candidates.push({ x: col + 0.5, y: blobY + 0.5, alive: true });
    }
  }

  if (candidates.length === 0) return [];

  // Phase 2: merge nearby candidates within window
  const results = [];

  for (let i = 0; i < candidates.length; i++) {
    if (!candidates[i].alive) continue;

    let avgX = candidates[i].x;
    let avgY = candidates[i].y;
    let matches = 1;

    for (let j = i + 1; j < candidates.length; j++) {
      if (!candidates[j].alive) continue;
      // Stop searching if too far in x
      if (candidates[j].x > candidates[i].x + 2 * dx) break;

      if (
        Math.abs(candidates[j].x - candidates[i].x) <= dx &&
        Math.abs(candidates[j].y - candidates[i].y) <= dy
      ) {
        avgX = (avgX * matches + candidates[j].x) / (matches + 1);
        avgY = (avgY * matches + candidates[j].y) / (matches + 1);
        matches++;
        candidates[j].alive = false;
      }
    }
    candidates[i].alive = false;
    results.push({ x: avgX, y: avgY });
  }

  return results;
}
