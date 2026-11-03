/**
 * Browser renderer: video frame → (shared core) ASCII cells → bitmap glyphs → 9:16 canvas.
 * The same draw is used for the live preview and the recorded export, so what you see is what you get.
 */
import {
  asciiBox,
  computeSize,
  exportGrid,
  fitRect,
  frameToCells,
  rasterizeInto,
  rasterSize,
  resolveCharset,
  type Rect,
} from '@core';
import { EXPORT, REELS_SAFE_AREA, WATERMARK } from '../config';
import type { Settings } from './settings';

export function charsetFor(s: Settings): string[] {
  return resolveCharset(s.charset === 'custom' ? s.customCharset : s.charset);
}

/** Where the watermark lines go: centered horizontally, just above the bottom safe-area edge. */
export function watermarkPosition(canvasW: number, canvasH: number) {
  const safeLeft = REELS_SAFE_AREA.left;
  const safeRight = canvasW - REELS_SAFE_AREA.right;
  const bottom = canvasH - REELS_SAFE_AREA.bottom - WATERMARK.gapAboveSafeEdge;
  const centerX = canvasW / 2;
  // Text is centered, so it may only be as wide as the narrower side of the safe band allows.
  const maxWidth = 2 * Math.min(centerX - safeLeft, safeRight - centerX);
  return { centerX, maxWidth, bottom };
}

export class AsciiRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sample = document.createElement('canvas');
  private sampleCtx = this.sample.getContext('2d', { willReadFrequently: true })!;
  private ascii = document.createElement('canvas');
  private asciiCtx = this.ascii.getContext('2d')!;
  private image: ImageData | null = null;
  /** Last frame's grid, for the UI. */
  grid = { cols: 0, rows: 0 };
  /** Last frame's render time in ms, for the UI. */
  lastMs = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = EXPORT.width;
    canvas.height = EXPORT.height;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  /** Render one frame. `source` is a <video> (live preview) or a decoded frame canvas (export). */
  render(source: CanvasImageSource, vw: number, vh: number, s: Settings): void {
    const t0 = performance.now();
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    if (vw && vh) {
      const layout = { vertical: true, sideBySide: s.layout === 'stack' };
      const { cols, rows } = computeSize(vw, vh, { ...exportGrid(layout), width: s.width ?? undefined });
      this.grid = { cols, rows };

      // 1) Downsample the frame to one pixel per character cell.
      if (this.sample.width !== cols || this.sample.height !== rows) {
        this.sample.width = cols;
        this.sample.height = rows;
      }
      this.sampleCtx.imageSmoothingEnabled = true;
      this.sampleCtx.imageSmoothingQuality = 'high';
      this.sampleCtx.drawImage(source, 0, 0, cols, rows);
      const px = this.sampleCtx.getImageData(0, 0, cols, rows).data;

      // 2) Shared core: brightness → characters/colors → glyph bitmap (identical to the CLI export).
      const charset = charsetFor(s);
      const cells = frameToCells(px, cols, rows, {
        charset,
        mode: s.mode,
        invert: s.invert,
        contrast: s.contrast,
        threshold: s.threshold || undefined,
      }, 4);
      const { width: aw, height: ah } = rasterSize(cols, rows);
      if (!this.image || this.image.width !== aw || this.image.height !== ah) {
        this.ascii.width = aw;
        this.ascii.height = ah;
        this.image = this.asciiCtx.createImageData(aw, ah);
      }
      rasterizeInto(this.image.data, cells, charset, { channels: 4 });
      this.asciiCtx.putImageData(this.image, 0, 0);

      // 3) Compose the 9:16 frame.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const box = asciiBox(layout);
      if (layout.sideBySide) {
        const top: Rect = { x: 0, y: 0, width: W, height: H / 2 };
        const o = fitRect(vw, vh, top);
        ctx.drawImage(source, o.x, o.y, o.width, o.height);
        const a = fitRect(aw, ah, { x: 0, y: H / 2, width: box.width, height: box.height });
        ctx.drawImage(this.ascii, a.x, a.y, a.width, a.height);
      } else {
        const a = fitRect(aw, ah, { x: 0, y: 0, width: box.width, height: box.height });
        ctx.drawImage(this.ascii, a.x, a.y, a.width, a.height);
      }
    }

    if (s.watermark) this.drawWatermark();
    this.lastMs = performance.now() - t0;
  }

  private drawWatermark(): void {
    const { ctx, canvas } = this;
    const { centerX, maxWidth, bottom } = watermarkPosition(canvas.width, canvas.height);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.font = WATERMARK.siteFont;
    const site = ctx.measureText(WATERMARK.siteUrl);
    ctx.font = WATERMARK.handleFont;
    const handle = ctx.measureText(WATERMARK.handle);
    const siteAscent = site.actualBoundingBoxAscent || 22;
    const handleBaseline = bottom - siteAscent - WATERMARK.lineGap;

    // Translucent pill behind the text so it stays readable over busy ASCII.
    const padX = WATERMARK.padding.x;
    const padY = WATERMARK.padding.y;
    const textW = Math.min(maxWidth, Math.max(site.width, handle.width));
    const top = handleBaseline - (handle.actualBoundingBoxAscent || 30) - padY;
    const boxBottom = bottom + (site.actualBoundingBoxDescent || 6) + padY;
    ctx.fillStyle = WATERMARK.backdrop;
    ctx.beginPath();
    ctx.roundRect(centerX - textW / 2 - padX, top, textW + padX * 2, boxBottom - top, WATERMARK.padding.radius);
    ctx.fill();

    ctx.fillStyle = WATERMARK.color;
    ctx.shadowColor = WATERMARK.shadow;
    ctx.shadowBlur = 8;
    ctx.fillText(WATERMARK.handle, centerX, handleBaseline, maxWidth);
    ctx.font = WATERMARK.siteFont;
    ctx.fillText(WATERMARK.siteUrl, centerX, bottom, maxWidth);
    ctx.restore();
  }
}
