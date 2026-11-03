/**
 * Frame conversion: raw RGB pixels (already scaled to cols×rows) → character cells → ANSI text.
 * Pure functions, no I/O.
 */
import { adjustLuminance, luminance, luminanceToIndex, matrixColor, type ColorMode, type ToneOptions } from './ascii.js';

export interface RenderOptions extends ToneOptions {
  charset: string[];
  mode: ColorMode;
}

export interface Cells {
  cols: number;
  rows: number;
  /** One character per cell, row-major. */
  chars: string[];
  /** Foreground RGB per cell (cols*rows*3). Meaningful for color/matrix modes. */
  colors: Uint8Array;
}

/** Default foreground for mono mode in exported videos. */
export const MONO_FG: [number, number, number] = [235, 235, 235];

/**
 * Convert a cols×rows pixel buffer into character cells.
 * `channels` = 3 for RGB24 (ffmpeg rawvideo), 4 for RGBA (canvas ImageData).
 */
export function frameToCells(
  rgb: Uint8Array | Uint8ClampedArray,
  cols: number,
  rows: number,
  opts: RenderOptions,
  channels: 3 | 4 = 3,
): Cells {
  const n = cols * rows;
  if (rgb.length < n * channels) throw new Error(`frame buffer too small: ${rgb.length} < ${n * channels}`);
  const chars = new Array<string>(n);
  const colors = new Uint8Array(n * 3);
  const { charset, mode } = opts;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * channels]!;
    const g = rgb[i * channels + 1]!;
    const b = rgb[i * channels + 2]!;
    const l = adjustLuminance(luminance(r, g, b), opts);
    chars[i] = charset[luminanceToIndex(l, charset.length)]!;
    if (mode === 'color') {
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    } else if (mode === 'matrix') {
      const c = matrixColor(l);
      colors.set(c, i * 3);
    } else {
      colors.set(MONO_FG, i * 3);
    }
  }
  return { cols, rows, chars, colors };
}

/**
 * Render cells to one string per row. Color escapes are only emitted when the
 * color changes, and never for blank cells, to keep frames small.
 * Colors are quantized (step 8) so neighbouring cells share escapes more often.
 */
export function cellsToAnsiLines(cells: Cells, mode: ColorMode): string[] {
  const lines: string[] = [];
  const { cols, rows, chars, colors } = cells;
  const useColor = mode !== 'mono';
  for (let y = 0; y < rows; y++) {
    let line = '';
    let last = -1;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const ch = chars[i]!;
      if (useColor && ch !== ' ') {
        const r = colors[i * 3]! & 0xf8;
        const g = colors[i * 3 + 1]! & 0xf8;
        const b = colors[i * 3 + 2]! & 0xf8;
        const key = (r << 16) | (g << 8) | b;
        if (key !== last) {
          line += `\x1b[38;2;${r};${g};${b}m`;
          last = key;
        }
      }
      line += ch;
    }
    lines.push(line);
  }
  return lines;
}

/** Compose a full-screen frame: position each line with absolute cursor moves (no flicker, no scroll). */
export function composeScreen(lines: string[], offsetX: number, offsetY: number): string {
  let out = '';
  for (let y = 0; y < lines.length; y++) {
    out += `\x1b[${offsetY + y + 1};${offsetX + 1}H${lines[y]}`;
  }
  return out;
}
