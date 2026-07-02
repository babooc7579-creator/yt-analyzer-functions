const { getVideosContainer, getChannelsContainer } = require('./cosmosClient');
const { parseDuration, fetchPlaylistPage, fetchVideoStatsBatch, fetchChannelInfo } = require('./youtube');

// === 갱신 정책 (API 호출 절약을 위한 핵심 규칙) ===
const RECENT_DAYS_THRESHOLD = 90; // 최근 90일 이내 영상은 스캔할 때마다 매번 통계 갱신
const OLD_REFRESH_INTERVAL_DAYS = 7; // 90일 이상 지난 영상은 7일에 한 번만 갱신
const MAX_DEEP_FETCH_PAGES = 5; // 채널 최초 수집 시 최대 250개(50개 x 5페이지)까지 수집
const TTOTTO_DAYS_THRESHOLD = 180; // '또터또' 후보 기준: 6개월 이상
const TTOTTO_MULTIPLIER_THRESHOLD = 3; // '또터또' 후보 기준: 채널 평균 대비 3배 이상

const ACTIVE_CHANNEL_STATUS = 'active';
const VIDEO_DOC_TYPE = 'video';
const isChannelScannable = (channel = {}) => (
  (channel.status || ACTIVE_CHANNEL_STATUS) === ACTIVE_CHANNEL_STATUS
);

function daysSince(dateStr) {
  const today = new Date();
  const target = new Date(dateStr);
  return Math.max(0, Math.floor((today - target) / (1000 * 60 * 60 * 24)));
}

// 이 영상의 통계를 지금 갱신해야 하는지 판단
function needsStatsRefresh(video) {
  const ageInDays = daysSince(video.uploadDate);
  if (ageInDays <= RECENT_DAYS_THRESHOLD) return true; // 최신 영상은 항상 갱신
  if (!video.lastStatsRefreshAt) return true; // 한 번도 갱신 안 됐으면 갱신
  return daysSince(video.lastStatsRefreshAt) >= OLD_REFRESH_INTERVAL_DAYS;
}

async function getExistingVideoIds(channelId) {
  const container = getVideosContainer();
  const { resources } = await container.items
    .query(
      {
        query: 'SELECT c.id FROM c WHERE c.channelId = @channelId AND (NOT IS_DEFINED(c.docType) OR c.docType = @videoDocType)',
        parameters: [
          { name: '@channelId', value: channelId },
          { name: '@videoDocType', value: VIDEO_DOC_TYPE },
        ],
      },
      { partitionKey: channelId }
    )
    .fetchAll();
  return new Set(resources.map((r) => r.id));
}

async function getChannelVideosFromDb(channelId) {
  const container = getVideosContainer();
  const { resources } = await container.items
    .query(
      {
        query: 'SELECT * FROM c WHERE c.channelId = @channelId AND (NOT IS_DEFINED(c.docType) OR c.docType = @videoDocType)',
        parameters: [
          { name: '@channelId', value: channelId },
          { name: '@videoDocType', value: VIDEO_DOC_TYPE },
        ],
      },
      { partitionKey: channelId }
    )
    .fetchAll();
  return resources;
}

// 채널 업로드 목록에서 영상 정보(통계 제외)를 가져옴
// isDeepFetch=true면 최대 250개까지, false면 최신 50개만 (이미 저장된 채널은 신규 영상만 확인하면 되니까)
async function fetchVideoStubs(channel, isDeepFetch) {
  const stubs = [];
  let pageToken = '';
  const stopAtVideoId = isDeepFetch ? null : channel.latestVideoId || null;
  const stopAfterPublishedAt = isDeepFetch ? null : channel.latestVideoPublishedAt || null;
  let pagesToFetch = isDeepFetch || stopAtVideoId ? MAX_DEEP_FETCH_PAGES : 1;
  let latestStub = null;
  let stoppedAtLatestVideoId = false;
  let shouldStop = false;

  while (pagesToFetch > 0 && !shouldStop) {
    const data = await fetchPlaylistPage(channel.uploadsId, pageToken);
    for (const item of data.items || []) {
      const videoId = item.snippet.resourceId.videoId;
      const publishedAt = item.snippet.publishedAt;

      if (!latestStub) {
        latestStub = { id: videoId, publishedAt };
      }

      if (stopAtVideoId && videoId === stopAtVideoId) {
        stoppedAtLatestVideoId = true;
        shouldStop = true;
        break;
      }

      if (!stopAtVideoId && stopAfterPublishedAt && new Date(publishedAt) <= new Date(stopAfterPublishedAt)) {
        shouldStop = true;
        break;
      }

      stubs.push({
        id: videoId,
        channelId: channel.id,
        channelTitle: channel.title,
        language: channel.language,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
        uploadDate: item.snippet.publishedAt.substring(0, 10),
      });
    }
    pageToken = data.nextPageToken || '';
    pagesToFetch--;
    if (!pageToken || shouldStop) break;
  }
  return { stubs, latestStub, stoppedAtLatestVideoId };
}

// 영상 목록에 실제 조회수/좋아요/길이 통계를 채워넣음 (50개씩 배치 호출)
async function applyStats(videos) {
  const now = new Date().toISOString();
  for (let i = 0; i < videos.length; i += 50) {
    const batch = videos.slice(i, i + 50);
    const statItems = await fetchVideoStatsBatch(batch.map((v) => v.id));
    for (const statItem of statItems) {
      const video = batch.find((v) => v.id === statItem.id);
      if (!video) continue;
      const viewCount = parseInt(statItem.statistics.viewCount || '0', 10);
      const likeCount = parseInt(statItem.statistics.likeCount || '0', 10);
      const commentCount = parseInt(statItem.statistics.commentCount || '0', 10);
      video.viewCount = viewCount;
      video.likeCount = likeCount;
      video.commentCount = commentCount;
      video.likeRatio = viewCount > 0 ? Number(((likeCount / viewCount) * 100).toFixed(1)) : 0;
      const durationInfo = parseDuration(statItem.contentDetails.duration);
      video.duration = durationInfo.formatted;
      video.isShorts = durationInfo.isShorts;
      video.lastStatsRefreshAt = now;
    }
  }
  return videos;
}

async function upsertVideos(videos) {
  const container = getVideosContainer();
  for (const video of videos) {
    await container.items.upsert(video);
  }
}

function getChannelTotalVideos(channel) {
  const value = channel.stats?.totalVideoCount ?? channel.stats?.videoCount ?? channel.totalVideoCount ?? 0;
  const total = Number(value);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function buildLastScanSummary(channel, options) {
  const channelTotalVideos = getChannelTotalVideos(channel);
  const savedVideosTotal = options.savedVideosTotal ?? 0;
  const estimatedMissingVideos = Math.max(channelTotalVideos - savedVideosTotal, 0);
  const coverageRate = channelTotalVideos > 0 ? Number(((savedVideosTotal / channelTotalVideos) * 100).toFixed(1)) : null;

  return {
    status: options.status || (estimatedMissingVideos > 0 ? 'partial' : 'success'),
    scannedAt: options.scannedAt,
    newVideosFound: options.newVideosFound ?? 0,
    statsRefreshed: options.statsRefreshed ?? 0,
    stoppedAtLatestVideoId: options.stoppedAtLatestVideoId ?? false,
    savedVideosTotal,
    channelTotalVideos,
    estimatedMissingVideos,
    coverageRate,
    error: options.error || null,
  };
}

async function saveChannelScanState(channel, state) {
  try {
    await getChannelsContainer().items.upsert({ ...channel, ...state });
  } catch {
    // Scan summary persistence should not turn a completed scan into a failed scan.
  }
}

// 채널 하나를 스캔: 신규 영상 발굴 + 효율적 통계 갱신 + 또터또 후보 탐지
async function scanChannel(channel) {
  try {
  // 채널 통계(구독자/영상수/전체조회수) 갱신 — API 호출 1회 추가
  try {
    const freshInfo = await fetchChannelInfo(channel.id);
    channel.stats = freshInfo.stats;
  } catch { /* 통계 갱신 실패해도 영상 스캔은 계속 진행 */ }

  const existingIds = await getExistingVideoIds(channel.id);
  const isFirstScan = existingIds.size === 0;

  const { stubs, latestStub, stoppedAtLatestVideoId } = await fetchVideoStubs(channel, isFirstScan);
  const newStubs = stubs.filter((s) => !existingIds.has(s.id));

  let toRefresh = [...newStubs];
  if (!isFirstScan) {
    const dbVideos = await getChannelVideosFromDb(channel.id);
    toRefresh = [...newStubs, ...dbVideos.filter(needsStatsRefresh)];
  }

  if (toRefresh.length > 0) {
    await applyStats(toRefresh);
    await upsertVideos(toRefresh);
  }

  // 채널 평균 조회수를 다시 계산해서 '대박지수(multiplier)' 갱신
  const allVideos = await getChannelVideosFromDb(channel.id);
  const validViews = allVideos.filter((v) => v.viewCount > 0).map((v) => v.viewCount);
  const avgViews = validViews.length > 0 ? validViews.reduce((a, b) => a + b, 0) / validViews.length : 1;

  const withMultiplier = allVideos.map((v) => ({
    ...v,
    multiplier: Number((v.viewCount / avgViews).toFixed(2)),
  }));
  await upsertVideos(withMultiplier);

  const now = new Date().toISOString();
  const lastScanSummary = buildLastScanSummary(channel, {
    scannedAt: now,
    newVideosFound: newStubs.length,
    statsRefreshed: toRefresh.length,
    stoppedAtLatestVideoId,
    savedVideosTotal: allVideos.length,
  });
  await saveChannelScanState(channel, {
    stats: channel.stats,
    latestVideoId: latestStub?.id || channel.latestVideoId || null,
    latestVideoPublishedAt: latestStub?.publishedAt || channel.latestVideoPublishedAt || null,
    lastScannedAt: now,
    updatedAt: now,
    lastScanSummary,
  });

  const ttoTtoCandidates = withMultiplier.filter(
    (v) => daysSince(v.uploadDate) >= TTOTTO_DAYS_THRESHOLD && v.multiplier >= TTOTTO_MULTIPLIER_THRESHOLD
  );

  return {
    channelId: channel.id,
    channelTitle: channel.title,
    isFirstScan,
    totalVideos: allVideos.length,
    newVideosFound: newStubs.length,
    statsRefreshed: toRefresh.length,
    stoppedAtLatestVideoId,
    ttoTtoCandidates: ttoTtoCandidates.map((v) => ({ id: v.id, title: v.title, multiplier: v.multiplier })),
  };
  } catch (err) {
    const now = new Date().toISOString();
    const lastScanSummary = buildLastScanSummary(channel, {
      status: 'failed',
      scannedAt: now,
      error: err.message,
    });
    await saveChannelScanState(channel, { lastScanSummary, lastScannedAt: now, updatedAt: now });
    throw err;
  }
}

// 등록된 채널을 순서대로 스캔. options.tag가 있으면 해당 태그의 채널만 스캔
async function runScan(options = {}) {
  const { resources: allChannels } = await getChannelsContainer().items.readAll().fetchAll();
  const targetChannels = options.tag
    ? allChannels.filter((c) => Array.isArray(c.tags) && c.tags.includes(options.tag))
    : allChannels;
  const channels = targetChannels.filter(isChannelScannable);

  const results = [];
  for (const channel of channels) {
    try {
      results.push(await scanChannel(channel));
    } catch (err) {
      results.push({ channelId: channel.id, channelTitle: channel.title, error: err.message });
    }
  }
  return results;
}

module.exports = { runScan, scanChannel, daysSince, needsStatsRefresh, isChannelScannable };
