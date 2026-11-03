import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { GLYPHS, GLYPH_H, GLYPH_W } from './font-data.js';
import { ffmpegPath } from './ffmpeg.js';
import type { Cells } from './frame.js';

export { GLYPH_W, GLYPH_H };

const glyphCache = new Map<string, Uint8Array>();

/**
 * Alpha mask for a character. Characters missing from the embedded font
 * (e.g. 한글 in a custom charset) fall back to a solid block whose opacity
 * follows the character's position in the charset (its intended density).
 */
export function glyphMask(ch: string, fallbackDensity = 1): Uint8Array {
  const key = GLYPHS[ch] ? ch : `\0${Math.round(fallbackDensity * 255)}`;
  let m = glyphCache.get(key);
  if (!m) {
    if (GLYPHS[ch]) m = new Uint8Array(Buffer.from(GLYPHS[ch], 'base64'));
    else {
      m = new Uint8Array(GLYPH_W * GLYPH_H);
      const a = Math.round(fallbackDensity * 255);
      // leave a 1px gutter so cells stay distinguishable
      for (let y = 2; y < GLYPH_H - 2; y++) for (let x = 1; x < GLYPH_W - 1; x++) m[y * GLYPH_W + x] = a;
    }
    glyphCache.set(key, m);
  }
  return m;
}

/** Rasterize character cells to an RGB24 image (cols*GLYPH_W × rows*GLYPH_H). */
export function rasterize(cells: Cells, charset: string[], bg: [number, number, number] = [0, 0, 0]): Buffer {
  const { cols, rows, chars, colors } = cells;
  const W = cols * GLYPH_W;
  const H = rows * GLYPH_H;
  const img = Buffer.alloc(W * H * 3);
  if (bg[0] || bg[1] || bg[2]) for (let i = 0; i < W * H; i++) img.set(bg, i * 3);
  const density = new Map(charset.map((c, i) => [c, i / (charset.length - 1)]));
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const i = cy * cols + cx;
      const ch = chars[i]!;
      if (ch === ' ') continue;
      const mask = glyphMask(ch, density.get(ch) ?? 1);
      const r = colors[i * 3]!;
      const g = colors[i * 3 + 1]!;
      const b = colors[i * 3 + 2]!;
      for (let gy = 0; gy < GLYPH_H; gy++) {
        let p = ((cy * GLYPH_H + gy) * W + cx * GLYPH_W) * 3;
        const row = gy * GLYPH_W;
        for (let gx = 0; gx < GLYPH_W; gx++, p += 3) {
          const a = mask[row + gx]!;
          if (a === 0) continue;
          if (a === 255) {
            img[p] = r;
            img[p + 1] = g;
            img[p + 2] = b;
          } else {
            img[p] = img[p]! + (((r - img[p]!) * a) / 255) | 0;
            img[p + 1] = img[p + 1]! + (((g - img[p + 1]!) * a) / 255) | 0;
            img[p + 2] = img[p + 2]! + (((b - img[p + 2]!) * a) / 255) | 0;
          }
        }
      }
    }
  }
  return img;
}

export interface ExportLayout {
  vertical: boolean;
  sideBySide: boolean;
}

/** Virtual "terminal" size used to pick the ASCII grid for export. */
export function exportGrid(layout: ExportLayout): { maxCols: number; maxRows: number } {
  // side-by-side (horizontal): ASCII gets half of a 1920-wide frame; the original is scaled to match its height.
  const tw = layout.vertical ? 1080 : layout.sideBySide ? 960 : 1920;
  const th = layout.vertical ? (layout.sideBySide ? 960 : 1920) : 1080;
  return { maxCols: Math.floor(tw / GLYPH_W), maxRows: Math.floor(th / GLYPH_H) };
}

/** Build the ffmpeg filter graph for the export layout. Pure, exported for tests. */
export function buildFilter(layout: ExportLayout, asciiW: number, asciiH: number, fps: number): string {
  const fit = (w: number, h: number) =>
    `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  const orig = `[1:v]fps=${fps},format=rgb24`;
  if (layout.sideBySide && layout.vertical) {
    // Reels: original on top, ASCII below, 1080×1920 total.
    return `${orig},${fit(1080, 960)}[o];[0:v]${fit(1080, 960)}[a];[o][a]vstack=inputs=2,format=yuv420p[v]`;
  }
  if (layout.sideBySide) {
    return `${orig},scale=-2:${asciiH}:flags=lanczos,setsar=1[o];[0:v]setsar=1[a];[o][a]hstack=inputs=2,format=yuv420p[v]`;
  }
  if (layout.vertical) return `[0:v]${fit(1080, 1920)},format=yuv420p[v]`;
  return `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p[v]`;
}

export function buildExportArgs(opts: {
  input: string;
  output: string;
  width: number;
  height: number;
  fps: number;
  layout: ExportLayout;
  hasAudio: boolean;
}): string[] {
  const { input, output, width, height, fps, layout, hasAudio } = opts;
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0',
    '-i', input,
    '-filter_complex', buildFilter(layout, width, height, fps),
    '-map', '[v]',
    ...(hasAudio ? ['-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k'] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-shortest',
    output,
  ];
}

/** Stream-encode rasterized frames to an mp4 with the original audio. */
export function createEncoder(args: string[]) {
  const proc = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));
  const closed = new Promise<number>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => resolve(code ?? 1));
  });
  proc.stdin.on('error', () => {
    /* surfaced via exit code */
  });
  return {
    async write(frame: Buffer) {
      if (!proc.stdin.write(frame)) await Promise.race([once(proc.stdin, 'drain'), closed]);
    },
    async finish() {
      proc.stdin.end();
      const code = await closed;
      if (code !== 0) throw new Error(`ffmpeg encode failed (${code}): ${stderr.trim()}`);
    },
  };
}
