import { describe, test, expect } from '@jest/globals';
import { parseTickLabels, buildAxesFromTicks } from '../src/ai/ocr.js';

describe('parseTickLabels', () => {
  test('identifies X tick labels at bottom edge', () => {
    const blocks = [
      { text: '0', confidence: 90, bbox: { x: 50, y: 460, width: 20, height: 15 } },
      { text: '50', confidence: 90, bbox: { x: 250, y: 465, width: 25, height: 15 } },
      { text: '100', confidence: 85, bbox: { x: 440, y: 460, width: 30, height: 15 } },
    ];

    const result = parseTickLabels(blocks, 500, 500);
    expect(result.xTicks.values).toEqual([0, 50, 100]);
    expect(result.inferredRange.xmin).toBe(0);
    expect(result.inferredRange.xmax).toBe(100);
    expect(result.xScaleHint).toBe('linear');
  });

  test('identifies Y tick labels at left edge', () => {
    const blocks = [
      { text: '0', confidence: 90, bbox: { x: 15, y: 440, width: 15, height: 12 } },
      { text: '5', confidence: 90, bbox: { x: 15, y: 240, width: 15, height: 12 } },
      { text: '10', confidence: 85, bbox: { x: 10, y: 40, width: 20, height: 12 } },
    ];

    const result = parseTickLabels(blocks, 500, 500);
    // Sorted by position (top-to-bottom), so values come in descending y order
    expect(result.yTicks.values).toEqual([10, 5, 0]);
    expect(result.inferredRange.ymin).toBe(0);
    expect(result.inferredRange.ymax).toBe(10);
    // Scale detection works on sorted numeric values regardless of order
    expect(result.yScaleHint).toBe('linear');
  });

  test('detects log scale from tick values', () => {
    // Place log-scale values on the left edge (Y axis), well above bottom threshold
    const blocks = [
      { text: '0.1', confidence: 80, bbox: { x: 10, y: 340, width: 20, height: 12 } },
      { text: '1', confidence: 85, bbox: { x: 10, y: 250, width: 10, height: 12 } },
      { text: '10', confidence: 85, bbox: { x: 10, y: 160, width: 15, height: 12 } },
      { text: '100', confidence: 80, bbox: { x: 10, y: 70, width: 20, height: 12 } },
    ];

    const result = parseTickLabels(blocks, 500, 500);
    // Values sorted by position (top to bottom): 100, 10, 1, 0.1
    expect(result.yTicks.values).toEqual([100, 10, 1, 0.1]);
    expect(result.yScaleHint).toBe('log');
  });

  test('returns null ranges when no numbers found', () => {
    const blocks = [
      { text: 'Temperature', confidence: 70, bbox: { x: 200, y: 480, width: 100, height: 15 } },
    ];

    const result = parseTickLabels(blocks, 500, 500);
    expect(result.inferredRange.xmin).toBeNull();
    expect(result.inferredRange.ymin).toBeNull();
  });
});

describe('buildAxesFromTicks', () => {
  test('builds valid axis config from good tick data', () => {
    const ticks = {
      xTicks: { values: [0, 50, 100], positions: [60, 260, 460] },
      yTicks: { values: [0, 5, 10], positions: [440, 240, 40] },
      inferredRange: { xmin: 0, xmax: 100, ymin: 0, ymax: 10 },
      xScaleHint: 'linear',
      yScaleHint: 'linear',
    };

    const config = buildAxesFromTicks(ticks);
    expect(config).not.toBeNull();
    expect(config.points).toHaveLength(4);
    expect(config.scale.x).toBe('linear');
    expect(config.scale.y).toBe('linear');
    // X range calibration
    expect(config.points[0].value[0]).toBe(0);
    expect(config.points[1].value[0]).toBe(100);
    // Y range calibration
    expect(config.points[2].value[1]).toBe(10);
    expect(config.points[3].value[1]).toBe(0);
  });

  test('returns null with insufficient ticks', () => {
    const ticks = {
      xTicks: { values: [5], positions: [250] },
      yTicks: { values: [], positions: [] },
      inferredRange: { xmin: 5, xmax: 5, ymin: null, ymax: null },
      xScaleHint: null,
      yScaleHint: null,
    };

    expect(buildAxesFromTicks(ticks)).toBeNull();
  });
});
