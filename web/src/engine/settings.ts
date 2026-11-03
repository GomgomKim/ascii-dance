import { CHARSETS, type CharsetName, type ColorMode } from '@core';
import { WATERMARK } from '../config';

/** Mirrors the CLI options (see README "옵션"). */
export interface Settings {
  /** Preset name, or 'custom' to use `customCharset`. */
  charset: CharsetName | 'custom';
  customCharset: string;
  mode: ColorMode;
  invert: boolean;
  contrast: number;
  /** 0 = off. */
  threshold: number;
  /** Columns; null = auto-fit (same as the CLI without --width). */
  width: number | null;
  /** 'ascii' = ASCII only, 'stack' = original on top / ASCII below (CLI --side-by-side --vertical). */
  layout: 'ascii' | 'stack';
  watermark: boolean;
  loop: boolean;
}

export const CHARSET_LABELS: Record<CharsetName | 'custom', string> = {
  standard: `기본  ${CHARSETS.standard.trim()}`,
  detailed: '디테일 (70단계)',
  blocks: `블록  ${CHARSETS.blocks.trim()}`,
  code: `코드  ${CHARSETS.code.trim()}`,
  custom: '커스텀 문자열',
};

export const DEFAULT_SETTINGS: Settings = {
  charset: 'standard',
  customCharset: ' .oO@',
  mode: 'mono',
  invert: false,
  contrast: 1,
  threshold: 0,
  width: null,
  layout: 'ascii',
  watermark: WATERMARK.enabledByDefault,
  loop: true,
};
