# AI Plot Digitizer

Extract numerical data from scientific plot images — CLI, REST API, browser UI, and AI-powered auto-detection.

Like [WebPlotDigitizer](https://automeris.io/WebPlotDigitizer/) but built for automation.

## Features

- **CLI** — Extract data from the command line with one command
- **REST API** — Stateless JSON endpoints, OpenAPI 3.0 spec
- **Browser UI** — Dark-themed web interface with drag & drop
- **AI Auto-Detection** — OCR-based axis detection, pluggable vision model support (OpenAI / Anthropic / Google)
- **Multiple formats** — CSV, TSV, JSON output
- **Batch processing** — Process entire directories at once
- **Two detection methods** — Blob detection (scatter plots) and averaging window (line plots)
- **Scale support** — Linear, log₁₀, and ln scales

## Install

```bash
npm install ai-plot-digitizer
```

Or run directly:

```bash
npx ai-plot-digitizer --help
```

## Quick Start

### Automatic extraction (zero config)

```bash
# Let OCR detect the axes automatically
ai-plot-digitizer auto plot.png --output data.csv --verbose

# With a vision model for better accuracy
ai-plot-digitizer auto plot.png --vision openai --output data.csv
```

### Manual extraction

```bash
# 1. Check what colours are in the plot
ai-plot-digitizer colors plot.png

# 2. Create an axis calibration file (axes.json)
# 3. Extract
ai-plot-digitizer extract plot.png \
  --axes axes.json \
  --color "#FF0000" \
  --tolerance 30 \
  --output data.csv
```

### Browser UI

```bash
ai-plot-digitizer serve --ui --port 3000
# Open http://localhost:3000
```

### REST API

```bash
ai-plot-digitizer serve --port 3000

# Extract data
curl -X POST http://localhost:3000/api/extract \
  -H 'Content-Type: application/json' \
  -d '{"image": "<base64>", "axes": {...}, "options": {"color": "#FF0000"}}'

# Auto-extract (OCR + optional vision)
curl -X POST http://localhost:3000/api/auto \
  -H 'Content-Type: application/json' \
  -d '{"image": "<base64>"}'

# Analyse colours
curl -X POST http://localhost:3000/api/colors \
  -H 'Content-Type: application/json' \
  -d '{"image": "<base64>", "top": 5}'
```

### Programmatic use

```js
import { extractData, formatResult } from 'ai-plot-digitizer';

const axes = {
  type: 'xy',
  scale: { x: 'linear', y: 'log' },
  points: [
    { pixel: [50, 450],  value: [0, null] },
    { pixel: [450, 450], value: [100, null] },
    { pixel: [50, 450],  value: [null, 0.1] },
    { pixel: [50, 50],   value: [null, 100] },
  ],
};

const result = await extractData('plot.png', axes, {
  color: '#FF0000',
  tolerance: 30,
  method: 'blob',
});

console.log(result.data);         // [[x1, y1], [x2, y2], ...]
console.log(formatResult(result, 'csv'));
```

## Axis Calibration

The 4 calibration points map pixel coordinates to data values:

```json
{
  "type": "xy",
  "scale": { "x": "linear", "y": "log" },
  "points": [
    { "pixel": [50, 450],  "value": [0, null] },
    { "pixel": [450, 450], "value": [100, null] },
    { "pixel": [50, 450],  "value": [null, 0.1] },
    { "pixel": [50, 50],   "value": [null, 100] }
  ]
}
```

- Points 0–1: X axis (xmin, xmax)
- Points 2–3: Y axis (ymin, ymax)
- Scales: `linear`, `log` (log₁₀), `ln` (natural log)

## CLI Reference

### `extract <image>`

| Flag | Default | Description |
|------|---------|-------------|
| `--axes <file>` | *required* | Axis calibration JSON |
| `--color <hex>` | `#000000` | Target data colour |
| `--tolerance <n>` | `30` | Colour tolerance (0–255) |
| `--method <type>` | `averaging` | `blob` or `averaging` |
| `--dx <n>` | `10` | X merge window (pixels) |
| `--dy <n>` | `10` | Y merge window (pixels) |
| `--format <fmt>` | `csv` | `csv`, `json`, or `tsv` |
| `--output <file>` | stdout | Output file path |

### `auto <image>`

| Flag | Default | Description |
|------|---------|-------------|
| `--vision <provider>` | — | `openai`, `anthropic`, or `google` |
| `--api-key <key>` | env var | Vision API key |
| `--color <hex>` | auto | Override detected colour |
| `--tolerance <n>` | `40` | Colour tolerance |
| `--method <type>` | `averaging` | Detection method |
| `--format <fmt>` | `csv` | Output format |
| `--output <file>` | stdout | Output file |
| `--verbose` | — | Show progress |
| `--interactive` | — | Show config before extracting |

### `colors <image>`

| Flag | Default | Description |
|------|---------|-------------|
| `--top <n>` | `10` | Number of colours |
| `--tolerance <n>` | `120` | Grouping tolerance |

### `batch <dir>`

Same as `extract`, plus `--output <dir>` for output directory.

### `serve`

| Flag | Default | Description |
|------|---------|-------------|
| `--port <n>` | `3000` | Port number |
| `--ui` | — | Serve browser UI |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/openapi.json` | OpenAPI 3.0 spec |
| `POST` | `/api/extract` | Extract data (manual axes) |
| `POST` | `/api/auto` | Auto-extract (OCR + vision) |
| `POST` | `/api/colors` | Dominant colour analysis |
| `POST` | `/api/detect-axes` | OCR axis detection |

## Detection Methods

**Averaging Window** (default) — Scans columns for foreground pixels, groups vertical blobs, merges nearby detections. Best for line plots.

**Blob Detection** — Connected-component analysis with 8-connectivity. Computes centroids from pixel clusters. Best for scatter plots.

## Architecture

```
src/
  core/           ← Engine: image loading, axes, detection, extraction, export
  cli/            ← Commander.js CLI
  api/            ← Express REST API + OpenAPI spec
  ai/             ← OCR (Tesseract.js) + vision model adapters
  ui/public/      ← Browser UI (HTML/CSS/JS)
```

## Tests

```bash
npm test              # 48 tests
npm run test:verbose  # with names
npm run test:coverage # with coverage report
```

## Requirements

- Node.js ≥ 18
- For vision models: set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY`

## License

AGPL-3.0
