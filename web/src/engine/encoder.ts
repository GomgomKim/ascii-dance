/**
 * Offline export with WebCodecs (via mediabunny): decode every source frame, render it with the
 * same AsciiRenderer as the preview, and encode a real H.264/AAC mp4 — all in the browser.
 *
 * Unlike real-time recording this never drops frames on slow devices: a frame is only encoded
 * after it has been fully rendered, so export may run slower (or faster) than real time.
 */
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny';
import { EXPORT } from '../config';
import type { AsciiRenderer } from './renderer';
import { frameTimestamps, pickFps } from './timing';
import type { Settings } from './settings';

/** Thrown when this browser can't do the offline path; the caller falls back to MediaRecorder. */
export class OfflineUnsupported extends Error {}

export interface OfflineExportOptions {
  file: File;
  renderer: AsciiRenderer;
  settings: Settings;
  onProgress: (ratio: number) => void;
  signal: AbortSignal;
}

export function offlineExportAvailable(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
}

/** Which container the offline path will produce in this browser, or null if it can't be used. */
export async function offlineFormat(): Promise<'mp4' | 'webm' | null> {
  if (!offlineExportAvailable()) return null;
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'] as VideoCodec[], {
    width: EXPORT.width,
    height: EXPORT.height,
  });
  return codec === 'avc' ? 'mp4' : codec ? 'webm' : null;
}

export async function exportOffline(opts: OfflineExportOptions): Promise<{ blob: Blob; ext: string }> {
  const { file, renderer, settings, onProgress, signal } = opts;
  if (!offlineExportAvailable()) throw new OfflineUnsupported('WebCodecs not available');

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack || !(await videoTrack.canDecode())) throw new OfflineUnsupported('cannot decode video track');
    const audioTrack = await input.getPrimaryAudioTrack();
    const withAudio = !!audioTrack && (await audioTrack.canDecode());

    const { width, height } = { width: EXPORT.width, height: EXPORT.height };
    // Prefer H.264 + AAC in mp4: the most compatible combination for Instagram and phones.
    const videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'] as VideoCodec[], { width, height });
    if (!videoCodec) throw new OfflineUnsupported('no encodable video codec');
    const mp4 = videoCodec === 'avc';
    const audioCodec = withAudio
      ? await getFirstEncodableAudioCodec((mp4 ? ['aac', 'opus'] : ['opus', 'vorbis']) as AudioCodec[])
      : null;

    const duration = await input.computeDuration();
    const fps = pickFps((await videoTrack.computePacketStats(120)).averagePacketRate);

    const format = mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
    const target = new BufferTarget();
    const output = new Output({ format, target });
    const videoSource = new CanvasSource(renderer.canvas, {
      codec: videoCodec,
      bitrate: EXPORT.videoBitsPerSecond,
      keyFrameInterval: 2,
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: EXPORT.audioBitsPerSecond }) : null;
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();

    const abortIfNeeded = async () => {
      if (signal.aborted) {
        await output.cancel();
        throw new DOMException('cancelled', 'AbortError');
      }
    };

    const encodeVideo = async () => {
      const sink = new CanvasSink(videoTrack, { poolSize: 2 });
      const frameDur = 1 / fps;
      let i = 0;
      const total = Math.max(1, Math.round(duration * fps));
      for await (const frame of sink.canvasesAtTimestamps(frameTimestamps(duration, fps))) {
        await abortIfNeeded();
        if (frame) renderer.render(frame.canvas, frame.canvas.width, frame.canvas.height, settings);
        // A missing frame (before the first timestamp) re-encodes the previous canvas state.
        await videoSource.add(i * frameDur, frameDur);
        onProgress(++i / total);
      }
      videoSource.close();
    };

    const encodeAudio = async () => {
      if (!audioSource || !audioTrack) return;
      for await (const { buffer } of new AudioBufferSink(audioTrack).buffers(0, duration)) {
        await abortIfNeeded();
        await audioSource.add(buffer);
      }
      audioSource.close();
    };

    // Feed both tracks concurrently so the muxer can interleave them.
    await Promise.all([encodeVideo(), encodeAudio()]);
    await output.finalize();
    onProgress(1);
    return { blob: new Blob([target.buffer!], { type: format.mimeType }), ext: format.fileExtension.replace('.', '') };
  } finally {
    input.dispose();
  }
}
