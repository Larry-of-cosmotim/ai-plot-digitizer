/**
 * Axis calibration and coordinate transforms.
 *
 * Converts between pixel coordinates and data coordinates using an affine
 * transform derived from four calibration points (two on each axis).
 *
 * Supports linear, log10 and ln (natural-log) scales.
 *
 * @module core/axes
 */

// ── tiny 2×2 matrix helpers ──────────────────────────────────────────

/** @param {number[]} m - Flat [a,b,c,d] */
function inv2x2(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-14) throw new Error('Singular calibration matrix — are the 4 points collinear?');
  const invDet = 1 / det;
  return [m[3] * invDet, -m[1] * invDet, -m[2] * invDet, m[0] * invDet];
}

/** Multiply two 2×2 matrices (flat). */
function mult2x2(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
  ];
}

/** Multiply 2×2 matrix × 2-vector. */
function mult2x2Vec(m, v) {
  return [m[0] * v[0] + m[1] * v[1], m[2] * v[0] + m[3] * v[1]];
}

// ── scale helpers ────────────────────────────────────────────────────

function toLog(value, scaleType) {
  if (scaleType === 'log') return Math.log10(value);
  if (scaleType === 'ln') return Math.log(value);
  return value; // linear
}

function fromLog(value, scaleType) {
  if (scaleType === 'log') return Math.pow(10, value);
  if (scaleType === 'ln') return Math.exp(value);
  return value; // linear
}

/**
 * Build a coordinate-transform object from an axis configuration.
 *
 * The axis config must contain exactly 4 calibration points:
 *   - Points 0 & 1 define the X axis (their `value[0]` gives xmin, xmax).
 *   - Points 2 & 3 define the Y axis (their `value[1]` gives ymin, ymax).
 *
 * @param {AxisConfig} config
 * @returns {AxesTransform}
 *
 * @typedef {object} AxisConfig
 * @property {string} [type="xy"]
 * @property {{ x: string, y: string }} [scale] - Scale types: "linear" | "log" | "ln".
 * @property {CalibPoint[]} points - Exactly 4 calibration points.
 *
 * @typedef {object} CalibPoint
 * @property {number[]} pixel - [px, py]
 * @property {(number|null)[]} value - [dataX | null, dataY | null]
 *
 * @typedef {object} AxesTransform
 * @property {function(number,number): {x:number, y:number}} pixelToData
 * @property {function(number,number): {x:number, y:number}} dataToPixel
 * @property {{ xmin:number, xmax:number, ymin:number, ymax:number }} bounds
 * @property {string} scaleX
 * @property {string} scaleY
 */
export function createAxesTransform(config) {
  const { points, scale = {} } = config;
  if (!points || points.length < 4) {
    throw new Error('Axis calibration requires exactly 4 points');
  }

  const scaleX = scale.x || 'linear';
  const scaleY = scale.y || 'linear';

  // Extract pixel & data values
  const x1 = points[0].pixel[0], y1 = points[0].pixel[1];
  const x2 = points[1].pixel[0], y2 = points[1].pixel[1];
  const x3 = points[2].pixel[0], y3 = points[2].pixel[1];
  const x4 = points[3].pixel[0], y4 = points[3].pixel[1];

  let xmin = points[0].value[0];
  let xmax = points[1].value[0];
  let ymin = points[2].value[1];
  let ymax = points[3].value[1];

  // Store original bounds before log transform
  const boundsOrig = { xmin, xmax, ymin, ymax };

  // Apply log to data values
  xmin = toLog(xmin, scaleX);
  xmax = toLog(xmax, scaleX);
  ymin = toLog(ymin, scaleY);
  ymax = toLog(ymax, scaleY);

  // Build affine transform: A * pixel + c = data (in log-space)
  const datMat = [xmin - xmax, 0, 0, ymin - ymax];
  const pixMat = [x1 - x2, x3 - x4, y1 - y2, y3 - y4];

  const A = mult2x2(datMat, inv2x2(pixMat));
  const Ainv = inv2x2(A);
  const c = [
    xmin - A[0] * x1 - A[1] * y1,
    ymin - A[2] * x3 - A[3] * y3,
  ];

  /**
   * Convert pixel coordinates to data coordinates.
   *
   * @param {number} px
   * @param {number} py
   * @returns {{ x: number, y: number }}
   */
  function pixelToData(px, py) {
    const d = mult2x2Vec(A, [px, py]);
    let dx = d[0] + c[0];
    let dy = d[1] + c[1];
    dx = fromLog(dx, scaleX);
    dy = fromLog(dy, scaleY);
    return { x: dx, y: dy };
  }

  /**
   * Convert data coordinates to pixel coordinates.
   *
   * @param {number} dx
   * @param {number} dy
   * @returns {{ x: number, y: number }}
   */
  function dataToPixel(dx, dy) {
    dx = toLog(dx, scaleX);
    dy = toLog(dy, scaleY);
    const v = [dx - c[0], dy - c[1]];
    const p = mult2x2Vec(Ainv, v);
    return { x: p[0], y: p[1] };
  }

  return {
    pixelToData,
    dataToPixel,
    bounds: boundsOrig,
    scaleX,
    scaleY,
  };
}
