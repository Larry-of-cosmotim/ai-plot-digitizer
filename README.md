# AI Plot Digitizer

Extract numerical data from scientific plot images — AI-first CLI tool.

Like [WebPlotDigitizer](https://automeris.io/WebPlotDigitizer/) but built for automation: CLI, REST API, and vision model integration.

## Install

```bash
npm install
npm link  # makes `ai-plot-digitizer` available globally
```

## Quick Start

### 1. Create an axis calibration file

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

The 4 calibration points map pixel coordinates to data values:
- Points 0–1: define the X axis (xmin, xmax)
- Points 2–3: define the Y axis (ymin, ymax)

Supported scales: `linear`, `log` (log₁₀), `ln` (natural log).

### 2. Extract data

```bash
ai-plot-digitizer extract plot.png \
  --axes axes.json \
  --color "#FF0000" \
  --tolerance 30 \
  --output data.csv
```

### 3. Analyse colours in a plot

```bash
ai-plot-digitizer colors plot.png --top 10
```

### 4. Batch process

```bash
ai-plot-digitizer batch ./figures/ \
  --axes axes.json \
  --output ./extracted/
```

## CLI Reference

### `extract <image>`

| Flag | Default | Description |
|------|---------|-------------|
| `--axes <file>` | *required* | Axis calibration JSON |
| `--color <hex>` | `#000000` | Target data colour |
| `--tolerance <n>` | `30` | Colour tolerance (0–255, Euclidean RGB) |
| `--method <type>` | `averaging` | Detection: `blob` or `averaging` |
| `--dx <n>` | `10` | X merge window (pixels) |
| `--dy <n>` | `10` | Y merge window (pixels) |
| `--min-dia <n>` | `0` | Min blob diameter |
| `--max-dia <n>` | `5000` | Max blob diameter |
| `--format <fmt>` | `csv` | Output format: `csv`, `json`, `tsv` |
| `--output <file>` | stdout | Output file path |
| `--precision <n>` | `6` | Significant digits |

### `colors <image>`

| Flag | Default | Description |
|------|---------|-------------|
| `--top <n>` | `10` | Number of colours to show |
| `--tolerance <n>` | `120` | Colour grouping tolerance |

### `batch <dir>`

Same options as `extract`, plus:

| Flag | Default | Description |
|------|---------|-------------|
| `--output <dir>` | same as input | Output directory |

## Architecture

```
src/
  core/
    image.js          # Image loading (sharp → raw RGBA)
    axes.js           # Axis calibration + affine transforms
    detection.js      # Color filter, blob detection, averaging window
    extraction.js     # Pipeline orchestrator
    export.js         # CSV / JSON / TSV output
  cli/
    index.js          # Commander.js CLI
  api/                # REST API (Phase 3)
  ai/                 # Vision model integration (Phase 4)
```

## Detection Methods

**Averaging Window** (default): Scans columns for foreground pixels, groups vertical blobs, merges nearby detections. Best for line plots.

**Blob Detection**: Connected-component analysis with 8-connectivity. Computes centroids, area, and moment of inertia. Filters by diameter. Best for scatter plots.

## Tests

```bash
npm test
```

28 tests covering coordinate transforms, detection algorithms, export formats, and full pipeline integration.

## License

AGPL-3.0
