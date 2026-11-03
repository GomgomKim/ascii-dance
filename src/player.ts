import { spawn, type ChildProcess } from 'node:child_process';
import { composeScreen } from './frame.js';

export interface PlayOptions {
  fps: number;
  loop: boolean;
  /** Play this file's audio through ffplay and sync video to its clock. */
  audioFile?: string;
  /** Paint the whole screen black (matrix theme). */
  blackBackground: boolean;
}

const ESC = '\x1b';
const ALT_SCREEN_ON = `${ESC}[?1049h`;
const ALT_SCREEN_OFF = `${ESC}[?1049l`;
const CURSOR_HIDE = `${ESC}[?25l`;
const CURSOR_SHOW = `${ESC}[?25h`;
const CLEAR = `${ESC}[2J`;
const RESET = `${ESC}[0m`;
// Synchronized output (DEC mode 2026): terminals that support it paint the frame atomically → no tearing.
const SYNC_START = `${ESC}[?2026h`;
const SYNC_END = `${ESC}[?2026l`;

/**
 * Audio clock backed by ffplay's `-stats` status line, which reports the
 * playback position (master clock) ~every 30ms on stderr.
 */
class AudioClock {
  private proc: ChildProcess;
  private pos = NaN;
  private stamp = 0;
  private startedAt = performance.now();
  ended = false;

  constructor(file: string) {
    this.proc = spawn('ffplay', ['-nodisp', '-autoexit', '-vn', '-loglevel', 'quiet', '-stats', file], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let buf = '';
    this.proc.stderr!.setEncoding('utf8');
    this.proc.stderr!.on('data', (d: string) => {
      buf += d;
      const parts = buf.split(/[\r\n]/);
      buf = parts.pop() ?? '';
      for (const p of parts) {
        const m = p.match(/^\s*(-?\d+(?:\.\d+)?)\s+[AM]-[AV]/);
        if (m) {
          this.pos = Math.max(0, Number(m[1]));
          this.stamp = performance.now();
        }
      }
    });
    this.proc.on('exit', () => (this.ended = true));
    this.proc.on('error', () => (this.ended = true));
  }

  /** Current playback time in seconds; null while audio hasn't started yet. */
  now(): number | null {
    if (Number.isNaN(this.pos)) {
      // If ffplay never reports (e.g. no audio device), fall back to wall clock after 2s.
      const waited = (performance.now() - this.startedAt) / 1000;
      return waited > 2 ? waited - 2 : null;
    }
    return this.pos + (performance.now() - this.stamp) / 1000;
  }

  stop() {
    if (this.proc.exitCode === null) this.proc.kill('SIGTERM');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Play pre-rendered frames (arrays of ANSI lines) in the terminal. Resolves when done or quit. */
export async function play(frames: string[][], opts: PlayOptions): Promise<void> {
  const out = process.stdout;
  const frameRows = frames[0]?.length ?? 0;
  const frameCols = visibleWidth(frames[0]?.[0] ?? '');
  let quit = false;
  let audio: AudioClock | null = null;

  const bg = opts.blackBackground ? `${ESC}[48;2;0;0;0m` : '';
  const clearScreen = () => out.write(`${RESET}${bg}${CLEAR}`);

  const cleanup = () => {
    audio?.stop();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    out.write(`${RESET}${CURSOR_SHOW}${ALT_SCREEN_OFF}`);
  };
  const onKey = (d: Buffer) => {
    const k = d.toString();
    if (k === 'q' || k === 'Q' || k === '\x03' || k === '\x1b') quit = true;
  };
  const onSignal = () => (quit = true);
  const onResize = () => clearScreen();

  out.write(`${ALT_SCREEN_ON}${CURSOR_HIDE}`);
  clearScreen();
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onKey);
  }
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('SIGHUP', onSignal);
  out.on('resize', onResize);

  try {
    do {
      audio = opts.audioFile ? new AudioClock(opts.audioFile) : null;
      const t0 = performance.now();
      const clock = () => (audio ? audio.now() : (performance.now() - t0) / 1000);
      let lastIdx = -1;
      while (!quit) {
        const t = clock();
        if (t === null) {
          await sleep(5);
          continue;
        }
        const idx = Math.floor(t * opts.fps);
        if (idx >= frames.length) break;
        if (idx !== lastIdx) {
          // Center the frame; recomputed every frame so terminal resizes are handled.
          const offX = Math.max(0, Math.floor(((out.columns ?? frameCols) - frameCols) / 2));
          const offY = Math.max(0, Math.floor(((out.rows ?? frameRows) - frameRows) / 2));
          const ok = out.write(SYNC_START + bg + composeScreen(frames[idx]!, offX, offY) + SYNC_END);
          lastIdx = idx;
          // Slow terminal: wait for it to drain; the clock skips frames to stay in sync.
          if (!ok) await new Promise((r) => out.once('drain', r));
        }
        const t2 = clock() ?? t;
        const next = (Math.floor(t2 * opts.fps) + 1) / opts.fps;
        await sleep(Math.max(1, (next - t2) * 1000));
      }
      audio?.stop();
      audio = null;
    } while (opts.loop && !quit);
  } finally {
    process.stdin.off('data', onKey);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('SIGHUP', onSignal);
    out.off('resize', onResize);
    cleanup();
  }
}

/** Width of a line ignoring ANSI escapes (counts code points). */
export function visibleWidth(line: string): number {
  return Array.from(line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')).length;
}
