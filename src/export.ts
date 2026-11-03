import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ffmpegPath } from './ffmpeg.js';
import type { ExportLayout } from './core/index.js';

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
    async write(frame: Uint8Array) {
      if (!proc.stdin.write(frame)) await Promise.race([once(proc.stdin, 'drain'), closed]);
    },
    async finish() {
      proc.stdin.end();
      const code = await closed;
      if (code !== 0) throw new Error(`ffmpeg encode failed (${code}): ${stderr.trim()}`);
    },
  };
}
