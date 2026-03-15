/**
 * Data export engine — CSV, JSON and TSV output.
 *
 * @module core/export
 */

/**
 * Format a number to a fixed precision string.
 *
 * @param {number} v
 * @param {number} precision
 * @returns {string}
 */
function fmt(v, precision) {
  return Number.isFinite(v) ? v.toPrecision(precision) : String(v);
}

/**
 * Build metadata header comment lines.
 *
 * @param {object} metadata
 * @param {string} commentChar
 * @returns {string}
 */
function metaHeader(metadata, commentChar = '#') {
  const lines = [];
  if (metadata.source) lines.push(`${commentChar} Source: ${metadata.source}`);
  if (metadata.points != null) lines.push(`${commentChar} Points: ${metadata.points}`);
  if (metadata.method) lines.push(`${commentChar} Method: ${metadata.method}`);
  if (metadata.color) lines.push(`${commentChar} Color: ${metadata.color}`);
  if (metadata.tolerance != null) lines.push(`${commentChar} Tolerance: ${metadata.tolerance}`);
  if (metadata.axisConfig) {
    lines.push(`${commentChar} Scale X: ${metadata.axisConfig.scale?.x || 'linear'}`);
    lines.push(`${commentChar} Scale Y: ${metadata.axisConfig.scale?.y || 'linear'}`);
  }
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

/**
 * Export data as CSV.
 *
 * @param {number[][]} data - Array of [x, y] pairs.
 * @param {object} [metadata] - Metadata for header comments.
 * @param {object} [options]
 * @param {boolean} [options.includeHeader=true] - Include metadata comment lines.
 * @param {number} [options.precision=6] - Significant digits.
 * @returns {string}
 */
export function exportCSV(data, metadata = {}, options = {}) {
  const includeHeader = options.includeHeader ?? true;
  const precision = options.precision ?? 6;

  let out = '';
  if (includeHeader && metadata) out += metaHeader(metadata);
  out += 'x,y\n';
  for (const [x, y] of data) {
    out += `${fmt(x, precision)},${fmt(y, precision)}\n`;
  }
  return out;
}

/**
 * Export data as TSV.
 *
 * @param {number[][]} data
 * @param {object} [metadata]
 * @param {object} [options]
 * @param {boolean} [options.includeHeader=true]
 * @param {number} [options.precision=6]
 * @returns {string}
 */
export function exportTSV(data, metadata = {}, options = {}) {
  const includeHeader = options.includeHeader ?? true;
  const precision = options.precision ?? 6;

  let out = '';
  if (includeHeader && metadata) out += metaHeader(metadata);
  out += 'x\ty\n';
  for (const [x, y] of data) {
    out += `${fmt(x, precision)}\t${fmt(y, precision)}\n`;
  }
  return out;
}

/**
 * Export data as JSON.
 *
 * @param {number[][]} data
 * @param {object} [metadata]
 * @returns {string}
 */
export function exportJSON(data, metadata = {}) {
  return JSON.stringify({ metadata, data }, null, 2) + '\n';
}
