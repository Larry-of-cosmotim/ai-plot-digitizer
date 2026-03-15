# AI Plot Digitizer — Development Roadmap

> Fresh JS/Node implementation inspired by WebPlotDigitizer, designed from the ground up to be AI-friendly.

**Repo:** https://github.com/Larry-of-cosmotim/ai-plot-digitizer
**License:** AGPL-3.0
**Reference:** WebPlotDigitizer v5 source at `/Users/cosmotim/Documents/WebPlotDigitizer/`

---

## Vision

A tool that lets humans AND AI agents extract numerical data from scientific plot images. Three interfaces: CLI, REST API, and browser UI — all sharing the same core engine.

## Architecture

```
┌─────────────────────────────────────┐
│           Browser UI (Web)          │  ← Phase 4
├─────────────────────────────────────┤
│           REST API (Express)        │  ← Phase 3
├─────────────────────────────────────┤
│           CLI (Commander.js)        │  ← Phase 2
├─────────────────────────────────────┤
│         Core Engine (Node.js)       │  ← Phase 1
│  ┌───────┐ ┌────────┐ ┌─────────┐  │
│  │ Image │ │  Axis  │ │  Point  │  │
│  │ Load  │ │ Detect │ │ Extract │  │
│  └───────┘ └────────┘ └─────────┘  │
│  ┌───────┐ ┌────────┐ ┌─────────┐  │
│  │  OCR  │ │ Color  │ │ Export  │  │
│  │ Layer │ │ Filter │ │ Engine  │  │
│  └───────┘ └────────┘ └─────────┘  │
└─────────────────────────────────────┘
```

---

## Phase 1: Core Engine (MVP)

**Goal:** Headless data extraction from XY plot images.

### 1.1 Image Loading
- Load PNG, JPG, SVG, PDF (first page)
- Use `sharp` for image processing (resize, crop, color space)
- Canvas-based pixel access via `node-canvas`

### 1.2 Axis Calibration (Manual Mode)
- Accept axis definition as JSON input:
  ```json
  {
    "type": "xy",
    "scale": { "x": "linear", "y": "log" },
    "points": [
      { "pixel": [100, 500], "value": [0, 0.1] },
      { "pixel": [100, 100], "value": [0, 10] },
      { "pixel": [600, 500], "value": [100, 0.1] }
    ]
  }
  ```
- Support: linear, log10, ln scales for both axes
- Coordinate transformation: pixel ↔ data space

### 1.3 Point Extraction
- **Color-based detection:** Filter by target color (with tolerance)
- **Blob detection:** Connected component analysis to find data points
- **Algorithm:** Averaging window (like WPD's default) for line plots
- **X-step interpolation:** Extract at regular X intervals for continuous curves

### 1.4 Export
- CSV (default), JSON, TSV
- Include metadata header (source image, axis config, extraction params)

### 1.5 Project Structure
```
ai-plot-digitizer/
├── src/
│   ├── core/
│   │   ├── image.js          # Image loading + pixel access
│   │   ├── axes.js           # Axis calibration + transforms
│   │   ├── detection.js      # Point/blob detection algorithms
│   │   ├── extraction.js     # Data extraction orchestrator
│   │   └── export.js         # CSV/JSON/TSV output
│   ├── cli/
│   │   └── index.js          # CLI entry point
│   ├── api/
│   │   └── server.js         # REST API server
│   └── ai/
│       ├── ocr.js            # OCR for axis labels/tick marks
│       └── vision.js         # Vision model integration
├── test/
├── examples/
│   └── sample-plots/         # Test images
├── package.json
├── README.md
└── ROADMAP.md
```

---

## Phase 2: CLI Interface

**Goal:** Full extraction from command line.

```bash
# Manual mode — provide axis calibration
npx ai-plot-digitizer extract plot.png \
  --axes axes.json \
  --color "#FF0000" \
  --tolerance 30 \
  --output data.csv

# Batch mode — process a folder
npx ai-plot-digitizer batch ./figures/ \
  --axes-template axes.json \
  --output ./extracted/

# Interactive calibration (terminal-based)
npx ai-plot-digitizer calibrate plot.png
```

### Key Features
- Accept axis config as JSON file or inline flags
- Color picker helper (show dominant colors in image)
- Dry run mode (show detected points as image overlay)
- Verbose logging for debugging

---

## Phase 3: REST API

**Goal:** Programmatic access for AI agents and scripts.

```
POST /api/extract
  Body: { image: base64, axes: {...}, options: {...} }
  Response: { data: [[x,y], ...], metadata: {...} }

POST /api/detect-axes
  Body: { image: base64 }
  Response: { axes: {...}, confidence: 0.85 }

POST /api/colors
  Body: { image: base64 }
  Response: { dominant: ["#FF0000", "#0000FF"], datasets: 2 }

GET /api/health
```

### Key Features
- Stateless API (no sessions)
- Accept base64 images or multipart upload
- Return structured JSON with confidence scores
- OpenAPI/Swagger spec for documentation

---

## Phase 4: AI-Powered Auto Detection

**Goal:** Zero-config extraction using vision models.

### 4.1 OCR for Axis Labels
- Use Tesseract.js (browser + Node) for tick mark labels
- Parse axis titles to infer units and scale type
- Auto-detect axis ranges from tick labels

### 4.2 Vision Model Integration
- Send plot image to vision LLM (GPT-4V, Claude, Gemini)
- Ask: "What are the axis labels, ranges, and scale types?"
- Use response to auto-calibrate axes
- Configurable: local Tesseract vs cloud vision model

### 4.3 Auto Dataset Detection
- Detect number of datasets by color clustering
- Identify legend entries via OCR
- Label extracted datasets automatically

### 4.4 Smart Extraction Pipeline
```bash
# Fully automatic — AI handles everything
npx ai-plot-digitizer auto plot.png --output data.csv

# Semi-automatic — AI suggests, human confirms
npx ai-plot-digitizer auto plot.png --interactive
```

---

## Phase 5: Browser UI (Optional/Later)

- Minimal web UI for manual calibration
- Drag-and-drop image upload
- Visual point selection and correction
- Built on the same core engine (isomorphic JS)

---

## Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Node.js | Same ecosystem as WPD, good for CLI + API + browser |
| Image processing | sharp + node-canvas | Fast, well-maintained, C++ bindings |
| OCR | Tesseract.js | Works in Node + browser, no external deps |
| CLI framework | Commander.js | Standard, lightweight |
| API framework | Express | Simple, well-known |
| Testing | Jest | Standard for Node projects |
| Vision models | Pluggable | Support multiple providers via adapter pattern |

## Priority Plot Types

1. **XY scatter plots** (primary)
2. **XY line plots** (primary)
3. **Log-scale plots** (log-linear, log-log)
4. **Bar charts** (later)
5. **Ternary/polar** (much later)

---

## Development Workflow

1. All code in `Larry-of-cosmotim/ai-plot-digitizer`
2. `cosmotim` has admin access as collaborator
3. Use feature branches → PR → merge to main
4. Tests required for core engine functions
5. npm publishable when Phase 2 is complete

---

## Reference Material

- WPD v5 source: `/Users/cosmotim/Documents/WebPlotDigitizer/`
- WPD algorithms: `WebPlotDigitizer/javascript/core/` (auto extraction, axes, color filters)
- Key WPD files to study:
  - `javascript/core/AEalgos/averagingWindow.js`
  - `javascript/core/AEalgos/blobDetector.js`  
  - `javascript/core/AEalgos/xStepWithInterpolation.js`
  - `javascript/core/axes/*`
  - `javascript/core/colorAnalysis.js`
