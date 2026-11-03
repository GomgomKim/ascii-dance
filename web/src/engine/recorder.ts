/**
 * Records the rendered 9:16 canvas + the video's audio with MediaRecorder — entirely in the browser.
 * mp4 (H.264/AAC) when the browser can record it (Chrome 126+, Safari), otherwise webm.
 */
import { EXPORT } from '../config';

// Only an explicit H.264 mp4 counts as "mp4"; a bare 'video/mp4' may hold VP9 (e.g. Chromium
// builds without H.264), which Instagram handles poorly — so it ranks below webm.
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.4d0028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

export function pickMimeType(): { mimeType: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, ext: m.startsWith('video/mp4') ? 'mp4' : 'webm' };
  }
  return null;
}

/**
 * Routes a <video>'s audio through Web Audio so it can be both heard and recorded.
 * createMediaElementSource() may only be called once per element, so this is cached.
 */
export class AudioTap {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private el: HTMLVideoElement | null = null;

  attach(video: HTMLVideoElement): MediaStreamTrack | null {
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.el !== video) {
        const src = this.ctx.createMediaElementSource(video);
        this.dest = this.ctx.createMediaStreamDestination();
        src.connect(this.ctx.destination);
        src.connect(this.dest);
        this.el = video;
      }
      void this.ctx.resume();
      return this.dest!.stream.getAudioTracks()[0] ?? null;
    } catch {
      return null; // no audio: export video only
    }
  }
}

export interface RecordOptions {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  audio: MediaStreamTrack | null;
  /** Draw the current video frame onto the canvas. */
  draw: () => void;
  onProgress: (ratio: number) => void;
  signal: AbortSignal;
}

/** Plays the video once from the start in real time while recording the canvas. */
export async function recordCanvas(opts: RecordOptions): Promise<{ blob: Blob; ext: string }> {
  const { video, canvas, audio, draw, onProgress, signal } = opts;
  const type = pickMimeType();
  if (!type) throw new Error('이 브라우저는 영상 녹화(MediaRecorder)를 지원하지 않아요. 최신 Chrome / Safari를 사용해 주세요.');

  const stream = canvas.captureStream(EXPORT.fps);
  if (audio) stream.addTrack(audio);
  const recorder = new MediaRecorder(stream, {
    mimeType: type.mimeType,
    videoBitsPerSecond: EXPORT.videoBitsPerSecond,
    audioBitsPerSecond: EXPORT.audioBitsPerSecond,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

  const wasLoop = video.loop;
  video.loop = false;
  video.pause();
  video.currentTime = 0;
  await new Promise<void>((r) => video.addEventListener('seeked', () => r(), { once: true }));
  draw();

  let running = true;
  const tick = () => {
    if (!running) return;
    draw();
    onProgress(video.duration ? video.currentTime / video.duration : 0);
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(tick);
    else requestAnimationFrame(tick);
  };

  try {
    recorder.start(1000);
    const ended = new Promise<void>((resolve, reject) => {
      video.addEventListener('ended', () => resolve(), { once: true });
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    });
    await video.play();
    tick();
    await ended;
    draw();
    onProgress(1);
  } finally {
    running = false;
    video.pause();
    video.loop = wasLoop;
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    stream.getVideoTracks().forEach((t) => t.stop());
  }
  return { blob: new Blob(chunks, { type: type.mimeType.split(';')[0] }), ext: type.ext };
}
