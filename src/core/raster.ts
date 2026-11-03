/**
 * Character cells → pixels, using the embedded bitmap font.
 * Browser-safe (no Node APIs): shared by the CLI's ffmpeg export and the web app's canvas.
 */
import { GLYPHS, GLYPH_H, GLYPH_W } from './font-data.js';
import type { RGB } from './ascii.js';
import type { Cells } from './frame.js';

export { GLYPH_W, GLYPH_H };

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const glyphCache = new Map<string, Uint8Array>();

/**
 * Alpha mask (GLYPH_W × GLYPH_H) for a character. Characters missing from the
 * embedded font (e.g. 한글 in a custom charset) fall back to a solid block whose
 * opacity follows the character's position in the charset (its intended density).
 */
export function glyphMask(ch: string, fallbackDensity = 1): Uint8Array {
  const b64 = GLYPHS[ch];
  const key = b64 ? ch : `\0${Math.round(fallbackDensity * 255)}`;
  let m = glyphCache.get(key);
  if (!m) {
    if (b64) m = decodeBase64(b64);
    else {
      m = new Uint8Array(GLYPH_W * GLYPH_H);
      const a = Math.round(fallbackDensity * 255);
      // leave a small gutter so cells stay distinguishable
      for (let y = 2; y < GLYPH_H - 2; y++) for (let x = 1; x < GLYPH_W - 1; x++) m[y * GLYPH_W + x] = a;
    }
    glyphCache.set(key, m);
  }
  return m;
}

export interface RasterOptions {
  /** Background color. Default black. */
  bg?: RGB;
  /** 3 = RGB24 (ffmpeg rawvideo), 4 = RGBA (canvas ImageData). Default 3. */
  channels?: 3 | 4;
}

/** Pixel size of the rasterized image for a cell grid. */
export function rasterSize(cols: number, rows: number): { width: number; height: number } {
  return { width: cols * GLYPH_W, height: rows * GLYPH_H };
}

/**
 * Rasterize character cells into `out` (cols*GLYPH_W × rows*GLYPH_H pixels).
 * Pass a reused buffer to avoid per-frame allocations (e.g. ImageData.data in the browser).
 */
export function rasterizeInto(
  out: Uint8Array | Uint8ClampedArray,
  cells: Cells,
  charset: string[],
  opts: RasterOptions = {},
): void {
  const { cols, rows, chars, colors } = cells;
  const ch = opts.channels ?? 3;
  const bg = opts.bg ?? [0, 0, 0];
  const W = cols * GLYPH_W;
  const H = rows * GLYPH_H;
  const len = W * H * ch;
  if (out.length < len) throw new Error(`raster buffer too small: ${out.length} < ${len}`);
  const [br, bgG, bb] = bg;

  // Fast path: RGBA written as packed 32-bit pixels (little-endian ABGR).
  const out32 = ch === 4 && LITTLE_ENDIAN && out.byteOffset % 4 === 0 ? new Uint32Array(out.buffer, out.byteOffset, W * H) : null;

  // Background fill.
  if (out32) out32.fill(pack(br, bgG, bb));
  else if (ch === 4) {
    for (let p = 0; p < len; p += 4) {
      out[p] = br;
      out[p + 1] = bgG;
      out[p + 2] = bb;
      out[p + 3] = 255;
    }
  } else if (br || bgG || bb) {
    for (let p = 0; p < len; p += 3) {
      out[p] = br;
      out[p + 1] = bgG;
      out[p + 2] = bb;
    }
  } else {
    out.fill(0, 0, len);
  }

  const denom = Math.max(1, charset.length - 1);
  const density = new Map(charset.map((c, i) => [c, i / denom]));
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const i = cy * cols + cx;
      const c = chars[i]!;
      if (c === ' ') continue;
      const { gy, gx, alpha, n } = sparseGlyph(c, density.get(c) ?? 1);
      const r = colors[i * 3]!;
      const g = colors[i * 3 + 1]!;
      const b = colors[i * 3 + 2]!;
      const origin = cy * GLYPH_H * W + cx * GLYPH_W; // pixel index of the cell's top-left
      // Cells never overlap and the buffer was just filled with `bg`, so blending is
      // bg + (fg - bg) * a — no need to read the destination back.
      if (out32) {
        const solid = pack(r, g, b);
        for (let k = 0; k < n; k++) {
          const a = alpha[k]!;
          out32[origin + gy[k]! * W + gx[k]!] =
            a === 255
              ? solid
              : pack((br + ((r - br) * a) / 255) | 0, (bgG + ((g - bgG) * a) / 255) | 0, (bb + ((b - bb) * a) / 255) | 0);
        }
      } else {
        for (let k = 0; k < n; k++) {
          const a = alpha[k]!;
          const p = (origin + gy[k]! * W + gx[k]!) * ch;
          if (a === 255) {
            out[p] = r;
            out[p + 1] = g;
            out[p + 2] = b;
          } else {
            out[p] = (br + ((r - br) * a) / 255) | 0;
            out[p + 1] = (bgG + ((g - bgG) * a) / 255) | 0;
            out[p + 2] = (bb + ((b - bb) * a) / 255) | 0;
          }
        }
      }
    }
  }
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function pack(r: number, g: number, b: number): number {
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

interface SparseGlyph {
  gy: Uint8Array;
  gx: Uint8Array;
  alpha: Uint8Array;
  n: number;
}

const sparseCache = new Map<Uint8Array, SparseGlyph>();

/** Only the non-transparent pixels of a glyph (most of a cell is empty), cached per mask. */
function sparseGlyph(ch: string, density: number): SparseGlyph {
  const mask = glyphMask(ch, density);
  let s = sparseCache.get(mask);
  if (!s) {
    let n = 0;
    for (let k = 0; k < mask.length; k++) if (mask[k]) n++;
    s = { gy: new Uint8Array(n), gx: new Uint8Array(n), alpha: new Uint8Array(n), n };
    let j = 0;
    for (let y = 0; y < GLYPH_H; y++) {
      for (let x = 0; x < GLYPH_W; x++) {
        const a = mask[y * GLYPH_W + x]!;
        if (!a) continue;
        s.gy[j] = y;
        s.gx[j] = x;
        s.alpha[j++] = a;
      }
    }
    sparseCache.set(mask, s);
  }
  return s;
}

/** Allocate and rasterize (RGB24 by default). */
export function rasterize(cells: Cells, charset: string[], opts: RasterOptions = {}): Uint8Array {
  const { width, height } = rasterSize(cells.cols, cells.rows);
  const out = new Uint8Array(width * height * (opts.channels ?? 3));
  rasterizeInto(out, cells, charset, opts);
  return out;
}
