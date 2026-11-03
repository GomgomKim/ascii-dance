import { describe, expect, it } from 'vitest';
import {
  adjustLuminance,
  CHARSETS,
  computeSize,
  luminance,
  luminanceToChar,
  luminanceToIndex,
  matrixColor,
  resolveCharset,
} from '../src/ascii.js';

describe('resolveCharset', () => {
  it('defaults to the standard preset', () => {
    expect(resolveCharset(undefined).join('')).toBe(CHARSETS.standard);
  });
  it('resolves presets by name', () => {
    expect(resolveCharset('blocks')).toEqual([' ', '░', '▒', '▓', '█']);
    expect(resolveCharset('code').join('')).toBe(CHARSETS.code);
  });
  it('treats unknown strings as a custom charset, split by code point', () => {
    expect(resolveCharset(' 춤춰💃')).toEqual([' ', '춤', '춰', '💃']);
  });
  it('rejects charsets shorter than 2', () => {
    expect(() => resolveCharset('x')).toThrow();
  });
});

describe('luminance', () => {
  it('maps black/white to 0/255', () => {
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(255, 255, 255)).toBeCloseTo(255);
  });
  it('weights green more than blue', () => {
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(0, 0, 255));
  });
});

describe('luminanceToIndex / luminanceToChar', () => {
  const cs = resolveCharset('standard');
  it('maps darkest to first char and brightest to last', () => {
    expect(luminanceToChar(0, cs)).toBe(' ');
    expect(luminanceToChar(255, cs)).toBe('@');
  });
  it('splits the range evenly', () => {
    expect(luminanceToIndex(127, 2)).toBe(0);
    expect(luminanceToIndex(128, 2)).toBe(1);
    expect(luminanceToIndex(63, 4)).toBe(0);
    expect(luminanceToIndex(64, 4)).toBe(1);
  });
  it('clamps out-of-range values', () => {
    expect(luminanceToIndex(-10, 10)).toBe(0);
    expect(luminanceToIndex(999, 10)).toBe(9);
  });
  it('is monotonic', () => {
    let prev = 0;
    for (let l = 0; l <= 255; l++) {
      const i = luminanceToIndex(l, cs.length);
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
  });
});

describe('adjustLuminance', () => {
  it('is identity with no options', () => {
    expect(adjustLuminance(100)).toBe(100);
  });
  it('inverts', () => {
    expect(adjustLuminance(0, { invert: true })).toBe(255);
    expect(adjustLuminance(200, { invert: true })).toBe(55);
  });
  it('applies contrast around mid-gray and clamps', () => {
    expect(adjustLuminance(128, { contrast: 2 })).toBe(128);
    expect(adjustLuminance(150, { contrast: 2 })).toBe(172);
    expect(adjustLuminance(250, { contrast: 3 })).toBe(255);
    expect(adjustLuminance(10, { contrast: 3 })).toBe(0);
  });
  it('drops values below threshold to 0 (background removal)', () => {
    expect(adjustLuminance(59, { threshold: 60 })).toBe(0);
    expect(adjustLuminance(60, { threshold: 60 })).toBe(60);
  });
  it('applies invert → contrast → threshold in order', () => {
    // 200 → invert 55 → contrast 2: (55-128)*2+128 = -18 → 0 → below threshold
    expect(adjustLuminance(200, { invert: true, contrast: 2, threshold: 10 })).toBe(0);
    // 20 → invert 235 → contrast 2 → 255 (clamped)
    expect(adjustLuminance(20, { invert: true, contrast: 2, threshold: 10 })).toBe(255);
  });
});

describe('matrixColor', () => {
  it('is green dominant and brighter for brighter input', () => {
    const dark = matrixColor(30);
    const mid = matrixColor(150);
    expect(mid[1]).toBeGreaterThan(dark[1]);
    expect(mid[1]).toBeGreaterThan(mid[0]);
    expect(mid[1]).toBeGreaterThan(mid[2]);
  });
  it('glows near-white for highlights', () => {
    expect(matrixColor(255)).toEqual([190, 255, 190]);
  });
});

describe('computeSize', () => {
  it('fits a 16:9 video to terminal width, halving rows for tall cells', () => {
    expect(computeSize(1920, 1080, { maxCols: 160, maxRows: 100 })).toEqual({ cols: 160, rows: 45 });
  });
  it('limits by height when the terminal is short (portrait video)', () => {
    // 9:16 at 200 cols would need 178 rows; clamp to 50 rows → 50 * (9/16) / 0.5 = 56.25 → 56 cols
    expect(computeSize(1080, 1920, { maxCols: 200, maxRows: 50 })).toEqual({ cols: 56, rows: 50 });
  });
  it('honors explicit width', () => {
    expect(computeSize(1920, 1080, { maxCols: 80, maxRows: 24, width: 120 })).toEqual({ cols: 120, rows: 34 });
  });
  it('supports a custom char aspect', () => {
    expect(computeSize(100, 100, { maxCols: 50, maxRows: 100, charAspect: 1 })).toEqual({ cols: 50, rows: 50 });
  });
  it('never returns zero', () => {
    expect(computeSize(10000, 10, { maxCols: 10, maxRows: 10 })).toEqual({ cols: 10, rows: 1 });
  });
  it('rejects invalid sizes', () => {
    expect(() => computeSize(0, 100, { maxCols: 10, maxRows: 10 })).toThrow();
  });
});
