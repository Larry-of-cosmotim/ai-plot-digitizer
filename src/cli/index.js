#!/usr/bin/env node

/**
 * AI Plot Digitizer — CLI interface.
 *
 * Commands:
 *   extract  — Extract data from a plot image
 *   colors   — Analyse dominant colours in an image
 *   batch    — Process a folder of images
 *
 * @module cli
 */

import { Command } from 'commander';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, join, basename, extname } from 'node:path';
import { extractData, formatResult } from '../core/extraction.js';
import { loadImage, analyzeColors } from '../core/image.js';
import { startServer } from '../api/server.js';
import { autoExtract } from '../ai/auto.js';

const program = new Command();

program
  .name('ai-plot-digitizer')
  .description('Extract numerical data from scientific plot images')
  .version('0.1.0');

// ─── extract ──────────────────────────────────────────────────────────

program
  .command('extract')
  .description('Extract data points from a plot image')
  .argument('<image>', 'Path to the plot image')
  .requiredOption('--axes <file>', 'Path to axis calibration JSON file')
  .option('--color <hex>', 'Target colour (hex)', '#000000')
  .option('--tolerance <n>', 'Colour tolerance (0-255)', (v) => parseInt(v, 10), 30)
  .option('--method <type>', 'Detection method: blob | averaging', 'averaging')
  .option('--dx <n>', 'X merge window (pixels)', (v) => parseInt(v, 10), 10)
  .option('--dy <n>', 'Y merge window (pixels)', (v) => parseInt(v, 10), 10)
  .option('--min-dia <n>', 'Min blob diameter (pixels)', (v) => parseFloat(v), 0)
  .option('--max-dia <n>', 'Max blob diameter (pixels)', (v) => parseFloat(v), 5000)
  .option('--format <fmt>', 'Output format: csv | json | tsv', 'csv')
  .option('--output <file>', 'Write output to file (default: stdout)')
  .option('--precision <n>', 'Significant digits', (v) => parseInt(v, 10), 6)
  .action(async (imagePath, opts) => {
    try {
      const axisConfig = JSON.parse(await readFile(resolve(opts.axes), 'utf-8'));

      const result = await extractData(resolve(imagePath), axisConfig, {
        color: opts.color,
        tolerance: opts.tolerance,
        method: opts.method,
        dx: opts.dx,
        dy: opts.dy,
        minDiameter: opts.minDia,
        maxDiameter: opts.maxDia,
      });

      const output = formatResult(result, opts.format, { precision: opts.precision });

      if (opts.output) {
        await writeFile(resolve(opts.output), output);
        console.error(`✓ Extracted ${result.data.length} points → ${opts.output}`);
      } else {
        process.stdout.write(output);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── colors ───────────────────────────────────────────────────────────

program
  .command('colors')
  .description('Analyse dominant colours in an image')
  .argument('<image>', 'Path to the image')
  .option('--top <n>', 'Number of top colours to show', (v) => parseInt(v, 10), 10)
  .option('--tolerance <n>', 'Grouping tolerance', (v) => parseInt(v, 10), 120)
  .action(async (imagePath, opts) => {
    try {
      const image = await loadImage(resolve(imagePath));
      const colors = analyzeColors(image.rawData, image.width * image.height, {
        tolerance: opts.tolerance,
        top: opts.top,
      });

      console.log(`\nDominant colours in ${basename(imagePath)}:\n`);
      console.log('  Rank  Hex        RGB              Pixels     %');
      console.log('  ──────────────────────────────────────────────────');
      colors.forEach((c, i) => {
        const rgb = `(${c.r}, ${c.g}, ${c.b})`.padEnd(16);
        const pxStr = String(c.pixels).padStart(10);
        console.log(
          `  ${String(i + 1).padStart(4)}  ${c.hex}    ${rgb} ${pxStr}  ${c.percentage.toFixed(1)}%`
        );
      });
      console.log();
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── batch ────────────────────────────────────────────────────────────

program
  .command('batch')
  .description('Process a folder of plot images')
  .argument('<dir>', 'Directory containing plot images')
  .requiredOption('--axes <file>', 'Path to axis calibration JSON file')
  .option('--output <dir>', 'Output directory (default: same as input)')
  .option('--color <hex>', 'Target colour (hex)', '#000000')
  .option('--tolerance <n>', 'Colour tolerance', (v) => parseInt(v, 10), 30)
  .option('--method <type>', 'Detection method', 'averaging')
  .option('--format <fmt>', 'Output format', 'csv')
  .option('--dx <n>', 'X merge window', (v) => parseInt(v, 10), 10)
  .option('--dy <n>', 'Y merge window', (v) => parseInt(v, 10), 10)
  .action(async (dir, opts) => {
    try {
      const axisConfig = JSON.parse(await readFile(resolve(opts.axes), 'utf-8'));
      const inputDir = resolve(dir);
      const outputDir = resolve(opts.output || dir);

      await mkdir(outputDir, { recursive: true });

      const files = (await readdir(inputDir)).filter((f) =>
        /\.(png|jpe?g|svg|tiff?)$/i.test(f)
      );

      if (files.length === 0) {
        console.error('No image files found in directory.');
        process.exit(1);
      }

      console.error(`Processing ${files.length} images...`);

      const ext = opts.format === 'json' ? '.json' : opts.format === 'tsv' ? '.tsv' : '.csv';

      for (const file of files) {
        const imagePath = join(inputDir, file);
        const outName = basename(file, extname(file)) + ext;
        const outPath = join(outputDir, outName);

        try {
          const result = await extractData(imagePath, axisConfig, {
            color: opts.color,
            tolerance: opts.tolerance,
            method: opts.method,
            dx: opts.dx,
            dy: opts.dy,
          });

          const output = formatResult(result, opts.format);
          await writeFile(outPath, output);
          console.error(`  ✓ ${file} → ${outName} (${result.data.length} points)`);
        } catch (err) {
          console.error(`  ✗ ${file}: ${err.message}`);
        }
      }

      console.error('Done.');
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── auto ─────────────────────────────────────────────────────────────

program
  .command('auto')
  .description('Fully automatic extraction using OCR + optional vision model')
  .argument('<image>', 'Path to the plot image')
  .option('--vision <provider>', 'Vision model provider: openai | anthropic | google')
  .option('--api-key <key>', 'API key for vision provider (or set env var)')
  .option('--model <name>', 'Vision model name override')
  .option('--color <hex>', 'Override auto-detected data colour')
  .option('--tolerance <n>', 'Colour tolerance', (v) => parseInt(v, 10), 40)
  .option('--method <type>', 'Detection method', 'averaging')
  .option('--format <fmt>', 'Output format: csv | json | tsv', 'csv')
  .option('--output <file>', 'Output file (default: stdout)')
  .option('--interactive', 'Show detected config and ask for confirmation')
  .option('--verbose', 'Show progress messages')
  .action(async (imagePath, opts) => {
    try {
      const onProgress = opts.verbose
        ? (step, detail) => console.error(`  [${step}] ${detail}`)
        : undefined;

      if (opts.interactive) {
        console.error('Interactive mode: auto-detecting axes...\n');
      }

      const result = await autoExtract(resolve(imagePath), {
        visionProvider: opts.vision,
        visionOptions: {
          apiKey: opts.apiKey,
          model: opts.model,
        },
        color: opts.color,
        tolerance: opts.tolerance,
        method: opts.method,
        format: opts.format,
        onProgress,
      });

      if (opts.interactive) {
        console.error('\n── Auto-detected configuration ──');
        console.error(`  Detection source: ${result.detectionSource}`);
        console.error(`  Axis config:`);
        console.error(`    Scale X: ${result.axisConfig.scale.x}`);
        console.error(`    Scale Y: ${result.axisConfig.scale.y}`);
        if (result.visionAnalysis) {
          console.error(`  Vision analysis:`);
          console.error(`    Plot type: ${result.visionAnalysis.plotType}`);
          console.error(`    X label: ${result.visionAnalysis.axisLabels.x}`);
          console.error(`    Y label: ${result.visionAnalysis.axisLabels.y}`);
          console.error(`    Confidence: ${(result.visionAnalysis.confidence * 100).toFixed(0)}%`);
          if (result.visionAnalysis.datasets.length > 0) {
            console.error(`    Datasets: ${result.visionAnalysis.datasets.map((d) => `${d.label} (${d.color})`).join(', ')}`);
          }
        }
        console.error(`  Points extracted: ${result.data.length}`);
        console.error(`  Data colour: ${result.metadata.color}`);
        console.error('');
      }

      const output = formatResult(result, opts.format);

      if (opts.output) {
        await writeFile(resolve(opts.output), output);
        console.error(`✓ Extracted ${result.data.length} points → ${opts.output}`);
      } else {
        process.stdout.write(output);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ─── serve ────────────────────────────────────────────────────────────

program
  .command('serve')
  .description('Start the REST API server')
  .option('--port <n>', 'Port number', (v) => parseInt(v, 10), 3000)
  .option('--ui', 'Serve browser UI')
  .action(async (opts) => {
    try {
      await startServer({
        port: opts.port,
        serveUI: opts.ui,
        uiPath: resolve('src/ui/public'),
      });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
