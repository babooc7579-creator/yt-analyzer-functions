const assert = require('assert');
const {
  daysSince,
  isChannelScannable,
  isTtoTtoCandidate,
  needsStatsRefresh,
} = require('../src/shared/scanLogic');
const { buildScanLogDocument, normalizeTrigger } = require('../src/shared/scanLogs');
const { parsePageSize } = require('../src/functions/scanLogs');
const { parseDuration, parseChannelInput } = require('../src/shared/youtube');
const {
  backfillChannelHistory,
  buildBackfillState,
  mapPlaylistItemToVideo,
  parseBackfillPageLimit,
} = require('../src/shared/backfillLogic');

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// 1. daysSince 기본 동작
assert.strictEqual(daysSince(daysAgo(10)), 10, 'daysSince: 10일 전 계산이 맞아야 함');
assert.strictEqual(daysSince(daysAgo(0)), 0, 'daysSince: 오늘 날짜는 0이어야 함');

// 2. 최근 영상(90일 이내)은 항상 갱신 대상
const recentVideo = { uploadDate: daysAgo(30), lastStatsRefreshAt: isoDaysAgo(1) };
assert.strictEqual(needsStatsRefresh(recentVideo), true, '최근 영상은 매번 갱신되어야 함');

// 3. 오래된 영상(90일+) + 최근에 갱신됨(7일 이내) -> 갱신 불필요
const oldButRecentlyRefreshed = { uploadDate: daysAgo(200), lastStatsRefreshAt: isoDaysAgo(2) };
assert.strictEqual(needsStatsRefresh(oldButRecentlyRefreshed), false, '오래된 영상은 최근 갱신했으면 건너뛰어야 함');

// 4. 오래된 영상 + 갱신 주기(7일) 지남 -> 갱신 필요
const oldAndStale = { uploadDate: daysAgo(200), lastStatsRefreshAt: isoDaysAgo(10) };
assert.strictEqual(needsStatsRefresh(oldAndStale), true, '갱신 주기가 지난 오래된 영상은 갱신되어야 함');

// 5. 갱신 기록이 없는 오래된 영상 -> 무조건 갱신
const neverRefreshed = { uploadDate: daysAgo(200), lastStatsRefreshAt: undefined };
assert.strictEqual(needsStatsRefresh(neverRefreshed), true, '갱신 기록이 없으면 갱신되어야 함');

// 6. parseDuration: 쇼츠 판별 (61초 이하)
assert.strictEqual(parseDuration('PT45S').isShorts, true, '45초는 쇼츠여야 함');
assert.strictEqual(parseDuration('PT1M30S').isShorts, false, '1분 30초는 쇼츠가 아니어야 함');
assert.strictEqual(parseDuration('PT10M').formatted, '10:00', '10분 포맷팅 확인');

console.log('✅ 모든 테스트 통과! (daysSince, needsStatsRefresh, parseDuration 로직 정상)');

// 7. parseChannelInput: 입력값 종류 자동 인식
assert.deepStrictEqual(parseChannelInput('@핫하군'), { type: 'handle', value: '@핫하군' }, '핸들 그대로 인식');
assert.deepStrictEqual(parseChannelInput('mkbhd'), { type: 'handle', value: 'mkbhd' }, '@없는 핸들도 인식');
assert.deepStrictEqual(parseChannelInput('UCBJycsmduvYEL83R_U4JriQ'), { type: 'channelId', value: 'UCBJycsmduvYEL83R_U4JriQ' }, '채널ID(UC..) 인식');
assert.deepStrictEqual(parseChannelInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { type: 'video', value: 'dQw4w9WgXcQ' }, 'watch 링크 -> 영상ID 추출');
assert.deepStrictEqual(parseChannelInput('https://youtu.be/dQw4w9WgXcQ'), { type: 'video', value: 'dQw4w9WgXcQ' }, '단축 링크 -> 영상ID 추출');
assert.deepStrictEqual(parseChannelInput('https://www.youtube.com/shorts/F4F1H7Js3T4'), { type: 'video', value: 'F4F1H7Js3T4' }, 'shorts 링크 -> 영상ID 추출');
assert.deepStrictEqual(parseChannelInput('https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ'), { type: 'channelId', value: 'UCBJycsmduvYEL83R_U4JriQ' }, '채널 링크 -> 채널ID 추출');
assert.deepStrictEqual(parseChannelInput('https://www.youtube.com/@핫하군'), { type: 'handle', value: '@핫하군' }, '한글 핸들 채널 링크 인식');

console.log('✅ URL 자동 인식 테스트도 전부 통과!');


// 8. channel status: only active channels are scannable
assert.strictEqual(isChannelScannable({}), true, 'missing status should remain scannable for old channels');
assert.strictEqual(isChannelScannable({ status: 'active' }), true, 'active channels should be scannable');
assert.strictEqual(isChannelScannable({ status: 'paused' }), false, 'paused channels should not be scannable');
assert.strictEqual(isChannelScannable({ status: 'discarded' }), false, 'discarded channels should not be scannable');
console.log('channel status scan eligibility tests passed.');

// 9. scan completion and Creator OS must share the same tteotteotto threshold
assert.strictEqual(
  isTtoTtoCandidate({ uploadDate: daysAgo(180), multiplier: 1.5 }),
  true,
  '180일 이상이고 채널 평균 대비 1.5배인 영상은 또터또 후보여야 함',
);
assert.strictEqual(
  isTtoTtoCandidate({ uploadDate: daysAgo(179), multiplier: 10 }),
  false,
  '180일보다 최근 영상은 배수가 높아도 또터또 후보가 아니어야 함',
);
assert.strictEqual(
  isTtoTtoCandidate({ uploadDate: daysAgo(365), multiplier: 1.49 }),
  false,
  '채널 평균 대비 1.5배 미만 영상은 또터또 후보가 아니어야 함',
);
console.log('tteotteotto threshold alignment tests passed.');

// 10. scan history documents preserve the latest summary without changing scan behavior
const scanLog = buildScanLogDocument(
  { id: 'channel-1', title: '테스트 채널' },
  {
    status: 'partial',
    scannedAt: '2026-07-27T12:00:00.000Z',
    newVideosFound: 3,
    statsRefreshed: 8,
    savedVideosTotal: 120,
    channelTotalVideos: 150,
    estimatedMissingVideos: 30,
    coverageRate: 80,
  },
  { id: 'scan-log-1', scanRunId: 'run-1', trigger: 'selected' },
);
assert.deepStrictEqual(scanLog, {
  id: 'scan-log-1',
  docType: 'scan_log',
  channelId: 'channel-1',
  channelTitle: '테스트 채널',
  status: 'partial',
  scannedAt: '2026-07-27T12:00:00.000Z',
  newVideosFound: 3,
  statsRefreshed: 8,
  stoppedAtLatestVideoId: false,
  savedVideosTotal: 120,
  channelTotalVideos: 150,
  estimatedMissingVideos: 30,
  coverageRate: 80,
  error: null,
  trigger: 'selected',
  scanRunId: 'run-1',
});
assert.strictEqual(normalizeTrigger('unexpected'), 'unknown', 'unknown trigger values must be normalized');
assert.deepStrictEqual(parsePageSize(null), { pageSize: 100 }, 'scan log default page size');
assert.deepStrictEqual(parsePageSize('200'), { pageSize: 200 }, 'scan log max page size');
assert.ok(parsePageSize('201').error, 'scan log page size above max must be rejected');
console.log('scan history document and pagination tests passed.');

// 11. manual historical backfill stays capped and preserves resumable progress
assert.strictEqual(parseBackfillPageLimit(), 10, 'backfill should default to ten pages');
assert.strictEqual(parseBackfillPageLimit(0), 1, 'backfill should fetch at least one page');
assert.strictEqual(parseBackfillPageLimit(20), 10, 'backfill should never exceed ten pages');
assert.deepStrictEqual(
  mapPlaylistItemToVideo({
    snippet: {
      resourceId: { videoId: 'video-1' },
      title: '과거 영상',
      publishedAt: '2025-01-02T03:04:05Z',
      thumbnails: { high: { url: 'high.jpg' } },
    },
  }, { id: 'channel-1', title: '테스트 채널', language: 'ko' }),
  {
    id: 'video-1',
    docType: 'video',
    channelId: 'channel-1',
    channelTitle: '테스트 채널',
    language: 'ko',
    title: '과거 영상',
    thumbnail: 'high.jpg',
    uploadDate: '2025-01-02',
  },
  'backfill playlist items should map to compatible video documents',
);

const nextBackfillState = buildBackfillState(
  {
    stats: { totalVideoCount: 300 },
    backfillState: { pagesFetchedTotal: 2, videosSavedTotal: 40 },
  },
  {
    completed: false,
    inspectedVideos: 100,
    maxPages: 2,
    nextPageToken: 'next-page',
    pagesFetched: 2,
    savedVideosTotal: 140,
    savedVideosThisRun: 20,
    startedFromBeginning: false,
    updatedAt: '2026-07-27T12:00:00.000Z',
  },
);
assert.strictEqual(nextBackfillState.nextPageToken, 'next-page', 'next page token should be preserved');
assert.strictEqual(nextBackfillState.pagesFetchedTotal, 4, 'page progress should accumulate');
assert.strictEqual(nextBackfillState.videosInspectedTotal, 200, 'inspected progress should accumulate for legacy states');
assert.strictEqual(nextBackfillState.inspectionProgressRate, 66.7, 'inspection progress should use the channel upload count');
assert.strictEqual(nextBackfillState.videosSavedTotal, 60, 'saved progress should accumulate');
assert.strictEqual(nextBackfillState.lastRun.estimatedMissingVideos, 160, 'remaining estimate should be updated');

(async () => {
  const savedStates = [];
  const result = await backfillChannelHistory(
    {
      id: 'channel-1',
      title: '테스트 채널',
      uploadsId: 'uploads-1',
      stats: { totalVideoCount: 3 },
    },
    { maxPages: 2 },
    {
      fetchPlaylistPage: async (_uploadsId, token) => (
        token
          ? {
              items: [{
                snippet: {
                  resourceId: { videoId: 'video-3' },
                  title: '세 번째 영상',
                  publishedAt: '2024-01-01T00:00:00Z',
                },
              }],
            }
          : {
              nextPageToken: 'page-2',
              items: [
                {
                  snippet: {
                    resourceId: { videoId: 'video-1' },
                    title: '첫 영상',
                    publishedAt: '2026-01-01T00:00:00Z',
                  },
                },
                {
                  snippet: {
                    resourceId: { videoId: 'video-2' },
                    title: '두 번째 영상',
                    publishedAt: '2025-01-01T00:00:00Z',
                  },
                },
              ],
            }
      ),
      getExistingVideoIds: async () => new Set(['video-1']),
      applyStats: async (videos) => videos.map((video) => Object.assign(video, { viewCount: 10 })),
      upsertVideos: async () => {},
      refreshChannelMultipliers: async () => [{ id: 'video-1' }, { id: 'video-2' }, { id: 'video-3' }],
      saveBackfillState: async (_channel, state) => savedStates.push(state),
    },
  );

  assert.strictEqual(result.pagesFetched, 2, 'manual backfill should respect the requested page cap');
  assert.strictEqual(result.inspectedVideos, 3, 'manual backfill should report inspected videos');
  assert.strictEqual(result.savedVideosThisRun, 2, 'existing videos should not be saved again');
  assert.strictEqual(result.completed, true, 'missing next token should complete the backfill');
  assert.strictEqual(result.inspectionProgressRate, 100, 'playlist exhaustion should report complete inspection');
  assert.strictEqual(savedStates[0].nextPageToken, null, 'completed backfill should clear its cursor');
  console.log('manual historical backfill tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
