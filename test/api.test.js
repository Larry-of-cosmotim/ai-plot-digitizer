import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createApp } from '../src/api/server.js';
import sharp from 'sharp';
import http from 'node:http';

/**
 * Minimal HTTP client that works without external deps.
 */
function request(server, method, path, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('REST API', () => {
  let server;
  let testImageBase64;
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

  beforeAll(async () => {
    // Create synthetic test image (500×500, white bg, 4 red dots)
    const w = 500, h = 500;
    const buf = Buffer.alloc(w * h * 4, 255);
    const dots = [
      { px: 100, py: 400 },
      { px: 200, py: 300 },
      { px: 300, py: 200 },
      { px: 400, py: 100 },
    ];
    for (const dot of dots) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = dot.px + dx, y = dot.py + dy;
          if (x >= 0 && x < w && y >= 0 && y < h) {
            const off = (y * w + x) * 4;
            buf[off] = 255; buf[off + 1] = 0; buf[off + 2] = 0; buf[off + 3] = 255;
          }
        }
      }
    }

    const pngBuf = await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    testImageBase64 = pngBuf.toString('base64');

    // Start server on random port
    const app = createApp();
    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test('GET /api/health', async () => {
    const res = await request(server, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('0.1.0');
  });

  test('GET /api/openapi.json', async () => {
    const res = await request(server, 'GET', '/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.paths['/api/extract']).toBeDefined();
  });

  test('POST /api/extract — extracts data from base64 image', async () => {
    const res = await request(server, 'POST', '/api/extract', {
      image: testImageBase64,
      axes: axisConfig,
      options: { color: '#FF0000', tolerance: 30, method: 'blob' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(4);
    expect(res.body.metadata.points).toBe(4);
    expect(res.body.metadata.method).toBe('blob');
    // First point should be near (12.5, 1.25)
    expect(res.body.data[0][0]).toBeCloseTo(12.5, 0);
    expect(res.body.data[0][1]).toBeCloseTo(1.25, 0);
  });

  test('POST /api/extract — 400 on missing image', async () => {
    const res = await request(server, 'POST', '/api/extract', {
      axes: axisConfig,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No image/i);
  });

  test('POST /api/extract — 400 on missing axes', async () => {
    const res = await request(server, 'POST', '/api/extract', {
      image: testImageBase64,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/axes/i);
  });

  test('POST /api/colors — returns dominant colours', async () => {
    const res = await request(server, 'POST', '/api/colors', {
      image: testImageBase64,
      top: 5,
    });
    expect(res.status).toBe(200);
    expect(res.body.colors.length).toBeGreaterThan(0);
    expect(res.body.colors.length).toBeLessThanOrEqual(5);
    expect(res.body.metadata.width).toBe(500);
    expect(res.body.metadata.height).toBe(500);
    // White should be dominant
    expect(res.body.colors[0].hex).toMatch(/^#F/);
  });

  test('POST /api/detect-axes — runs OCR analysis', async () => {
    const res = await request(server, 'POST', '/api/detect-axes', {
      image: testImageBase64,
    });
    expect(res.status).toBe(200);
    // The synthetic image has no text, so OCR won't find tick labels
    expect(res.body).toHaveProperty('confidence');
    expect(res.body).toHaveProperty('ticks');
    expect(typeof res.body.confidence).toBe('number');
  });
});
