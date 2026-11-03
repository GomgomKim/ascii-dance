/** Pure: build a progress bar string. */
export function progressBar(done: number, total: number, width = 30): string {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const filled = Math.round(ratio * width);
  const pct = String(Math.round(ratio * 100)).padStart(3);
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${pct}% ${done}/${total || '?'}`;
}

/** Throttled progress line on stderr. */
export function createProgress(label: string, total: number) {
  let last = 0;
  const tty = process.stderr.isTTY;
  return {
    update(done: number) {
      const now = Date.now();
      if (now - last < 50 && done !== total) return;
      last = now;
      if (tty) process.stderr.write(`\r\x1b[2K${label} ${progressBar(done, total)}`);
    },
    done(done: number) {
      if (tty) process.stderr.write(`\r\x1b[2K${label} ${progressBar(done, Math.max(total, done))}\n`);
      else process.stderr.write(`${label} done (${done} frames)\n`);
    },
  };
}
