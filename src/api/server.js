/**
 * REST API server for AI Plot Digitizer.
 *
 * Stateless endpoints for data extraction, colour analysis,
 * and (future) AI-powered auto-detection.
 *
 * @module api/server
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { extractData, formatResult } from '../core/extraction.js';
import { loadImage, analyzeColors } from '../core/image.js';
import { swaggerSpec } from './swagger.js';
import { recognizeText, parseTickLabels, buildAxesFromTicks } from '../ai/ocr.js';
import { autoExtract } from '../ai/auto.js';

const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB

/**
 * Write a base64 or buffer image to a temporary file and return its path.
 *
 * @param {string|Buffer} imageData - base64 string (with or without data URI prefix) or Buffer.
 * @returns {Promise<string>} Path to temp file.
 */
async function writeTempImage(imageData) {
  const dir = join(tmpdir(), 'aipd');
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${randomUUID()}.png`);

  let buf;
  if (Buffer.isBuffer(imageData)) {
    buf = imageData;
  } else if (typeof imageData === 'string') {
    // Strip optional data URI prefix
    const raw = imageData.replace(/^data:image\/\w+;base64,/, '');
    buf = Buffer.from(raw, 'base64');
  } else {
    throw new Error('imageData must be a base64 string or Buffer');
  }

  await writeFile(filePath, buf);
  return filePath;
}

/**
 * Create and return the Express app (without listening).
 *
 * @param {object} [options]
 * @param {boolean} [options.serveUI=false] - Serve browser UI from /ui.
 * @param {string} [options.uiPath] - Filesystem path to the built UI.
 * @returns {import('express').Express}
 */
export function createApp(options = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // ─── Health ──────────────────────────────────────────────

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  });

  // ─── OpenAPI spec ────────────────────────────────────────

  app.get('/api/openapi.json', (_req, res) => {
    res.json(swaggerSpec);
  });

  // ─── POST /api/extract ──────────────────────────────────

  app.post('/api/extract', upload.single('image'), async (req, res) => {
    let tmpPath;
    try {
      // Accept image from multipart file upload OR base64 in JSON body
      if (req.file) {
        tmpPath = await writeTempImage(req.file.buffer);
      } else if (req.body?.image) {
        tmpPath = await writeTempImage(req.body.image);
      } else {
        return res.status(400).json({ error: 'No image provided. Send base64 in body.image or multipart file.' });
      }

      const axes = req.body?.axes;
      if (!axes || !axes.points) {
        return res.status(400).json({ error: 'Missing axes calibration config in body.axes.' });
      }

      const opts = req.body?.options || {};
      const result = await extractData(tmpPath, axes, {
        color: opts.color || '#000000',
        tolerance: opts.tolerance ?? 30,
        method: opts.method || 'averaging',
        dx: opts.dx ?? 10,
        dy: opts.dy ?? 10,
        minDiameter: opts.minDiameter ?? 0,
        maxDiameter: opts.maxDiameter ?? 5000,
      });

      res.json({
        data: result.data,
        metadata: {
          points: result.data.length,
          method: result.metadata.method,
          color: result.metadata.color,
          tolerance: result.metadata.tolerance,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      if (tmpPath) await unlink(tmpPath).catch(() => {});
    }
  });

  // ─── POST /api/colors ──────────────────────────────────

  app.post('/api/colors', upload.single('image'), async (req, res) => {
    let tmpPath;
    try {
      if (req.file) {
        tmpPath = await writeTempImage(req.file.buffer);
      } else if (req.body?.image) {
        tmpPath = await writeTempImage(req.body.image);
      } else {
        return res.status(400).json({ error: 'No image provided.' });
      }

      const top = req.body?.top ?? 10;
      const tolerance = req.body?.tolerance ?? 120;

      const image = await loadImage(tmpPath);
      const colors = analyzeColors(image.rawData, image.width * image.height, {
        tolerance,
        top,
      });

      res.json({
        colors,
        metadata: {
          width: image.width,
          height: image.height,
          totalPixels: image.width * image.height,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      if (tmpPath) await unlink(tmpPath).catch(() => {});
    }
  });

  // ─── POST /api/detect-axes (stub for Phase 4) ──────────

  app.post('/api/detect-axes', upload.single('image'), async (req, res) => {
    let tmpPath;
    try {
      if (req.file) {
        tmpPath = await writeTempImage(req.file.buffer);
      } else if (req.body?.image) {
        tmpPath = await writeTempImage(req.body.image);
      } else {
        return res.status(400).json({ error: 'No image provided.' });
      }

      const img = await loadImage(tmpPath);
      let ocrResult, ticksParsed, axesConfig;
      try {
        ocrResult = await recognizeText(tmpPath);
        ticksParsed = parseTickLabels(ocrResult.blocks, img.width, img.height);
        axesConfig = buildAxesFromTicks(ticksParsed);
      } catch (ocrErr) {
        // OCR may fail on some images — return empty result rather than 500
        return res.json({
          axes: null,
          confidence: 0,
          ticks: null,
          ocrText: '',
          message: `OCR failed: ${ocrErr.message}`,
        });
      }

      res.json({
        axes: axesConfig,
        confidence: axesConfig ? Math.min((ocrResult.confidence || 0) / 100, 1) : 0,
        ticks: ticksParsed,
        ocrText: ocrResult.fullText || '',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      if (tmpPath) await unlink(tmpPath).catch(() => {});
    }
  });

  // ─── POST /api/auto ─────────────────────────────────────

  app.post('/api/auto', upload.single('image'), async (req, res) => {
    let tmpPath;
    try {
      if (req.file) {
        tmpPath = await writeTempImage(req.file.buffer);
      } else if (req.body?.image) {
        tmpPath = await writeTempImage(req.body.image);
      } else {
        return res.status(400).json({ error: 'No image provided.' });
      }

      const opts = req.body?.options || {};
      const result = await autoExtract(tmpPath, {
        visionProvider: opts.visionProvider,
        visionOptions: opts.visionOptions || {},
        color: opts.color,
        tolerance: opts.tolerance,
        method: opts.method,
      });

      res.json({
        data: result.data,
        metadata: result.metadata,
        axisConfig: result.axisConfig,
        detectionSource: result.detectionSource,
        visionAnalysis: result.visionAnalysis
          ? {
              plotType: result.visionAnalysis.plotType,
              axisLabels: result.visionAnalysis.axisLabels,
              scaleTypes: result.visionAnalysis.scaleTypes,
              datasets: result.visionAnalysis.datasets,
              confidence: result.visionAnalysis.confidence,
            }
          : null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      if (tmpPath) await unlink(tmpPath).catch(() => {});
    }
  });

  // ─── Serve Browser UI (Phase 5) ────────────────────────

  if (options.serveUI && options.uiPath) {
    app.use('/ui', express.static(options.uiPath));
  }

  return app;
}

/**
 * Start the server on the given port.
 *
 * @param {object} [options]
 * @param {number} [options.port=3000]
 * @param {boolean} [options.serveUI=false]
 * @param {string} [options.uiPath]
 * @returns {Promise<import('http').Server>}
 */
export async function startServer(options = {}) {
  const port = options.port ?? 3000;
  const app = createApp(options);

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`AI Plot Digitizer API running on http://localhost:${port}`);
      console.log(`  Health:  GET  http://localhost:${port}/api/health`);
      console.log(`  Spec:    GET  http://localhost:${port}/api/openapi.json`);
      console.log(`  Extract: POST http://localhost:${port}/api/extract`);
      console.log(`  Colors:  POST http://localhost:${port}/api/colors`);
      resolve(server);
    });
  });
}
