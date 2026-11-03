#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { CHARSETS, computeSize, resolveCharset, type ColorMode } from './ascii.js';
import { extractFrames, hasCommand, probe } from './ffmpeg.js';
import { cellsToAnsiLines, frameToCells, type RenderOptions } from './frame.js';
import { buildExportArgs, createEncoder, exportGrid, GLYPH_H, GLYPH_W, rasterize } from './export.js';
import { play } from './player.js';
import { createProgress } from './progress.js';

const HELP = `ascii-dance — 춤 영상을 ASCII 아트로 터미널에서 재생

Usage:
  ascii-dance <video> [options]

Playback:
  --color              truecolor로 원본 색 살리기
  --matrix             초록 매트릭스 테마
  --charset <set>      문자셋: ${Object.keys(CHARSETS).join(' | ')} | 커스텀 문자열 (어두운 → 밝은 순)
  --invert             밝기 반전 (밝은 배경 영상일 때)
  --contrast <n>       대비 배수 (기본 1, 예: 1.5)
  --threshold <0-255>  이 밝기 미만은 공백으로 → 배경 날리기
  --width <n>          가로 문자 수 직접 지정 (기본: 터미널에 맞춤)
  --loop               반복 재생
  --audio              ffplay로 음악 같이 재생 (오디오 시계에 싱크)

Export (촬영용):
  --export <out.mp4>   ASCII 렌더링을 영상으로 저장 (원본 오디오 포함)
  --vertical           9:16 세로 (1080×1920) 레이아웃
  --side-by-side       원본 | ASCII 나란히 (--vertical과 함께면 위/아래)

  -h, --help           도움말
  -v, --version        버전

Keys: q / Esc / Ctrl+C 종료
`;

function fail(msg: string): never {
  process.stderr.write(`ascii-dance: ${msg}\n`);
  process.exit(1);
}

function num(name: string, v: string | undefined, min: number, max: number): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) fail(`--${name} must be a number between ${min} and ${max} (got ${v})`);
  return n;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      color: { type: 'boolean' },
      matrix: { type: 'boolean' },
      charset: { type: 'string' },
      invert: { type: 'boolean' },
      contrast: { type: 'string' },
      threshold: { type: 'string' },
      width: { type: 'string' },
      loop: { type: 'boolean' },
      audio: { type: 'boolean' },
      export: { type: 'string' },
      vertical: { type: 'boolean' },
      'side-by-side': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.help) return void process.stdout.write(HELP);
  if (values.version) {
    const { createRequire } = await import('node:module');
    const pkg = createRequire(import.meta.url)('../package.json') as { version: string };
    return void process.stdout.write(`${pkg.version}\n`);
  }
  const input = positionals[0];
  if (!input) {
    process.stderr.write(HELP);
    process.exit(1);
  }
  if (!existsSync(input)) fail(`file not found: ${input}`);
  if (values.color && values.matrix) fail('--color and --matrix cannot be used together');
  if ((values.vertical || values['side-by-side']) && !values.export) fail('--vertical / --side-by-side require --export <out.mp4>');

  let charset: string[];
  try {
    charset = resolveCharset(values.charset);
  } catch (e) {
    fail((e as Error).message);
  }
  const mode: ColorMode = values.matrix ? 'matrix' : values.color ? 'color' : 'mono';
  const renderOpts: RenderOptions = {
    charset,
    mode,
    invert: values.invert,
    contrast: num('contrast', values.contrast, 0, 10),
    threshold: num('threshold', values.threshold, 0, 255),
  };
  const width = num('width', values.width, 1, 1000);

  let info;
  try {
    info = probe(input);
  } catch (e) {
    fail(`could not read video: ${(e as Error).message}`);
  }
  const totalFrames = Math.round(info.duration * info.fps);

  if (values.export) {
    const layout = { vertical: !!values.vertical, sideBySide: !!values['side-by-side'] };
    const { cols, rows } = computeSize(info.width, info.height, { ...exportGrid(layout), width });
    const W = cols * GLYPH_W;
    const H = rows * GLYPH_H;
    const enc = createEncoder(
      buildExportArgs({ input, output: values.export, width: W, height: H, fps: info.fps, layout, hasAudio: info.hasAudio }),
    );
    const progress = createProgress(`exporting ${cols}×${rows}`, totalFrames);
    let n = 0;
    for await (const rgb of extractFrames(input, cols, rows, info.fps)) {
      await enc.write(rasterize(frameToCells(rgb, cols, rows, renderOpts), charset));
      progress.update(++n);
    }
    await enc.finish();
    progress.done(n);
    process.stderr.write(`saved → ${values.export}\n`);
    return;
  }

  if (!process.stdout.isTTY) fail('stdout is not a terminal (use --export to render to a file)');
  const termCols = process.stdout.columns ?? 80;
  const termRows = (process.stdout.rows ?? 24) - 1;
  const { cols, rows } = computeSize(info.width, info.height, { maxCols: termCols, maxRows: termRows, width });
  if (cols > termCols || rows > termRows + 1) {
    process.stderr.write(`warning: ${cols}×${rows} is larger than the terminal (${termCols}×${termRows + 1}); output may wrap\n`);
  }

  let audioFile: string | undefined;
  if (values.audio) {
    if (!info.hasAudio) process.stderr.write('warning: video has no audio track, --audio ignored\n');
    else if (!hasCommand('ffplay')) process.stderr.write('warning: ffplay not found on PATH, playing without audio\n');
    else audioFile = input;
  }

  // Convert everything up front so playback never stalls on decoding.
  const progress = createProgress(`converting ${cols}×${rows}`, totalFrames);
  const frames: string[][] = [];
  for await (const rgb of extractFrames(input, cols, rows, info.fps)) {
    frames.push(cellsToAnsiLines(frameToCells(rgb, cols, rows, renderOpts), mode));
    progress.update(frames.length);
  }
  progress.done(frames.length);
  if (frames.length === 0) fail('no frames decoded');

  await play(frames, { fps: info.fps, loop: !!values.loop, audioFile, blackBackground: mode === 'matrix' });
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
