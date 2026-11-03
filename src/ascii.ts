/**
 * Pure functions: brightness → character mapping, colors, and size calculation.
 * No I/O here so everything is unit-testable.
 */

/** Charset presets, ordered from darkest (index 0, usually a space) to brightest. */
export const CHARSETS = {
  standard: ' .:-=+*#%@',
  detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: ' ░▒▓█',
  code: ' .,:;=+()[]{}<>#',
} as const;

export type CharsetName = keyof typeof CHARSETS;

/** Resolve a preset name, or treat any other string as a custom charset (dark → bright). */
export function resolveCharset(input: string | undefined): string[] {
  const raw = input === undefined || input === '' ? CHARSETS.standard : input in CHARSETS ? CHARSETS[input as CharsetName] : input;
  // Array.from splits by code point, so multi-byte characters (░, emoji, 한글) stay intact.
  const chars = Array.from(raw);
  if (chars.length < 2) throw new Error(`charset needs at least 2 characters (got ${JSON.stringify(raw)})`);
  return chars;
}

/** Perceived luminance (Rec. 709), 0–255. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface ToneOptions {
  /** Flip brightness: dark becomes bright. Applied first. */
  invert?: boolean;
  /** Contrast multiplier around mid-gray (1 = unchanged). */
  contrast?: number;
  /** Anything darker than this (after invert/contrast) becomes pure black → blank. 0–255. */
  threshold?: number;
}

/** Apply invert → contrast → threshold to a luminance value. Returns 0–255. */
export function adjustLuminance(l: number, opts: ToneOptions = {}): number {
  let v = opts.invert ? 255 - l : l;
  const c = opts.contrast ?? 1;
  if (c !== 1) v = (v - 128) * c + 128;
  v = clamp(v, 0, 255);
  if (opts.threshold !== undefined && opts.threshold > 0 && v < opts.threshold) return 0;
  return v;
}

/** Map a 0–255 luminance to an index in a charset of length n. */
export function luminanceToIndex(l: number, n: number): number {
  const i = Math.floor((clamp(l, 0, 255) / 256) * n);
  return Math.min(n - 1, i);
}

export function luminanceToChar(l: number, charset: string[]): string {
  return charset[luminanceToIndex(l, charset.length)]!;
}

export type ColorMode = 'mono' | 'color' | 'matrix';

export type RGB = [number, number, number];

/** Matrix theme: dark → deep green, bright → glowing pale green. */
export function matrixColor(l: number): RGB {
  const t = clamp(l, 0, 255) / 255;
  if (t > 0.88) return [190, 255, 190];
  return [Math.round(20 * t), Math.round(70 + 185 * t), Math.round(35 * t)];
}

export interface SizeOptions {
  /** Available columns/rows (terminal size, or a virtual canvas for export). */
  maxCols: number;
  maxRows: number;
  /** Explicit column count; overrides fitting by width. */
  width?: number;
  /** Width / height of one character cell. Terminal fonts are ~0.5 (twice as tall as wide). */
  charAspect?: number;
}

/**
 * Compute the ASCII grid size for a video, preserving the video's aspect ratio
 * while correcting for tall character cells.
 */
export function computeSize(videoW: number, videoH: number, opts: SizeOptions): { cols: number; rows: number } {
  if (videoW <= 0 || videoH <= 0) throw new Error('invalid video size');
  const aspect = opts.charAspect ?? 0.5;
  // rows needed for `cols` columns: cols * (H/W) * charAspect
  const rowsFor = (cols: number) => Math.max(1, Math.round(cols * (videoH / videoW) * aspect));
  if (opts.width !== undefined) {
    const cols = Math.max(1, Math.floor(opts.width));
    return { cols, rows: rowsFor(cols) };
  }
  let cols = Math.max(1, Math.floor(opts.maxCols));
  let rows = rowsFor(cols);
  if (rows > opts.maxRows) {
    rows = Math.max(1, Math.floor(opts.maxRows));
    cols = Math.max(1, Math.min(Math.floor(opts.maxCols), Math.round((rows * (videoW / videoH)) / aspect)));
  }
  return { cols, rows };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
