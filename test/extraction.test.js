import { describe, test, expect } from '@jest/globals';
import { extractData, formatResult } from '../src/core/extraction.js';
import sharp from 'sharp';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Create a synthetic test image: white background with red dots at known
 * pixel positions.  Returns the path to the PNG file.
 */
async function createTestImage(tmpDir) {
  const w = 500, h = 500;
  // Create white image
  const buf = Buffer.alloc(w * h * 4, 255);

  // Draw red dots (5×5 blocks) at known pixel positions
  const redDots = [
    { px: 100, py: 400 },  // should map to data (12.5, 1.25)
    { px: 200, py: 300 },  // → (37.5, 3.75)
    { px: 300, py: 200 },  // → (62.5, 6.25)
    { px: 400, py: 100 },  // → (87.5, 8.75)
  ];

  for (const dot of redDots) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = dot.px + dx;
        const y = dot.py + dy;
        if (x >= 0 && x < w && y >= 0 && y < h) {
          const off = (y * w + x) * 4;
          buf[off] = 255;     // R
          buf[off + 1] = 0;   // G
          buf[off + 2] = 0;   // B
          buf[off + 3] = 255; // A
        }
      }
    }
  }

  const imgPath = join(tmpDir, 'test_plot.png');
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile(imgPath);

  return imgPath;
}

// Axis config: pixel (50,450) = data (0,0), pixel (450,450) = data (100,0),
//              pixel (50,450) = data (0,0), pixel (50,50) = data (0,10)
const axisConfig = {
  type: 'xy',
  scale: { x: 'linear', y: 'linear' },
  points: [
    { pixel: [50, 450], value: [0, null] },
    { pixel: [450, 450], value: [100, null] },
    { pixel: [50, 450], value: [null, 0] },
    { pixel: [50, 50], value: [null, 10] },
  ],
};

describe('Full extraction pipeline', () => {
  let tmpDir;
  let imgPath;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'aipd-test-'));
    imgPath = await createTestImage(tmpDir);
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('extracts points from synthetic image (blob method)', async () => {
    const result = await extractData(imgPath, axisConfig, {
      color: '#FF0000',
      tolerance: 30,
      method: 'blob',
    });

    expect(result.data.length).toBe(4);
    expect(result.metadata.source).toBe(imgPath);
    expect(result.metadata.method).toBe('blob');

    // Data should be sorted by x
    for (let i = 1; i < result.data.length; i++) {
      expect(result.data[i][0]).toBeGreaterThan(result.data[i - 1][0]);
    }

    // Check approximate data values
    // Dot at pixel (100, 400) → data x = (100-50)/(450-50)*100 = 12.5
    //                         → data y = (450-400)/(450-50)*10 = 1.25
    expect(result.data[0][0]).toBeCloseTo(12.5, 0);
    expect(result.data[0][1]).toBeCloseTo(1.25, 0);

    expect(result.data[3][0]).toBeCloseTo(87.5, 0);
    expect(result.data[3][1]).toBeCloseTo(8.75, 0);
  });

  test('extracts points (averaging method)', async () => {
    const result = await extractData(imgPath, axisConfig, {
      color: '#FF0000',
      tolerance: 30,
      method: 'averaging',
      dx: 8,
      dy: 8,
    });

    expect(result.data.length).toBe(4);
    expect(result.data[0][0]).toBeCloseTo(12.5, 0);
  });

  test('formatResult produces CSV', async () => {
    const result = await extractData(imgPath, axisConfig, {
      color: '#FF0000',
      tolerance: 30,
      method: 'blob',
    });

    const csv = formatResult(result, 'csv');
    expect(csv).toContain('x,y');
    expect(csv).toContain('# Points: 4');
  });

  test('formatResult produces JSON', async () => {
    const result = await extractData(imgPath, axisConfig, {
      color: '#FF0000',
      tolerance: 30,
      method: 'blob',
    });

    const json = formatResult(result, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.data.length).toBe(4);
    expect(parsed.metadata.method).toBe('blob');
  });
});
