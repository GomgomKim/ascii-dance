import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { CHARSETS, type CharsetName, type ColorMode } from '@core';
import { EXPORT, WATERMARK } from './config';
import { AsciiRenderer, charsetFor } from './engine/renderer';
import { AudioTap, pickMimeType, recordCanvas } from './engine/recorder';
import { CHARSET_LABELS, DEFAULT_SETTINGS, type Settings } from './engine/settings';

const MODES: { value: ColorMode; label: string }[] = [
  { value: 'mono', label: '모노' },
  { value: 'color', label: '컬러' },
  { value: 'matrix', label: '매트릭스' },
];

type ExportState =
  | { kind: 'idle' }
  | { kind: 'recording'; progress: number }
  | { kind: 'done'; url: string; name: string; size: number }
  | { kind: 'error'; message: string };

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AsciiRenderer | null>(null);
  const audioTap = useRef(new AudioTap());
  const abortRef = useRef<AbortController | null>(null);

  const [src, setSrc] = useState<{ url: string; name: string; file: File } | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [charsetError, setCharsetError] = useState<string | null>(null);
  const [stats, setStats] = useState({ cols: 0, rows: 0, ms: 0 });
  const [dragging, setDragging] = useState(false);
  const [exp, setExp] = useState<ExportState>({ kind: 'idle' });
  // Export format: WebCodecs offline encode when available, otherwise real-time MediaRecorder.
  const [format, setFormat] = useState<{ ext: string; offline: boolean } | null | undefined>(undefined);
  useEffect(() => {
    // mediabunny is large: load the offline encoder only when needed (after first paint).
    import('./engine/encoder')
      .then((m) => m.offlineFormat())
      .then((ext) => {
        if (ext) setFormat({ ext, offline: true });
        else {
          const rec = pickMimeType();
          setFormat(rec ? { ext: rec.ext, offline: false } : null);
        }
      })
      .catch(() => setFormat(null));
  }, []);
  const busy = exp.kind === 'recording';
  const exportingRef = useRef(false);
  exportingRef.current = busy;

  const draw = useCallback(() => {
    const video = videoRef.current;
    const r = rendererRef.current;
    if (!video || !r) return;
    try {
      r.render(video, video.videoWidth, video.videoHeight, settingsRef.current);
      setCharsetError(null);
    } catch (e) {
      setCharsetError((e as Error).message);
    }
    setStats((s) => (s.cols === r.grid.cols && s.rows === r.grid.rows && Math.abs(s.ms - r.lastMs) < 2 ? s : { ...r.grid, ms: r.lastMs }));
  }, []);

  // Create the renderer once; redraw when the brand font finishes loading.
  useEffect(() => {
    if (!canvasRef.current) return;
    rendererRef.current = new AsciiRenderer(canvasRef.current);
    draw();
    document.fonts?.load(WATERMARK.handleFont).then(draw, () => {});
    document.fonts?.load(WATERMARK.siteFont).then(draw, () => {});
  }, [draw]);

  // Live preview: redraw on every decoded video frame while playing.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let handle = 0;
    let playing = false;
    const loop = () => {
      if (!playing) return;
      // While exporting, the exporter owns the canvas.
      if (!exportingRef.current) draw();
      handle = 'requestVideoFrameCallback' in video ? video.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    };
    const onPlay = () => {
      playing = true;
      loop();
    };
    const onStop = () => {
      playing = false;
      if ('cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      draw();
    };
    // At 'loadeddata' Chrome may not have a paintable frame yet (drawImage gives black);
    // seeking to the start makes 'seeked' fire once the first frame is really available.
    const onLoaded = () => {
      draw();
      video.currentTime = 0;
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onStop);
    video.addEventListener('seeked', draw);
    video.addEventListener('loadeddata', onLoaded);
    return () => {
      onStop();
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onStop);
      video.removeEventListener('seeked', draw);
      video.removeEventListener('loadeddata', onLoaded);
    };
  }, [draw]);

  // Re-render the current frame whenever an option changes.
  useEffect(() => {
    if (!exportingRef.current) draw();
  }, [settings, draw]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = settings.loop;
  }, [settings.loop]);

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)) {
      setExp({ kind: 'error', message: '영상 파일을 올려주세요 (mp4, mov, webm 등).' });
      return;
    }
    if (src) URL.revokeObjectURL(src.url);
    if (exp.kind === 'done') URL.revokeObjectURL(exp.url);
    setExp({ kind: 'idle' });
    setSrc({ url: URL.createObjectURL(file), name: file.name, file });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    loadFile(e.dataTransfer.files[0]);
  };

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value }));

  const startExport = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!video || !canvas || !renderer || !src) return;
    if (exp.kind === 'done') URL.revokeObjectURL(exp.url);
    const ac = new AbortController();
    abortRef.current = ac;
    exportingRef.current = true;
    setExp({ kind: 'recording', progress: 0 });
    video.pause();
    const onProgress = (p: number) => setExp({ kind: 'recording', progress: p });
    try {
      let result: { blob: Blob; ext: string };
      const encoder = format?.offline ? await import('./engine/encoder') : null;
      try {
        if (!encoder) throw new Error('offline export not available');
        result = await encoder.exportOffline({ file: src.file, renderer, settings: settingsRef.current, onProgress, signal: ac.signal });
      } catch (e) {
        if (encoder && !(e instanceof encoder.OfflineUnsupported)) throw e;
        // Fallback: record the canvas in real time while the video plays once.
        result = await recordCanvas({ video, canvas, audio: audioTap.current.attach(video), draw, onProgress, signal: ac.signal });
      }
      const base = src.name.replace(/\.[^.]+$/, '');
      const name = `${EXPORT.fileBaseName}-${base}.${result.ext}`;
      const url = URL.createObjectURL(result.blob);
      setExp({ kind: 'done', url, name, size: result.blob.size });
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') setExp({ kind: 'idle' });
      else setExp({ kind: 'error', message: `내보내기 실패: ${(e as Error).message}` });
    } finally {
      abortRef.current = null;
      exportingRef.current = false;
      draw(); // restore the preview to the current video frame
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>
          <span className="logo">ascii-dance</span>
          <span className="cursor">_</span>
        </h1>
        <p>춤 영상을 ASCII 아트로. 릴스용 9:16 영상까지 브라우저에서 바로 만들어요.</p>
      </header>

      <main className="layout">
        <section className="panel controls" aria-label="설정">
          <label
            className={`drop ${dragging ? 'drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input type="file" accept="video/*" disabled={busy} onChange={(e) => loadFile(e.target.files?.[0])} />
            <strong>{src ? src.name : '영상 올리기'}</strong>
            <span>{src ? '다른 영상으로 바꾸려면 클릭하거나 끌어다 놓기' : '클릭하거나 파일을 끌어다 놓으세요'}</span>
            <small>🔒 영상은 서버로 업로드되지 않고 이 브라우저 안에서만 처리돼요</small>
          </label>

          <video
            ref={videoRef}
            className="source"
            src={src?.url}
            controls={!busy}
            playsInline
            loop={settings.loop}
            hidden={!src}
          />

          <fieldset disabled={busy}>
            <div className="field">
              <span className="label">문자셋</span>
              <select value={settings.charset} onChange={(e) => set('charset', e.target.value as Settings['charset'])}>
                {([...Object.keys(CHARSETS), 'custom'] as (CharsetName | 'custom')[]).map((k) => (
                  <option key={k} value={k}>
                    {CHARSET_LABELS[k]}
                  </option>
                ))}
              </select>
              {settings.charset === 'custom' && (
                <input
                  className="mono"
                  value={settings.customCharset}
                  onChange={(e) => set('customCharset', e.target.value)}
                  placeholder="어두운 → 밝은 순서, 예: ' .oO@'"
                  aria-label="커스텀 문자셋"
                />
              )}
              {charsetError && <span className="error">{charsetError}</span>}
            </div>

            <div className="field">
              <span className="label">색상</span>
              <div className="segmented" role="radiogroup">
                {MODES.map((m) => (
                  <button
                    type="button"
                    key={m.value}
                    role="radio"
                    aria-checked={settings.mode === m.value}
                    className={settings.mode === m.value ? 'on' : ''}
                    onClick={() => set('mode', m.value)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="label">레이아웃</span>
              <div className="segmented" role="radiogroup">
                {(
                  [
                    ['ascii', 'ASCII만'],
                    ['stack', '원본 + ASCII'],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    type="button"
                    key={v}
                    role="radio"
                    aria-checked={settings.layout === v}
                    className={settings.layout === v ? 'on' : ''}
                    onClick={() => set('layout', v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <Slider label="대비" value={settings.contrast} min={0.5} max={3} step={0.1} format={(v) => `×${v.toFixed(1)}`} onChange={(v) => set('contrast', v)} />
            <Slider
              label="배경 날리기"
              hint="이 밝기보다 어두운 부분은 비워요"
              value={settings.threshold}
              min={0}
              max={200}
              step={1}
              format={(v) => (v === 0 ? '끔' : String(v))}
              onChange={(v) => set('threshold', v)}
            />
            <Slider
              label="가로 문자 수"
              value={settings.width ?? 0}
              min={0}
              max={180}
              step={2}
              format={(v) => (v === 0 ? `자동 (${stats.cols || '–'})` : String(v))}
              onChange={(v) => set('width', v === 0 ? null : Math.max(10, v))}
            />

            <div className="toggles">
              <Toggle label="밝기 반전" hint="밝은 배경에서 찍은 영상" checked={settings.invert} onChange={(v) => set('invert', v)} />
              <Toggle label="반복 재생" checked={settings.loop} onChange={(v) => set('loop', v)} />
              <Toggle label="워터마크" hint={`${WATERMARK.handle} · ${WATERMARK.siteUrl}`} checked={settings.watermark} onChange={(v) => set('watermark', v)} />
            </div>

            <button type="button" className="reset" onClick={() => setSettings({ ...DEFAULT_SETTINGS, loop: settings.loop })}>
              설정 초기화
            </button>
          </fieldset>
        </section>

        <section className="panel stage" aria-label="미리보기">
          <div className="frame">
            <canvas ref={canvasRef} className="preview" aria-label="ASCII 미리보기 (9:16)" />
            {!src && <div className="empty">영상을 올리면 여기서 ASCII로 미리볼 수 있어요</div>}
          </div>
          <div className="meta mono">
            1080×1920 · {stats.cols}×{stats.rows} 문자 · {charsetFor(settings).length}단계 · {stats.ms.toFixed(1)}ms/frame
          </div>

          <div className="export">
            {busy ? (
              <>
                <div className="progress" role="progressbar" aria-valuenow={Math.round(exp.progress * 100)}>
                  <div style={{ width: `${exp.progress * 100}%` }} />
                </div>
                <div className="row">
                  <span>
                    {format?.offline ? '변환 중' : '녹화 중 (영상 길이만큼 걸려요)'}… {Math.round(exp.progress * 100)}%
                  </span>
                  <button type="button" className="ghost" onClick={() => abortRef.current?.abort()}>
                    취소
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="primary" disabled={!src || !format} onClick={startExport}>
                9:16 영상 다운로드 ({format === undefined ? '확인 중' : (format?.ext ?? '미지원')})
              </button>
            )}
            {exp.kind === 'done' && (
              <p className="note">
                ✅ 완료! 자동으로 받아지지 않았다면{' '}
                <a href={exp.url} download={exp.name}>
                  {exp.name}
                </a>{' '}
                ({(exp.size / 1024 / 1024).toFixed(1)}MB)
              </p>
            )}
            {exp.kind === 'error' && <p className="error">{exp.message}</p>}
            {format?.ext === 'webm' && (
              <p className="note">이 브라우저는 H.264 인코딩을 지원하지 않아 webm으로 저장돼요. 릴스용 mp4가 필요하면 최신 Chrome이나 Safari를 써주세요.</p>
            )}
            {format === null && <p className="error">이 브라우저는 영상 내보내기를 지원하지 않아요. 최신 Chrome / Safari / Edge를 사용해 주세요.</p>}
          </div>
        </section>
      </main>

      <footer className="footer">
        같은 변환 엔진을 쓰는 터미널 버전: <code>npx github:GomgomKim/ascii-dance ./dance.mp4</code>
      </footer>
    </div>
  );
}

function Slider(props: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span className="label">
        {props.label} <output className="mono">{props.format(props.value)}</output>
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}

function Toggle(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
      <span>
        {props.label}
        {props.hint && <small>{props.hint}</small>}
      </span>
    </label>
  );
}
