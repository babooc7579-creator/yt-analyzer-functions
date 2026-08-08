const { getChannelsContainer } = require('./cosmosClient');
const {
  applyStats,
  getChannelTotalVideos,
  getExistingVideoIds,
  refreshChannelMultipliers,
} = require('./scanLogic');
const { fetchPlaylistPage } = require('./youtube');

const DEFAULT_BACKFILL_PAGES = 10;
const MAX_BACKFILL_PAGES = 10;
const VIDEO_DOC_TYPE = 'video';

function parseBackfillPageLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_BACKFILL_PAGES;
  return Math.min(Math.max(parsed, 1), MAX_BACKFILL_PAGES);
}

function mapPlaylistItemToVideo(item, channel) {
  const snippet = item?.snippet || {};
  const id = snippet.resourceId?.videoId;
  if (!id) return null;

  return {
    id,
    docType: VIDEO_DOC_TYPE,
    channelId: channel.id,
    channelTitle: channel.title,
    language: channel.language,
    title: snippet.title || '제목 없는 영상',
    thumbnail: snippet.thumbnails?.high?.url
      || snippet.thumbnails?.medium?.url
      || snippet.thumbnails?.default?.url
      || '',
    uploadDate: snippet.publishedAt?.substring(0, 10) || '',
  };
}

function buildBackfillState(channel, {
  completed,
  inspectedVideos,
  maxPages,
  nextPageToken,
  pagesFetched,
  savedVideosTotal,
  savedVideosThisRun,
  startedFromBeginning,
  updatedAt,
}) {
  const previousState = channel.backfillState || {};
  const channelTotalVideos = getChannelTotalVideos(channel);
  const estimatedMissingVideos = Math.max(channelTotalVideos - savedVideosTotal, 0);
  const coverageRate = channelTotalVideos > 0
    ? Number(((savedVideosTotal / channelTotalVideos) * 100).toFixed(1))
    : null;
  const previousInspectedTotal = Number(previousState.videosInspectedTotal)
    || Math.min((Number(previousState.pagesFetchedTotal) || 0) * 50, channelTotalVideos || Infinity);
  const videosInspectedTotal = previousInspectedTotal + inspectedVideos;
  const inspectionProgressRate = completed
    ? 100
    : channelTotalVideos > 0
      ? Number((Math.min(videosInspectedTotal / channelTotalVideos, 1) * 100).toFixed(1))
      : null;

  return {
    completed,
    inspectionProgressRate,
    nextPageToken: completed ? null : nextPageToken,
    pagesFetchedTotal: (Number(previousState.pagesFetchedTotal) || 0) + pagesFetched,
    videosInspectedTotal,
    videosSavedTotal: (Number(previousState.videosSavedTotal) || 0) + savedVideosThisRun,
    updatedAt,
    lastRun: {
      channelTotalVideos,
      completed,
      coverageRate,
      estimatedMissingVideos,
      inspectionProgressRate,
      inspectedVideos,
      maxPages,
      pagesFetched,
      savedVideosThisRun,
      savedVideosTotal,
      startedFromBeginning,
      updatedAt,
      videosInspectedTotal,
    },
  };
}

async function saveBackfillState(channel, backfillState, channelsContainer = getChannelsContainer()) {
  await channelsContainer.items.upsert({
    ...channel,
    backfillState,
    updatedAt: backfillState.updatedAt,
  });
}

async function backfillChannelHistory(channel, options = {}, dependencies = {}) {
  if (!channel?.id || !channel?.uploadsId) {
    throw new Error('과거 영상을 채울 채널 정보가 올바르지 않습니다.');
  }

  const maxPages = parseBackfillPageLimit(options.maxPages);
  const previousState = channel.backfillState || {};
  if (previousState.completed) {
    return {
      channelId: channel.id,
      channelTitle: channel.title,
      completed: true,
      alreadyCompleted: true,
      inspectedVideos: 0,
      pagesFetched: 0,
      savedVideosThisRun: 0,
      ...(previousState.lastRun || {}),
    };
  }

  const deps = {
    applyStats: dependencies.applyStats || applyStats,
    fetchPlaylistPage: dependencies.fetchPlaylistPage || fetchPlaylistPage,
    getExistingVideoIds: dependencies.getExistingVideoIds || getExistingVideoIds,
    refreshChannelMultipliers: dependencies.refreshChannelMultipliers || refreshChannelMultipliers,
    saveBackfillState: dependencies.saveBackfillState || saveBackfillState,
  };
  const startedFromBeginning = !previousState.nextPageToken;
  let nextPageToken = previousState.nextPageToken || '';
  let completed = false;
  let pagesFetched = 0;
  const stubs = [];

  for (let page = 0; page < maxPages; page += 1) {
    const data = await deps.fetchPlaylistPage(channel.uploadsId, nextPageToken);
    pagesFetched += 1;
    stubs.push(
      ...(data.items || [])
        .map((item) => mapPlaylistItemToVideo(item, channel))
        .filter(Boolean),
    );
    nextPageToken = data.nextPageToken || '';
    if (!nextPageToken) {
      completed = true;
      break;
    }
  }

  const existingIds = await deps.getExistingVideoIds(channel.id);
  const uniqueStubs = [...new Map(stubs.map((video) => [video.id, video])).values()];
  const newStubs = uniqueStubs.filter((video) => !existingIds.has(video.id));

  if (newStubs.length > 0) {
    await deps.applyStats(newStubs);
  }

  const multiplierRefresh = await deps.refreshChannelMultipliers(channel.id, newStubs);
  const allVideos = Array.isArray(multiplierRefresh) ? multiplierRefresh : multiplierRefresh.videos;
  const updatedAt = new Date().toISOString();
  const backfillState = buildBackfillState(channel, {
    completed,
    inspectedVideos: uniqueStubs.length,
    maxPages,
    nextPageToken,
    pagesFetched,
    savedVideosTotal: allVideos.length,
    savedVideosThisRun: newStubs.length,
    startedFromBeginning,
    updatedAt,
  });
  await deps.saveBackfillState(channel, backfillState);

  return {
    channelId: channel.id,
    channelTitle: channel.title,
    alreadyCompleted: false,
    apiRequests: {
      playlistPages: pagesFetched,
      statsBatches: Math.ceil(newStubs.length / 50),
    },
    ...backfillState.lastRun,
  };
}

module.exports = {
  DEFAULT_BACKFILL_PAGES,
  MAX_BACKFILL_PAGES,
  backfillChannelHistory,
  buildBackfillState,
  mapPlaylistItemToVideo,
  parseBackfillPageLimit,
};
