/**
 * Site / branding config. Edit here (or set VITE_* env vars on Vercel) — no code changes needed.
 */

/** Instagram Reels UI overlays, in px on a 1080×1920 frame. Keep important content inside. */
export const REELS_SAFE_AREA = {
  top: 220, // account name / "Reels" header
  bottom: 420, // caption, music, CTA
  left: 60,
  right: 120, // like / comment / share buttons
} as const;

export const WATERMARK = {
  /** Show the watermark in preview + export (users can toggle it off in the UI). */
  enabledByDefault: true,
  handle: import.meta.env.VITE_WATERMARK_HANDLE || '@gomgom_kim',
  siteUrl: import.meta.env.VITE_SITE_URL || 'ascii-dance.vercel.app',
  /** Distance between the watermark's last line and the bottom safe-area edge. */
  gapAboveSafeEdge: 24,
  handleFont: '700 40px "JetBrains Mono", ui-monospace, monospace',
  siteFont: '400 28px "JetBrains Mono", ui-monospace, monospace',
  lineGap: 10,
  color: 'rgba(255, 255, 255, 0.92)',
  shadow: 'rgba(0, 0, 0, 0.8)',
  /** Translucent pill behind the text; set to 'transparent' to disable. */
  backdrop: 'rgba(0, 0, 0, 0.55)',
  padding: { x: 28, y: 16, radius: 22 },
} as const;

export const EXPORT = {
  width: 1080,
  height: 1920,
  fps: 30,
  /** High bitrate keeps the thin glyph strokes crisp after Instagram re-encodes. */
  videoBitsPerSecond: 12_000_000,
  audioBitsPerSecond: 192_000,
  fileBaseName: 'ascii-dance',
} as const;
