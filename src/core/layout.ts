/**
 * Output layout math shared by the CLI export (ffmpeg) and the web export (canvas).
 */
import { GLYPH_H, GLYPH_W } from './font-data.js';

export interface ExportLayout {
  /** 9:16 (1080×1920) output. */
  vertical: boolean;
  /** Original + ASCII together (top/bottom when vertical, left/right otherwise). */
  sideBySide: boolean;
}

export const VERTICAL_W = 1080;
export const VERTICAL_H = 1920;

/** The pixel box the ASCII image should fit in for a layout. */
export function asciiBox(layout: ExportLayout): { width: number; height: number } {
  if (layout.vertical) return { width: VERTICAL_W, height: layout.sideBySide ? VERTICAL_H / 2 : VERTICAL_H };
  // side-by-side (horizontal): ASCII gets half of a 1920-wide frame; the original is scaled to match its height.
  return { width: layout.sideBySide ? 960 : 1920, height: 1080 };
}

/** Virtual "terminal" size used to pick the ASCII grid for export. */
export function exportGrid(layout: ExportLayout): { maxCols: number; maxRows: number } {
  const box = asciiBox(layout);
  return { maxCols: Math.floor(box.width / GLYPH_W), maxRows: Math.floor(box.height / GLYPH_H) };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Scale (w×h) to fit inside the box, preserving aspect ratio, centered (like object-fit: contain). */
export function fitRect(w: number, h: number, box: Rect): Rect {
  if (w <= 0 || h <= 0) return { x: box.x, y: box.y, width: 0, height: 0 };
  const s = Math.min(box.width / w, box.height / h);
  const width = Math.round(w * s);
  const height = Math.round(h * s);
  return {
    x: box.x + Math.round((box.width - width) / 2),
    y: box.y + Math.round((box.height - height) / 2),
    width,
    height,
  };
}
