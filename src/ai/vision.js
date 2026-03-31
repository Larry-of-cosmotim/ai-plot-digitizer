/**
 * Vision model integration — pluggable adapter pattern.
 *
 * Sends plot images to vision-capable LLMs to identify axes, ranges,
 * scale types, number of datasets, and data-series colours.
 *
 * @module ai/vision
 */

import { readFile } from 'node:fs/promises';

/**
 * @typedef {object} VisionAnalysis
 * @property {string} plotType - e.g. "xy_scatter", "xy_line", "bar", "log_log"
 * @property {{ x: string, y: string }} axisLabels
 * @property {{ x: string, y: string }} scaleTypes - "linear" | "log"
 * @property {{ xmin: number, xmax: number, ymin: number, ymax: number }} ranges
 * @property {{ color: string, label: string }[]} datasets
 * @property {number} confidence - 0-1
 * @property {string} rawResponse - Full model response for debugging
 */

/**
 * @typedef {object} VisionDataExtraction
 * @property {string} plotType
 * @property {{ x: string, y: string }} axisLabels
 * @property {{ x: string, y: string }} scaleTypes
 * @property {{ color: string, label: string, data: number[][] }[]} datasets
 * @property {number} confidence
 * @property {string} rawResponse
 */

/**
 * Vision model adapter interface.
 *
 * Implementations must provide `analyze(imagePath)` and `extractData(imagePath)`.
 */
export class VisionAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * Analyze plot structure (axes, ranges, colours).
   * @param {string} _imagePath
   * @returns {Promise<VisionAnalysis>}
   */
  async analyze(_imagePath) {
    throw new Error(`analyze() not implemented for ${this.name}`);
  }

  /**
   * Directly read data point coordinates from the plot image.
   * @param {string} _imagePath
   * @param {object} [_options]
   * @param {string} [_options.seriesHint] - Hint about which series to extract (e.g. "red circles")
   * @returns {Promise<VisionDataExtraction>}
   */
  async extractData(_imagePath, _options) {
    throw new Error(`extractData() not implemented for ${this.name}`);
  }
}

// ─── OpenAI adapter (GPT-4V / GPT-4o) ───────────────────────────────

export class OpenAIVisionAdapter extends VisionAdapter {
  /**
   * @param {object} options
   * @param {string} options.apiKey - OpenAI API key.
   * @param {string} [options.model='gpt-4o'] - Model identifier.
   */
  constructor(options = {}) {
    super('openai');
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.model = options.model || 'gpt-4o';
  }

  async analyze(imagePath) {
    if (!this.apiKey) throw new Error('OpenAI API key required (set OPENAI_API_KEY or pass apiKey)');
    const raw = await callVisionAPI(this, imagePath, VISION_PROMPT, 1000);
    return parseVisionResponse(raw);
  }
}
addExtractDataMethod(OpenAIVisionAdapter.prototype);

// ─── Anthropic adapter (Claude) ──────────────────────────────────────

export class AnthropicVisionAdapter extends VisionAdapter {
  constructor(options = {}) {
    super('anthropic');
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = options.model || 'claude-sonnet-4-20250514';
  }

  async analyze(imagePath) {
    if (!this.apiKey) throw new Error('Anthropic API key required (set ANTHROPIC_API_KEY or pass apiKey)');
    const raw = await callVisionAPI(this, imagePath, VISION_PROMPT, 1000);
    return parseVisionResponse(raw);
  }
}
addExtractDataMethod(AnthropicVisionAdapter.prototype);

// ─── Google adapter (Gemini) ─────────────────────────────────────────

export class GoogleVisionAdapter extends VisionAdapter {
  constructor(options = {}) {
    super('google');
    this.apiKey = options.apiKey || process.env.GOOGLE_API_KEY;
    this.model = options.model || 'gemini-2.5-flash';
  }

  async analyze(imagePath) {
    if (!this.apiKey) throw new Error('Google API key required (set GOOGLE_API_KEY or pass apiKey)');
    const raw = await callVisionAPI(this, imagePath, VISION_PROMPT, 1000);
    return parseVisionResponse(raw);
  }
}
addExtractDataMethod(GoogleVisionAdapter.prototype);

// ─── Shared helpers for extractData ──────────────────────────────────

/**
 * Build the image payload for a given provider and send the data-extraction prompt.
 * Returns the raw response text.
 */
async function callVisionAPI(adapter, imagePath, prompt, maxTokens = 4000) {
  const imageB64 = (await readFile(imagePath)).toString('base64');
  const ext = imagePath.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';

  if (adapter.name === 'openai') {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adapter.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: adapter.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${imageB64}` } },
          ],
        }],
        max_tokens: maxTokens,
      }),
    });
    if (!resp.ok) throw new Error(`OpenAI API error ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    return json.choices[0].message.content;

  } else if (adapter.name === 'anthropic') {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': adapter.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: adapter.model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: imageB64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    return json.content[0].text;

  } else if (adapter.name === 'google') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${adapter.model}:generateContent?key=${adapter.apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: mime, data: imageB64 } },
          ],
        }],
      }),
    });
    if (!resp.ok) throw new Error(`Google API error ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    return json.candidates[0].content.parts[0].text;
  }

  throw new Error(`Unsupported adapter: ${adapter.name}`);
}

/**
 * Add extractData() to an adapter instance using the shared callVisionAPI helper.
 */
function addExtractDataMethod(adapter) {
  adapter.extractData = async function (imagePath, options = {}) {
    if (!this.apiKey) {
      throw new Error(`${this.name} API key required`);
    }

    const seriesHint = options.seriesHint
      ? `\nFocus especially on this data series: ${options.seriesHint}`
      : '';

    const prompt = DATA_EXTRACTION_PROMPT + seriesHint;
    const raw = await callVisionAPI(this, imagePath, prompt);
    return parseDataExtractionResponse(raw);
  };
}

// ─── Shared prompt & response parser ─────────────────────────────────

const VISION_PROMPT = `Analyze this scientific plot image. Return ONLY valid JSON (no markdown, no explanation) with this exact structure:
{
  "plotType": "xy_scatter" | "xy_line" | "bar" | "log_log" | "log_linear" | "other",
  "axisLabels": { "x": "label text", "y": "label text" },
  "scaleTypes": { "x": "linear" | "log", "y": "linear" | "log" },
  "ranges": { "xmin": number, "xmax": number, "ymin": number, "ymax": number },
  "datasets": [{ "color": "#hex", "label": "series name" }],
  "confidence": 0.0 to 1.0
}
Read the axis labels, tick marks, and legend carefully. If unsure about a value, use your best estimate and lower the confidence.`;

/**
 * Parse the raw LLM response text into a structured VisionAnalysis.
 *
 * @param {string} raw - Raw text from the model.
 * @returns {VisionAnalysis}
 */
function parseVisionResponse(raw) {
  // Try to extract JSON from the response (handle markdown code blocks)
  let jsonStr = raw;
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  // Try to find a JSON object
  const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    jsonStr = braceMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      plotType: parsed.plotType || 'unknown',
      axisLabels: parsed.axisLabels || { x: '', y: '' },
      scaleTypes: parsed.scaleTypes || { x: 'linear', y: 'linear' },
      ranges: parsed.ranges || { xmin: 0, xmax: 1, ymin: 0, ymax: 1 },
      datasets: parsed.datasets || [],
      confidence: parsed.confidence ?? 0,
      rawResponse: raw,
    };
  } catch {
    return {
      plotType: 'unknown',
      axisLabels: { x: '', y: '' },
      scaleTypes: { x: 'linear', y: 'linear' },
      ranges: { xmin: 0, xmax: 1, ymin: 0, ymax: 1 },
      datasets: [],
      confidence: 0,
      rawResponse: raw,
    };
  }
}

// ─── Data extraction prompt & parser ─────────────────────────────────

const DATA_EXTRACTION_PROMPT = `You are a scientific plot data extraction expert. Look at this plot image very carefully and read the actual data point values.

Return ONLY valid JSON (no markdown fences, no explanation) with this exact structure:
{
  "plotType": "xy_scatter" | "xy_line" | "bar" | "other",
  "axisLabels": { "x": "label text or empty string", "y": "label text or empty string" },
  "scaleTypes": { "x": "linear" | "log", "y": "linear" | "log" },
  "datasets": [
    {
      "label": "series name from legend, or 'Series 1'",
      "color": "#hex approximate color",
      "data": [[x1, y1], [x2, y2], ...]
    }
  ],
  "confidence": 0.0 to 1.0
}

CRITICAL INSTRUCTIONS:
- Read the actual numerical values from the axes carefully
- For each visible data point, estimate its x and y coordinates by looking at where it falls relative to the axis tick marks
- Include ALL visible data points, not just a few
- For line plots, sample enough points to reconstruct the curve (at least 15-20 points per line, more for complex curves)
- For scatter plots, include every visible point
- Order points by x-coordinate within each dataset
- If there are multiple datasets (different colors/markers), separate them
- Use the axis scale (linear or log) to read values correctly
- Be as precise as possible — read values to the resolution the tick marks allow`;

/**
 * Parse the data extraction response from a vision model.
 *
 * @param {string} raw
 * @returns {VisionDataExtraction}
 */
function parseDataExtractionResponse(raw) {
  let jsonStr = raw;
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];

  const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (braceMatch) jsonStr = braceMatch[0];

  try {
    const parsed = JSON.parse(jsonStr);
    const datasets = (parsed.datasets || []).map((ds, i) => ({
      label: ds.label || `Series ${i + 1}`,
      color: ds.color || '#000000',
      data: Array.isArray(ds.data) ? ds.data.filter(
        (pt) => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])
      ) : [],
    }));

    return {
      plotType: parsed.plotType || 'unknown',
      axisLabels: parsed.axisLabels || { x: '', y: '' },
      scaleTypes: parsed.scaleTypes || { x: 'linear', y: 'linear' },
      datasets,
      confidence: parsed.confidence ?? 0,
      rawResponse: raw,
    };
  } catch {
    return {
      plotType: 'unknown',
      axisLabels: { x: '', y: '' },
      scaleTypes: { x: 'linear', y: 'linear' },
      datasets: [],
      confidence: 0,
      rawResponse: raw,
    };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Create a vision adapter by provider name.
 *
 * @param {string} provider - "openai" | "anthropic" | "google"
 * @param {object} [options]
 * @returns {VisionAdapter}
 */
export function createVisionAdapter(provider, options = {}) {
  switch (provider) {
    case 'openai':
      return new OpenAIVisionAdapter(options);
    case 'anthropic':
      return new AnthropicVisionAdapter(options);
    case 'google':
      return new GoogleVisionAdapter(options);
    default:
      throw new Error(`Unknown vision provider: ${provider}. Use "openai", "anthropic", or "google".`);
  }
}
