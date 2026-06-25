# yt-analyzer-functions

YouTube 채널 자동 스캔 백엔드 (Azure Functions, Node.js v4 모델)

## 구성

- `src/shared/cosmosClient.js` - Cosmos DB 연결
- `src/shared/youtube.js` - YouTube Data API v3 호출 헬퍼
- `src/shared/scanLogic.js` - 핵심 스캔 로직 (신규 영상 감지 + 효율적 통계 갱신 정책)
- `src/functions/scanTimer.js` - 매일 새벽 3시(KST) 자동 스캔
- `src/functions/scanHttp.js` - 수동 스캔 트리거 (`POST/GET /api/scan`)
- `src/functions/channels.js` - 채널 등록/조회/삭제 (`/api/channels`)

## 갱신 정책 (API 호출 절약)

- 채널 최초 등록 시: 업로드 영상 최대 250개까지 전체 수집
- 그 다음부터: 최신 영상 50개만 확인해서 신규 영상만 추가
- 통계(조회수/좋아요) 갱신: 업로드 90일 이내 영상은 매번, 90일 이상은 7일에 한 번만

## 필요한 환경 변수 (Function App > 환경 변수에서 설정)

- `COSMOS_CONNECTION_STRING`
- `YOUTUBE_API_KEY`

## 테스트

```bash
npm install
npm test
```

## 로컬 실행 (선택사항, Azure Functions Core Tools 필요)

```bash
func start
```
