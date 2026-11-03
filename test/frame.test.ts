import { describe, expect, it } from 'vitest';
import { resolveCharset } from '../src/ascii.js';
import { cellsToAnsiLines, composeScreen, frameToCells } from '../src/frame.js';
import { progressBar } from '../src/progress.js';
import { visibleWidth } from '../src/player.js';
import { parseProbe } from '../src/ffmpeg.js';
import { buildExportArgs, buildFilter, exportGrid, GLYPH_H, GLYPH_W, rasterize } from '../src/export.js';

// 2×2 frame: black, white, red, dark gray
const rgb = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 0, 0, 40, 40, 40]);
const charset = resolveCharset('standard');

describe('frameToCells', () => {
  it('maps pixel brightness to characters', () => {
    const c = frameToCells(rgb, 2, 2, { charset, mode: 'mono' });
    expect(c.chars[0]).toBe(' ');
    expect(c.chars[1]).toBe('@');
  });
  it('keeps original colors in color mode', () => {
    const c = frameToCells(rgb, 2, 2, { charset, mode: 'color' });
    expect([...c.colors.subarray(6, 9)]).toEqual([255, 0, 0]);
  });
  it('threshold blanks dark pixels', () => {
    const c = frameToCells(rgb, 2, 2, { charset, mode: 'mono', threshold: 60 });
    expect(c.chars[3]).toBe(' ');
  });
  it('throws on a short buffer', () => {
    expect(() => frameToCells(new Uint8Array(3), 2, 2, { charset, mode: 'mono' })).toThrow();
  });
});

describe('cellsToAnsiLines', () => {
  it('emits plain text in mono mode', () => {
    const lines = cellsToAnsiLines(frameToCells(rgb, 2, 2, { charset, mode: 'mono' }), 'mono');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(' @');
  });
  it('emits truecolor escapes, skipping blanks and repeated colors', () => {
    const px = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 255]);
    const [line] = cellsToAnsiLines(frameToCells(px, 3, 1, { charset, mode: 'color' }), 'color');
    expect(line).toBe(' \x1b[38;2;248;248;248m@@');
    expect(visibleWidth(line!)).toBe(3);
  });
});

describe('composeScreen', () => {
  it('positions each line absolutely (1-based)', () => {
    expect(composeScreen(['ab', 'cd'], 2, 1)).toBe('\x1b[2;3Hab\x1b[3;3Hcd');
  });
});

describe('progressBar', () => {
  it('renders proportional fill', () => {
    expect(progressBar(5, 10, 10)).toBe('[█████░░░░░]  50% 5/10');
    expect(progressBar(20, 10, 4)).toBe('[████] 100% 20/10');
    expect(progressBar(0, 0, 4)).toBe('[░░░░]   0% 0/?');
  });
});

describe('parseProbe', () => {
  const base = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':
  Duration: 00:01:02.50, start: 0.000000, bitrate: 1000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 900 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s (default)`;
  it('reads size, fps, duration and audio', () => {
    expect(parseProbe(base)).toEqual({ width: 1920, height: 1080, fps: 29.97, duration: 62.5, hasAudio: true });
  });
  it('swaps dimensions for rotated phone videos', () => {
    const rotated = `${base}\n    Side data:\n      displaymatrix: rotation of -90.00 degrees`;
    expect(parseProbe(rotated)).toMatchObject({ width: 1080, height: 1920 });
  });
  it('detects missing audio', () => {
    expect(parseProbe(base.split('\n').slice(0, 3).join('\n')).hasAudio).toBe(false);
  });
  it('throws without a video stream', () => {
    expect(() => parseProbe('Duration: 00:00:01.00')).toThrow();
  });
});

describe('export helpers', () => {
  it('rasterizes cells into an RGB image of the right size', () => {
    const cells = frameToCells(rgb, 2, 2, { charset, mode: 'color' });
    const img = rasterize(cells, charset);
    expect(img.length).toBe(2 * GLYPH_W * 2 * GLYPH_H * 3);
    // top-left cell is a space → stays black
    expect(img.subarray(0, GLYPH_W * 3).every((v) => v === 0)).toBe(true);
    // some pixel in the red '@' cell is red
    expect(img.some((v, i) => i % 3 === 0 && v === 255)).toBe(true);
  });
  it('falls back to a density block for glyphs missing from the font', () => {
    const cs = resolveCharset(' 춤');
    const cells = { cols: 1, rows: 1, chars: ['춤'], colors: new Uint8Array([255, 255, 255]) };
    const img = rasterize(cells, cs);
    expect(img.some((v) => v === 255)).toBe(true);
  });
  it('sizes the vertical grid to fit 1080 wide', () => {
    expect(exportGrid({ vertical: true, sideBySide: false }).maxCols * GLYPH_W).toBeLessThanOrEqual(1080);
  });
  it('builds layouts', () => {
    expect(buildFilter({ vertical: true, sideBySide: true }, 100, 100, 30)).toContain('vstack');
    expect(buildFilter({ vertical: false, sideBySide: true }, 100, 100, 30)).toContain('hstack');
    expect(buildFilter({ vertical: true, sideBySide: false }, 100, 100, 30)).toContain('pad=1080:1920');
  });
  it('maps original audio only when present', () => {
    const args = (hasAudio: boolean) =>
      buildExportArgs({ input: 'in.mp4', output: 'o.mp4', width: 120, height: 240, fps: 30, layout: { vertical: false, sideBySide: false }, hasAudio });
    expect(args(true)).toContain('1:a:0');
    expect(args(false)).not.toContain('1:a:0');
    expect(args(true).at(-1)).toBe('o.mp4');
  });
});
