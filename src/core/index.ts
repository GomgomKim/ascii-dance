/**
 * ascii-dance core: the conversion logic shared by the CLI (Node) and the web app (browser).
 * Everything under src/core must stay free of Node APIs (no `node:*`, no Buffer) —
 * test/core.test.ts enforces this.
 */
export * from './ascii.js';
export * from './frame.js';
export * from './raster.js';
export * from './layout.js';
