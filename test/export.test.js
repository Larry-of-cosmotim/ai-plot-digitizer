import { describe, test, expect } from '@jest/globals';
import { exportCSV, exportJSON, exportTSV } from '../src/core/export.js';

const sampleData = [
  [0, 0],
  [1.5, 3.7],
  [10, 100],
];

const sampleMeta = {
  source: 'test.png',
  points: 3,
  method: 'blob',
  color: '#FF0000',
  tolerance: 30,
};

describe('exportCSV', () => {
  test('produces valid CSV with header', () => {
    const csv = exportCSV(sampleData, sampleMeta);
    expect(csv).toContain('# Source: test.png');
    expect(csv).toContain('# Points: 3');
    expect(csv).toContain('x,y');
    const lines = csv.trim().split('\n');
    // header comments + column header + 3 data rows
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  test('omits header when includeHeader=false', () => {
    const csv = exportCSV(sampleData, sampleMeta, { includeHeader: false });
    expect(csv).not.toContain('#');
    expect(csv.startsWith('x,y')).toBe(true);
  });

  test('respects precision', () => {
    const csv = exportCSV([[1.23456789, 9.87654321]], {}, { precision: 4 });
    expect(csv).toContain('1.235');
    expect(csv).toContain('9.877');
  });
});

describe('exportTSV', () => {
  test('uses tab delimiter', () => {
    const tsv = exportTSV(sampleData, sampleMeta);
    expect(tsv).toContain('x\ty');
    // Data rows use tabs
    const dataLines = tsv.trim().split('\n').filter((l) => !l.startsWith('#'));
    for (const line of dataLines.slice(1)) {
      expect(line).toContain('\t');
      expect(line).not.toMatch(/,\d/);
    }
  });
});

describe('exportJSON', () => {
  test('produces valid JSON', () => {
    const json = exportJSON(sampleData, sampleMeta);
    const parsed = JSON.parse(json);
    expect(parsed.metadata.source).toBe('test.png');
    expect(parsed.data).toEqual(sampleData);
  });
});
