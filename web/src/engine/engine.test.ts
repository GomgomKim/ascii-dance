import { describe, expect, it } from 'vitest';
import { EXPORT, REELS_SAFE_AREA, WATERMARK } from '../config';
import { frameTimestamps, pickFps } from './timing';
import { charsetFor, watermarkPosition } from './renderer';
import { DEFAULT_SETTINGS } from './settings';

describe('watermarkPosition', () => {
  const { centerX, maxWidth, bottom } = watermarkPosition(EXPORT.width, EXPORT.height);
  it('sits just above the Reels bottom UI', () => {
    expect(bottom).toBe(EXPORT.height - REELS_SAFE_AREA.bottom - WATERMARK.gapAboveSafeEdge);
    // backdrop bottom edge (baseline + descent + padding) must stay inside the safe area
    expect(bottom + 8 + WATERMARK.padding.y).toBeLessThanOrEqual(EXPORT.height - REELS_SAFE_AREA.bottom);
  });
  it('stays clear of the side buttons when centered', () => {
    expect(centerX - maxWidth / 2).toBeGreaterThanOrEqual(REELS_SAFE_AREA.left);
    expect(centerX + maxWidth / 2).toBeLessThanOrEqual(EXPORT.width - REELS_SAFE_AREA.right);
  });
});

describe('export timing', () => {
  it('rounds and clamps the source frame rate', () => {
    expect(pickFps(29.97)).toBe(30);
    expect(pickFps(120)).toBe(60);
    expect(pickFps(5)).toBe(12);
    expect(pickFps(NaN)).toBe(EXPORT.fps);
  });
  it('produces one timestamp per output frame', () => {
    const ts = [...frameTimestamps(2, 30)];
    expect(ts).toHaveLength(60);
    expect(ts[0]).toBe(0);
    expect(ts[59]).toBeCloseTo(59 / 30);
  });
});

describe('settings', () => {
  it('uses the same charsets as the CLI', () => {
    expect(charsetFor(DEFAULT_SETTINGS).join('')).toBe(' .:-=+*#%@');
    expect(charsetFor({ ...DEFAULT_SETTINGS, charset: 'custom', customCharset: ' 춤' })).toEqual([' ', '춤']);
  });
});
