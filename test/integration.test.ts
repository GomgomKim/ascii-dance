import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractFrames, ffmpegPath, probe } from '../src/ffmpeg.js';

// Sample video generated with ffmpeg's testsrc (+ sine audio).
let dir: string;
let sample: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ascii-dance-'));
  sample = join(dir, 'testsrc.mp4');
  const r = spawnSync(ffmpegPath(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=1',
    '-f', 'lavfi', '-i', 'sine=duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    sample,
  ]);
  if (r.status !== 0) throw new Error(`could not create sample: ${r.stderr}`);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('ffmpeg integration (testsrc)', () => {
  it('probes the sample', () => {
    const info = probe(sample);
    expect(info).toMatchObject({ width: 320, height: 180, fps: 10, hasAudio: true });
    expect(info.duration).toBeCloseTo(1, 1);
  });

  it('extracts frames at the requested size', async () => {
    const frames: Buffer[] = [];
    for await (const f of extractFrames(sample, 16, 5, 10)) frames.push(Buffer.from(f));
    expect(frames).toHaveLength(10);
    for (const f of frames) expect(f.length).toBe(16 * 5 * 3);
  });
});
