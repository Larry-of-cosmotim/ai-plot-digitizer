import { describe, test, expect } from '@jest/globals';
import { createVisionAdapter, VisionAdapter } from '../src/ai/vision.js';

describe('Vision adapter factory', () => {
  test('creates OpenAI adapter', () => {
    const adapter = createVisionAdapter('openai', { apiKey: 'test' });
    expect(adapter.name).toBe('openai');
    expect(adapter).toBeInstanceOf(VisionAdapter);
  });

  test('creates Anthropic adapter', () => {
    const adapter = createVisionAdapter('anthropic', { apiKey: 'test' });
    expect(adapter.name).toBe('anthropic');
  });

  test('creates Google adapter', () => {
    const adapter = createVisionAdapter('google', { apiKey: 'test' });
    expect(adapter.name).toBe('google');
  });

  test('throws on unknown provider', () => {
    expect(() => createVisionAdapter('unknown')).toThrow('Unknown vision provider');
  });
});

describe('VisionAdapter base', () => {
  test('throws on unimplemented analyze()', async () => {
    const adapter = new VisionAdapter('test');
    await expect(adapter.analyze('/tmp/test.png')).rejects.toThrow('not implemented');
  });
});
