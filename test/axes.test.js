import { describe, test, expect } from '@jest/globals';
import { createAxesTransform } from '../src/core/axes.js';

describe('Axis calibration — linear', () => {
  // Simple 500×500 image where:
  //   pixel (50, 450) = data (0, 0)     — bottom-left
  //   pixel (450, 450) = data (100, 0)  — bottom-right
  //   pixel (50, 450) = data (0, 0)     — same for Y min
  //   pixel (50, 50) = data (0, 10)     — top-left
  const config = {
    type: 'xy',
    scale: { x: 'linear', y: 'linear' },
    points: [
      { pixel: [50, 450], value: [0, null] },
      { pixel: [450, 450], value: [100, null] },
      { pixel: [50, 450], value: [null, 0] },
      { pixel: [50, 50], value: [null, 10] },
    ],
  };

  const axes = createAxesTransform(config);

  test('pixelToData at calibration points', () => {
    // Bottom-left
    const bl = axes.pixelToData(50, 450);
    expect(bl.x).toBeCloseTo(0, 5);
    expect(bl.y).toBeCloseTo(0, 5);

    // Bottom-right
    const br = axes.pixelToData(450, 450);
    expect(br.x).toBeCloseTo(100, 5);
    expect(br.y).toBeCloseTo(0, 5);

    // Top-left
    const tl = axes.pixelToData(50, 50);
    expect(tl.x).toBeCloseTo(0, 5);
    expect(tl.y).toBeCloseTo(10, 5);
  });

  test('pixelToData at midpoint', () => {
    const mid = axes.pixelToData(250, 250);
    expect(mid.x).toBeCloseTo(50, 5);
    expect(mid.y).toBeCloseTo(5, 5);
  });

  test('dataToPixel roundtrip', () => {
    const testPoints = [
      [0, 0],
      [100, 10],
      [50, 5],
      [25, 7.5],
    ];
    for (const [dx, dy] of testPoints) {
      const px = axes.dataToPixel(dx, dy);
      const back = axes.pixelToData(px.x, px.y);
      expect(back.x).toBeCloseTo(dx, 8);
      expect(back.y).toBeCloseTo(dy, 8);
    }
  });

  test('bounds are stored correctly', () => {
    expect(axes.bounds.xmin).toBe(0);
    expect(axes.bounds.xmax).toBe(100);
    expect(axes.bounds.ymin).toBe(0);
    expect(axes.bounds.ymax).toBe(10);
  });
});

describe('Axis calibration — log scale', () => {
  // Y is log10 scale: 0.1 to 100
  const config = {
    type: 'xy',
    scale: { x: 'linear', y: 'log' },
    points: [
      { pixel: [100, 500], value: [0, null] },
      { pixel: [600, 500], value: [100, null] },
      { pixel: [100, 500], value: [null, 0.1] },
      { pixel: [100, 100], value: [null, 100] },
    ],
  };

  const axes = createAxesTransform(config);

  test('pixelToData recovers log calibration points', () => {
    const p1 = axes.pixelToData(100, 500);
    expect(p1.x).toBeCloseTo(0, 5);
    expect(p1.y).toBeCloseTo(0.1, 5);

    const p2 = axes.pixelToData(600, 500);
    expect(p2.x).toBeCloseTo(100, 5);

    const p3 = axes.pixelToData(100, 100);
    expect(p3.y).toBeCloseTo(100, 3);
  });

  test('dataToPixel → pixelToData roundtrip (log)', () => {
    const testPoints = [
      [50, 1],
      [25, 10],
      [75, 0.5],
    ];
    for (const [dx, dy] of testPoints) {
      const px = axes.dataToPixel(dx, dy);
      const back = axes.pixelToData(px.x, px.y);
      expect(back.x).toBeCloseTo(dx, 6);
      expect(back.y).toBeCloseTo(dy, 4);
    }
  });
});

describe('Axis calibration — ln scale', () => {
  const config = {
    type: 'xy',
    scale: { x: 'ln', y: 'linear' },
    points: [
      { pixel: [50, 400], value: [1, null] },    // ln(1) = 0
      { pixel: [450, 400], value: [Math.E, null] }, // ln(e) = 1
      { pixel: [50, 400], value: [null, 0] },
      { pixel: [50, 100], value: [null, 10] },
    ],
  };

  const axes = createAxesTransform(config);

  test('pixelToData at calibration points (ln)', () => {
    const p1 = axes.pixelToData(50, 400);
    expect(p1.x).toBeCloseTo(1, 5);

    const p2 = axes.pixelToData(450, 400);
    expect(p2.x).toBeCloseTo(Math.E, 4);
  });
});

describe('Edge cases', () => {
  test('throws on fewer than 4 points', () => {
    expect(() =>
      createAxesTransform({
        points: [{ pixel: [0, 0], value: [0, 0] }],
      })
    ).toThrow('4 points');
  });
});
