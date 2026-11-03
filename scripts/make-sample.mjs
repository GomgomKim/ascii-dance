// Generate a sample video with ffmpeg's testsrc + a sine tone: samples/test.mp4
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
const out = process.argv[2] ?? 'samples/test.mp4';
const duration = process.argv[3] ?? '5';
mkdirSync(new URL('../samples', import.meta.url), { recursive: true });
const r = spawnSync(
  ffmpeg,
  [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=30:duration=${duration}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:beep_factor=4:duration=${duration}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    out,
  ],
  { stdio: 'inherit' },
);
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`wrote ${out}`);
