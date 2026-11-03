import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  asciiBox,
  exportGrid,
  fitRect,
  frameToCells,
  GLYPH_H,
  GLYPH_W,
  rasterize,
  rasterizeInto,
  rasterSize,
  resolveCharset,
} from '../src/core/index.js';

describe('core boundary', () => {
  const dir = join(__dirname, '../src/core');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    it(`${f} uses no Node-only APIs (shared with the browser)`, () => {
      // strip comments so documentation mentioning these APIs doesn't trip the check
      const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/from ['"]node:/);
      expect(src).not.toMatch(/require\(/);
      expect(src).not.toMatch(/\bBuffer\b/);
      expect(src).not.toMatch(/\bprocess\./);
    });
  }
});

describe('rasterizeInto', () => {
  const charset = resolveCharset('standard');
  const px = new Uint8Array([255, 255, 255, 0, 0, 0]);
  const cells = frameToCells(px, 2, 1, { charset, mode: 'color' });

  it('writes RGBA with opaque alpha for canvas ImageData', () => {
    const { width, height } = rasterSize(2, 1);
    const out = new Uint8ClampedArray(width * height * 4);
    rasterizeInto(out, cells, charset, { channels: 4 });
    for (let p = 3; p < out.length; p += 4) expect(out[p]).toBe(255);
    expect(out.some((v, i) => i % 4 !== 3 && v === 255)).toBe(true);
  });

  it('matches the RGB24 output pixel for pixel', () => {
    const rgb = rasterize(cells, charset);
    const rgba = rasterize(cells, charset, { channels: 4 });
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      expect([rgba[j], rgba[j + 1], rgba[j + 2]]).toEqual([rgb[i], rgb[i + 1], rgb[i + 2]]);
    }
  });

  it('fills a custom background and fully resets reused buffers', () => {
    const out = new Uint8Array(rasterSize(2, 1).width * rasterSize(2, 1).height * 3).fill(7);
    rasterizeInto(out, frameToCells(new Uint8Array(6), 2, 1, { charset, mode: 'mono' }), charset, { bg: [1, 2, 3] });
    expect([...out.subarray(0, 6)]).toEqual([1, 2, 3, 1, 2, 3]);
    expect(out.every((v, i) => v === [1, 2, 3][i % 3])).toBe(true);
  });

  it('rejects a buffer that is too small', () => {
    expect(() => rasterizeInto(new Uint8Array(10), cells, charset)).toThrow();
  });
});

describe('frameToCells with RGBA input', () => {
  it('gives the same cells as RGB input', () => {
    const charset = resolveCharset('blocks');
    const rgb = new Uint8Array([10, 200, 30, 250, 250, 250, 90, 90, 90]);
    const rgba = new Uint8ClampedArray([10, 200, 30, 255, 250, 250, 250, 255, 90, 90, 90, 255]);
    const opts = { charset, mode: 'color' as const, contrast: 1.4 };
    expect(frameToCells(rgba, 3, 1, opts, 4)).toEqual(frameToCells(rgb, 3, 1, opts));
  });
});

describe('layout', () => {
  it('gives the ASCII the full 9:16 frame, or the bottom half when side-by-side', () => {
    expect(asciiBox({ vertical: true, sideBySide: false })).toEqual({ width: 1080, height: 1920 });
    expect(asciiBox({ vertical: true, sideBySide: true })).toEqual({ width: 1080, height: 960 });
  });
  it('derives the grid from the glyph size', () => {
    expect(exportGrid({ vertical: true, sideBySide: false })).toEqual({ maxCols: 1080 / GLYPH_W, maxRows: 1920 / GLYPH_H });
  });
  it('fits and centers like object-fit: contain', () => {
    expect(fitRect(1920, 1080, { x: 0, y: 0, width: 1080, height: 1920 })).toEqual({ x: 0, y: 656, width: 1080, height: 608 });
    expect(fitRect(1080, 1920, { x: 0, y: 960, width: 1080, height: 960 })).toEqual({ x: 270, y: 960, width: 540, height: 960 });
  });
  it('handles empty input', () => {
    expect(fitRect(0, 10, { x: 5, y: 5, width: 10, height: 10 }).width).toBe(0);
  });
});
