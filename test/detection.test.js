import { describe, test, expect } from '@jest/globals';
import { filterByColor, detectBlobs, averagingWindow, parseColor } from '../src/core/detection.js';

describe('parseColor', () => {
  test('parses hex string', () => {
    expect(parseColor('#FF0000')).toEqual([255, 0, 0]);
    expect(parseColor('#00ff00')).toEqual([0, 255, 0]);
  });

  test('passes through array', () => {
    expect(parseColor([128, 64, 32])).toEqual([128, 64, 32]);
  });

  test('throws on invalid hex', () => {
    expect(() => parseColor('#FFF')).toThrow('Invalid');
  });
});

describe('filterByColor', () => {
  test('detects matching pixels in synthetic image', () => {
    // 4×4 image, all white except pixel (1,1) and (2,2) are red
    const w = 4, h = 4;
    const buf = Buffer.alloc(w * h * 4, 0);
    // Fill white
    for (let i = 0; i < w * h; i++) {
      buf[i * 4] = 255;
      buf[i * 4 + 1] = 255;
      buf[i * 4 + 2] = 255;
      buf[i * 4 + 3] = 255;
    }
    // Set (1,1) to red
    const idx1 = (1 * w + 1) * 4;
    buf[idx1] = 255; buf[idx1 + 1] = 0; buf[idx1 + 2] = 0;
    // Set (2,2) to red
    const idx2 = (2 * w + 2) * 4;
    buf[idx2] = 255; buf[idx2 + 1] = 0; buf[idx2 + 2] = 0;

    const mask = filterByColor(buf, w, h, '#FF0000', 30);
    expect(mask.size).toBe(2);
    expect(mask.has(1 * w + 1)).toBe(true);
    expect(mask.has(2 * w + 2)).toBe(true);
  });

  test('tolerance works', () => {
    const w = 2, h = 1;
    const buf = Buffer.from([
      200, 10, 10, 255,  // almost red
      100, 100, 100, 255, // grey
    ]);

    // Tight tolerance — only exact match
    const tight = filterByColor(buf, w, h, '#FF0000', 10);
    expect(tight.size).toBe(0);

    // Loose tolerance
    const loose = filterByColor(buf, w, h, '#FF0000', 100);
    expect(loose.size).toBe(1);
    expect(loose.has(0)).toBe(true);
  });
});

describe('detectBlobs', () => {
  test('finds single blob and computes centroid', () => {
    // 10×10 image with a 3×3 block at (3,3)-(5,5)
    const w = 10, h = 10;
    const mask = new Set();
    for (let y = 3; y <= 5; y++) {
      for (let x = 3; x <= 5; x++) {
        mask.add(y * w + x);
      }
    }

    const blobs = detectBlobs(mask, w, h);
    expect(blobs.length).toBe(1);
    expect(blobs[0].area).toBe(9);
    // Centroid should be at (4, 4) + 0.5 offset = (4.5, 4.5)
    expect(blobs[0].centroid.x).toBeCloseTo(4.5, 1);
    expect(blobs[0].centroid.y).toBeCloseTo(4.5, 1);
    expect(blobs[0].diameter).toBeCloseTo(2 * Math.sqrt(9 / Math.PI), 3);
  });

  test('finds two separate blobs', () => {
    const w = 20, h = 10;
    const mask = new Set();
    // Blob 1: single pixel at (2, 2)
    mask.add(2 * w + 2);
    // Blob 2: single pixel at (15, 7)
    mask.add(7 * w + 15);

    const blobs = detectBlobs(mask, w, h);
    expect(blobs.length).toBe(2);
  });

  test('respects diameter filter', () => {
    const w = 20, h = 20;
    const mask = new Set();
    // Small blob: 1 pixel
    mask.add(2 * w + 2);
    // Bigger blob: 5×5 = 25 pixels
    for (let y = 10; y < 15; y++) {
      for (let x = 10; x < 15; x++) {
        mask.add(y * w + x);
      }
    }

    // Only big blobs (diameter > 3)
    const big = detectBlobs(mask, w, h, { minDiameter: 3 });
    expect(big.length).toBe(1);
    expect(big[0].area).toBe(25);

    // Only small blobs (diameter < 2)
    const small = detectBlobs(mask, w, h, { maxDiameter: 2 });
    expect(small.length).toBe(1);
    expect(small[0].area).toBe(1);
  });
});

describe('averagingWindow', () => {
  test('detects points from a horizontal line', () => {
    // 100×50 image with a horizontal line of pixels at row 25
    const w = 100, h = 50;
    const mask = new Set();
    for (let x = 10; x < 90; x++) {
      mask.add(25 * w + x);
    }

    const points = averagingWindow(mask, w, h, 5, 5);
    // Should produce multiple averaged points along the line
    expect(points.length).toBeGreaterThan(0);
    // All y values should be near row 25.5
    for (const p of points) {
      expect(p.y).toBeCloseTo(25.5, 1);
    }
  });

  test('detects two separate vertical blobs in one column', () => {
    const w = 10, h = 100;
    const mask = new Set();
    // Blob at rows 10-12
    for (let r = 10; r <= 12; r++) mask.add(r * w + 5);
    // Blob at rows 80-82 (gap > dy)
    for (let r = 80; r <= 82; r++) mask.add(r * w + 5);

    const points = averagingWindow(mask, w, h, 5, 5);
    expect(points.length).toBe(2);
  });

  test('returns empty for empty mask', () => {
    const points = averagingWindow(new Set(), 100, 100, 5, 5);
    expect(points).toEqual([]);
  });
});
