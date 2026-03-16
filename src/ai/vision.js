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
 * Vision model adapter interface.
 *
 * Implementations must provide an `analyze(imagePath)` method.
 */
export class VisionAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * @param {string} _imagePath
   * @returns {Promise<VisionAnalysis>}
   */
  async analyze(_imagePath) {
    throw new Error(`analyze() not implemented for ${this.name}`);
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
    const imageB64 = (await readFile(imagePath)).toString('base64');
    const ext = imagePath.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VISION_PROMPT },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${imageB64}` } },
            ],
          },
        ],
        max_tokens: 1000,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI API error ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    const raw = json.choices[0].message.content;
    return parseVisionResponse(raw);
  }
}

// ─── Anthropic adapter (Claude) ──────────────────────────────────────

export class AnthropicVisionAdapter extends VisionAdapter {
  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {string} [options.model='claude-sonnet-4-20250514']
   */
  constructor(options = {}) {
    super('anthropic');
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = options.model || 'claude-sonnet-4-20250514';
  }

  async analyze(imagePath) {
    if (!this.apiKey) throw new Error('Anthropic API key required (set ANTHROPIC_API_KEY or pass apiKey)');
    const imageB64 = (await readFile(imagePath)).toString('base64');
    const ext = imagePath.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mime, data: imageB64 } },
              { type: 'text', text: VISION_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Anthropic API error ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    const raw = json.content[0].text;
    return parseVisionResponse(raw);
  }
}

// ─── Google adapter (Gemini) ─────────────────────────────────────────

export class GoogleVisionAdapter extends VisionAdapter {
  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {string} [options.model='gemini-2.5-flash']
   */
  constructor(options = {}) {
    super('google');
    this.apiKey = options.apiKey || process.env.GOOGLE_API_KEY;
    this.model = options.model || 'gemini-2.5-flash';
  }

  async analyze(imagePath) {
    if (!this.apiKey) throw new Error('Google API key required (set GOOGLE_API_KEY or pass apiKey)');
    const imageB64 = (await readFile(imagePath)).toString('base64');
    const ext = imagePath.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: VISION_PROMPT },
              { inlineData: { mimeType: mime, data: imageB64 } },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Google API error ${resp.status}: ${text}`);
    }

    const json = await resp.json();
    const raw = json.candidates[0].content.parts[0].text;
    return parseVisionResponse(raw);
  }
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
