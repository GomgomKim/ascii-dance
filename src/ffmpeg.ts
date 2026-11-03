import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Path to the bundled ffmpeg binary (ffmpeg-static), falling back to `ffmpeg` on PATH. */
export function ffmpegPath(): string {
  try {
    const p = require('ffmpeg-static') as string | null;
    if (p && existsSync(p)) return p;
  } catch {
    /* fall through */
  }
  return 'ffmpeg';
}

/** Whether a command exists on PATH (used for optional ffplay). */
export function hasCommand(cmd: string): boolean {
  const r = spawnSync(cmd, ['-version'], { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

export interface VideoInfo {
  /** Display width/height (after rotation metadata is applied). */
  width: number;
  height: number;
  fps: number;
  /** Seconds; 0 if unknown. */
  duration: number;
  hasAudio: boolean;
}

/** Parse `ffmpeg -i` stderr output. Pure, exported for tests. */
export function parseProbe(stderr: string): VideoInfo {
  const videoLine = stderr.split('\n').find((l) => /Stream #\d+:\d+.*: Video:/.test(l));
  if (!videoLine) throw new Error('no video stream found');
  const dims = videoLine.match(/,\s*(\d{2,5})x(\d{2,5})/);
  if (!dims) throw new Error('could not read video dimensions');
  let width = Number(dims[1]);
  let height = Number(dims[2]);

  const fpsMatch = videoLine.match(/([\d.]+)\s*fps/) ?? videoLine.match(/([\d.]+)k?\s*tbr/);
  let fps = fpsMatch ? Number(fpsMatch[1]) : 30;
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) fps = 30;

  // Phone videos are often stored landscape with rotation metadata; ffmpeg auto-rotates on decode.
  const rot = stderr.match(/rotation of (-?[\d.]+) degrees/) ?? stderr.match(/rotate\s*:\s*(-?\d+)/);
  if (rot && Math.abs(Math.round(Number(rot[1]))) % 180 === 90) [width, height] = [height, width];

  const dur = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const duration = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;

  const hasAudio = /Stream #\d+:\d+.*: Audio:/.test(stderr);
  return { width, height, fps, duration, hasAudio };
}

export function probe(file: string): VideoInfo {
  if (!existsSync(file)) throw new Error(`file not found: ${file}`);
  // ffmpeg exits non-zero when no output is given; we only need the stderr banner.
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-i', file], { encoding: 'utf8' });
  if (r.error) throw r.error;
  return parseProbe(r.stderr);
}

/**
 * Decode a video into raw RGB frames scaled to cols×rows.
 * Yields one Buffer (cols*rows*3 bytes) per frame, at a constant `fps`.
 */
export async function* extractFrames(file: string, cols: number, rows: number, fps: number): AsyncGenerator<Buffer> {
  const frameSize = cols * rows * 3;
  const proc = spawn(
    ffmpegPath(),
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', file,
      '-an',
      '-vf', `fps=${fps},scale=${cols}:${rows}:flags=area,format=rgb24`,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? 0)));

  let pending: Buffer[] = [];
  let pendingLen = 0;
  try {
    for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
      pending.push(chunk);
      pendingLen += chunk.length;
      if (pendingLen < frameSize) continue;
      let buf = Buffer.concat(pending, pendingLen);
      let off = 0;
      while (buf.length - off >= frameSize) {
        yield buf.subarray(off, off + frameSize);
        off += frameSize;
      }
      buf = buf.subarray(off);
      pending = buf.length ? [Buffer.from(buf)] : [];
      pendingLen = buf.length;
    }
  } finally {
    if (proc.exitCode === null) proc.kill('SIGKILL');
  }
  const code = await exited;
  if (code !== 0 && proc.signalCode === null) throw new Error(`ffmpeg failed (${code}): ${stderr.trim()}`);
}
