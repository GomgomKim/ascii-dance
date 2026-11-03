# ascii-dance 💃

춤 영상을 ASCII 아트로 바꿔서 터미널에서 재생하는 CLI.
인스타 릴스 촬영용이라 **화면에서 예쁘게 보이는 것**에 집중했습니다. 터미널을 그대로 찍어도 되고, `--export`로 바로 9:16 영상으로 뽑을 수도 있습니다.

- ffmpeg 따로 설치할 필요 없음 (`ffmpeg-static` 내장)
- 터미널 크기에 자동 맞춤 + 세로로 길쭉한 글자 비율 보정
- 전체 프레임을 먼저 변환해두고 재생 → 렉 없음
- ANSI 커서 이동 + synchronized output으로 깜빡임/찢어짐 없이 덮어쓰기
- 폰으로 찍은 세로 영상(회전 메타데이터)도 올바른 방향으로 재생

## 설치 / 실행

Node.js 18.17 이상이 필요합니다.

```bash
# 저장소에서 바로 실행
git clone https://github.com/GomgomKim/ascii-dance.git
cd ascii-dance
npm install          # 설치 시 자동으로 빌드됨 (prepare)
node dist/cli.js ./dance.mp4

# 또는 전역 명령으로 링크
npm link
ascii-dance ./dance.mp4

# npm에 배포한 뒤에는
npx ascii-dance ./dance.mp4 [옵션]
```

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

## 개발

```bash
npm install
npm run build        # tsc → dist/
npm test             # vitest (순수 함수 유닛 테스트 + testsrc 통합 테스트)
npm run sample       # 테스트 영상 생성
npm run gen-font     # (개발용) export용 글리프 비트맵 재생성 — playwright + JetBrains Mono 필요
```

구조:

```
src/
  cli.ts        옵션 파싱, 변환 → 재생 / export 흐름
  ascii.ts      (순수) 밝기→문자 매핑, 반전/대비/임계값, 매트릭스 색, 리사이즈 계산
  frame.ts      (순수) RGB 프레임 → 문자 셀 → ANSI 라인
  ffmpeg.ts     ffmpeg-static으로 probe / 프레임 추출 (rawvideo rgb24 파이프)
  player.ts     터미널 재생 (alt screen, 커서 이동, 오디오 시계 싱크, 루프)
  export.ts     문자 셀 래스터화 → ffmpeg 인코딩 (세로/나란히 레이아웃)
  progress.ts   진행률 바
  font-data.ts  내장 글리프 비트맵 (자동 생성)
```
