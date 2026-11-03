import { EXPORT } from '../config';

/** Output fps: the source's average frame rate, clamped to something sensible for Reels. */
export function pickFps(sourceRate: number): number {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) return EXPORT.fps;
  return Math.min(60, Math.max(12, Math.round(sourceRate)));
}

/** Evenly spaced frame timestamps covering [0, duration). */
export function* frameTimestamps(duration: number, fps: number): Generator<number> {
  const n = Math.max(1, Math.round(duration * fps));
  for (let i = 0; i < n; i++) yield i / fps;
}
