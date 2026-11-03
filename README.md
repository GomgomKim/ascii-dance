# ascii-dance 💃

춤 영상을 ASCII 아트로 바꿔서 터미널에서 재생하는 CLI.
인스타 릴스 촬영용이라 **화면에서 예쁘게 보이는 것**에 집중했습니다. 터미널을 그대로 찍어도 되고, `--export`로 바로 9:16 영상으로 뽑을 수도 있습니다.

- ffmpeg 따로 설치할 필요 없음 (`ffmpeg-static` 내장)
- 터미널 크기에 자동 맞춤 + 세로로 길쭉한 글자 비율 보정
- 전체 프레임을 먼저 변환해두고 재생 → 렉 없음
- ANSI 커서 이동 + synchronized output으로 깜빡임/찢어짐 없이 덮어쓰기
- 폰으로 찍은 세로 영상(회전 메타데이터)도 올바른 방향으로 재생
- **웹 버전**도 있어요: 브라우저에 영상을 올리면 바로 ASCII 미리보기 + 9:16 mp4 다운로드 ([아래](#웹-버전))

## 설치 / 실행

Node.js 18.17 이상이 필요합니다.

```bash
# 설치 없이 GitHub에서 바로 실행 (첫 실행 때 자동으로 빌드됨)
npx github:GomgomKim/ascii-dance ./dance.mp4 [옵션]

# 또는 clone 해서 실행
git clone https://github.com/GomgomKim/ascii-dance.git
cd ascii-dance
npm install          # 설치 시 자동으로 빌드됨 (prepare)
node dist/cli.js ./dance.mp4

# 전역 명령으로 등록
npm link
ascii-dance ./dance.mp4
```

> npm 레지스트리의 `ascii-dance`는 이름이 같은 **다른 사람의 패키지**입니다. `npx ascii-dance`로 실행하지 마세요.

재생 중 `q`, `Esc`, `Ctrl+C`로 종료합니다.

샘플 영상이 필요하면 ffmpeg `testsrc`로 만들 수 있습니다:

```bash
npm run sample             # → samples/test.mp4 (5초, 테스트 패턴 + 비프음)
node dist/cli.js samples/test.mp4
```

## 옵션

| 옵션 | 설명 |
| --- | --- |
| `--color` | truecolor ANSI로 원본 색 살리기 |
| `--matrix` | 초록 매트릭스 테마 (배경도 검정으로 칠함) |
| `--charset <set>` | `standard`(기본) · `detailed` · `blocks`(` ░▒▓█`) · `code`(`{}[]();=` 느낌) · 또는 커스텀 문자열 |
| `--invert` | 밝기 반전 (밝은 배경에서 찍은 영상) |
| `--contrast <n>` | 대비 배수 (기본 `1`, 추천 `1.3`~`2`) |
| `--threshold <0-255>` | 이 밝기 미만은 공백 처리 → 배경 날리고 사람만 남기기 |
| `--width <n>` | 가로 문자 수 직접 지정 (기본: 터미널 크기에 맞춤) |
| `--loop` | 반복 재생 |
| `--audio` | `ffplay`가 있으면 음악 같이 재생. 비디오가 ffplay의 오디오 시계를 따라가서 싱크가 맞음 |
| `--export <out.mp4>` | ASCII 렌더링을 영상 파일로 저장 (원본 오디오 포함) |
| `--vertical` | export를 9:16 (1080×1920) 세로로 |
| `--side-by-side` | 원본과 ASCII를 나란히 (`--vertical`과 같이 쓰면 위: 원본 / 아래: ASCII) |

### 예시

```bash
# 기본
ascii-dance dance.mp4

# 원본 색 + 반복 + 음악
ascii-dance dance.mp4 --color --loop --audio

# 블록 문자로 묵직하게
ascii-dance dance.mp4 --charset blocks --color

# 코드 느낌
ascii-dance dance.mp4 --charset code --matrix

# 커스텀 문자셋 (어두운 → 밝은 순서, 첫 글자는 보통 공백)
ascii-dance dance.mp4 --charset " .oO@"

# 하얀 벽 앞에서 찍은 영상: 반전 후 배경 날리기
ascii-dance dance.mp4 --invert --contrast 1.6 --threshold 70

# 어두운 연습실 영상: 대비 올리고 배경 날리기
ascii-dance dance.mp4 --contrast 1.8 --threshold 50 --color

# 가로 120자로 고정
ascii-dance dance.mp4 --width 120

# 매트릭스 무드
ascii-dance dance.mp4 --matrix --audio --loop
```

### 릴스용 영상 export

```bash
# 9:16 세로 ASCII 영상 (원본 오디오 포함)
ascii-dance dance.mp4 --export reel.mp4 --vertical --color

# 비교 컷: 위 원본 / 아래 ASCII (9:16)
ascii-dance dance.mp4 --export compare.mp4 --vertical --side-by-side --color

# 가로 비교 컷: 왼쪽 원본 / 오른쪽 ASCII
ascii-dance dance.mp4 --export compare-wide.mp4 --side-by-side --charset blocks

# 매트릭스 + 배경 제거 세로 영상
ascii-dance dance.mp4 --export matrix.mp4 --vertical --matrix --threshold 60
```

export는 터미널 크기와 상관없이 출력 해상도에 맞춰 문자 수를 정합니다(`--width`로 덮어쓰기 가능). 글리프는 JetBrains Mono를 래스터화해서 내장했고, ASCII와 `░▒▓█` 등 블록 문자를 지원합니다. 폰트에 없는 문자(예: 한글 커스텀 문자셋)는 밝기에 맞춘 사각 블록으로 대체됩니다.

## 📸 촬영 잘 나오는 터미널 설정 팁

**폰트**
- 고정폭 폰트 필수: JetBrains Mono, Fira Code, SF Mono, D2Coding 추천
- 폰트 크기를 **작게(8~11pt)** 할수록 해상도가 올라가서 사람 실루엣이 선명해짐. 화면 전체를 카메라로 찍을 거면 8pt 근처가 디테일·가독성 밸런스가 좋음
- 줄 간격(line height)은 `1.0`으로. 늘리면 글자 비율 보정이 어긋나 세로로 늘어나 보임
- 리가처(ligature)는 끄기 — `==`, `->` 같은 조합이 합쳐져서 질감이 깨짐 (`--charset code`일 때 특히)

**배경색 / 테마**
- 순수 검정 `#000000` 배경이 대비가 가장 잘 나옴. 반투명·블러 배경은 끄기
- 기본(mono) 모드는 글자색이 터미널 전경색을 따라감 → 흰색/연회색 추천, 네온 핑크·민트도 릴스 감성에 잘 맞음
- `--matrix`는 배경을 직접 검정으로 칠하므로 테마 상관없이 OK

**화면**
- 전체화면 + 탭바/스크롤바/상태바 숨기기, 커서 깜빡임 끄기
- 터미널은 truecolor 지원 앱 사용: iTerm2, WezTerm, Kitty, Ghostty, Windows Terminal (macOS 기본 Terminal.app은 truecolor 미지원이라 `--color`가 뭉개짐)
- Ghostty/WezTerm/Kitty/iTerm2는 synchronized output을 지원해서 프레임 찢어짐이 없음
- 폰으로 화면을 찍을 땐 모니터 밝기를 낮추고 방을 어둡게 → 모아레(줄무늬)가 줄어듦. 모니터 주사율과 폰 셔터가 안 맞으면 띠가 생기니 30fps 촬영 권장
- 가장 깔끔한 결과는 화면 촬영 대신 `--export` 사용

**원본 영상**
- 단색 배경 + 몸에 조명이 들어간 영상이 `--threshold`로 배경 날리기 제일 잘 됨
- 배경보다 옷 색이 어두우면 `--invert`

## 웹 버전

`web/` 폴더는 CLI와 **같은 변환 엔진**(`src/core`)을 쓰는 Vite + React + TypeScript 앱입니다. 서버 없이 브라우저 안에서만 처리하므로 영상이 어디로도 업로드되지 않습니다.

- 영상 올리기(클릭 / 드래그 앤 드롭) → 9:16 캔버스로 실시간 ASCII 미리보기
- CLI와 동일한 옵션: 문자셋(`standard` · `detailed` · `blocks` · `code` · 커스텀), 모노 / 컬러 / 매트릭스, 반전, 대비, 배경 날리기(threshold), 가로 문자 수
- 레이아웃: ASCII만 / 원본 + ASCII(위아래)
- **9:16(1080×1920) 영상 다운로드**
  - WebCodecs로 프레임을 하나씩 렌더링해서 인코딩 → 기기가 느려도 **프레임 누락 없음**, 원본 오디오 포함
  - Chrome / Edge / Safari: H.264 + AAC **mp4**. H.264 인코딩이 안 되는 브라우저는 webm
  - WebCodecs가 없으면 MediaRecorder 실시간 녹화로 자동 대체
- 하단 안전 영역(릴스 UI에 안 가리는 위치)에 `@gomgom_kim` + 사이트 주소 워터마크 (토글 가능)

```bash
cd web
npm install
npm run dev          # http://localhost:5173
npm run build        # → web/dist
```

### 워터마크 / 사이트 설정

[`web/src/config.ts`](web/src/config.ts)에서 관리합니다.

| 항목 | 기본값 | 환경변수로 덮어쓰기 |
| --- | --- | --- |
| 핸들 | `@gomgom_kim` | `VITE_WATERMARK_HANDLE` |
| 사이트 주소 | `ascii-dance.vercel.app` | `VITE_SITE_URL` |
| 릴스 안전 영역 | 위 220 · 아래 420 · 좌 60 · 우 120 px | — |

글꼴, 크기, 반투명 배경, 기본 on/off도 같은 파일에 있습니다. Vercel에 배포한 뒤 실제 도메인이 다르면 `VITE_SITE_URL`만 바꾸면 됩니다.

### Vercel 배포

루트의 [`vercel.json`](vercel.json)에 설정이 들어 있어서 **Root Directory를 따로 바꿀 필요가 없습니다**. 웹 앱이 `../src/core`를 가져오기 때문에 저장소 루트를 기준으로 빌드합니다.

1. Vercel → **Add New… → Project** → `GomgomKim/ascii-dance` 저장소 Import
2. Framework / Build 설정은 `vercel.json`이 덮어쓰므로 그대로 **Deploy**
   - install: `npm ci --prefix web` · build: `npm run build --prefix web` · output: `web/dist`
3. (선택) Settings → Environment Variables에 `VITE_SITE_URL` = 실제 도메인

## 개발

```bash
npm install
npm run build        # tsc → dist/
npm test             # vitest (core 유닛 테스트 + testsrc 통합 테스트 + 웹 엔진 테스트)
npm run sample       # 테스트 영상 생성
npm run gen-font     # (개발용) export용 글리프 비트맵 재생성 — playwright + JetBrains Mono 필요
```

구조:

```
src/
  core/           ★ CLI와 웹이 같이 쓰는 변환 엔진 (Node API 사용 금지, 테스트로 강제)
    ascii.ts        밝기→문자 매핑, 반전/대비/임계값, 매트릭스 색, 리사이즈 계산
    frame.ts        RGB/RGBA 프레임 → 문자 셀 → ANSI 라인
    raster.ts       문자 셀 → 픽셀 (내장 비트맵 폰트, RGB24/RGBA)
    layout.ts       9:16 / 나란히 레이아웃 계산
    font-data.ts    내장 글리프 비트맵 (자동 생성)
  cli.ts          옵션 파싱, 변환 → 재생 / export 흐름
  ffmpeg.ts       ffmpeg-static으로 probe / 프레임 추출 (rawvideo rgb24 파이프)
  player.ts       터미널 재생 (alt screen, 커서 이동, 오디오 시계 싱크, 루프)
  export.ts       ffmpeg 인코딩 (세로/나란히 필터 그래프)
  progress.ts     진행률 바
web/
  src/config.ts           워터마크 · 안전 영역 · export 설정
  src/engine/renderer.ts  영상 프레임 → core → 9:16 캔버스 (미리보기 = export 동일)
  src/engine/encoder.ts   WebCodecs 오프라인 인코딩 (mediabunny, 필요할 때만 로드)
  src/engine/recorder.ts  MediaRecorder 대체 경로
  src/App.tsx             UI
vercel.json       Vercel 빌드 설정 (web/ 정적 배포)
```
