const API_BASE = 'https://www.googleapis.com/youtube/v3';

function getApiKey() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error('YOUTUBE_API_KEY 환경 변수가 설정되지 않았습니다. Function App의 "환경 변수"를 확인하세요.');
  }
  return key;
}

// 영상 길이(ISO 8601, 예: PT1M30S)를 분석해서 쇼츠 여부와 표시용 문자열을 반환
function parseDuration(durationStr) {
  const match = (durationStr || '').match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return { isShorts: false, formatted: '00:00', totalSeconds: 0 };

  const hours = parseInt(match[1]) || 0;
  const minutes = parseInt(match[2]) || 0;
  const seconds = parseInt(match[3]) || 0;
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  const isShorts = totalSeconds > 0 && totalSeconds <= 61;

  let formatted = '';
  if (hours > 0) formatted += `${hours}:`;
  formatted += `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return { isShorts, formatted, totalSeconds };
}

function toCount(value) {
  const count = Number.parseInt(value || '0', 10);
  return Number.isFinite(count) ? count : 0;
}

function getBestThumbnail(thumbnails = {}) {
  return thumbnails.maxres?.url
    || thumbnails.standard?.url
    || thumbnails.high?.url
    || thumbnails.medium?.url
    || thumbnails.default?.url
    || '';
}

async function fetchYoutubeJson(path, params, fetchImpl = fetch) {
  const query = new URLSearchParams({ ...params, key: getApiKey() });
  const response = await fetchImpl(`${API_BASE}/${path}?${query.toString()}`);
  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || data?.error) {
    const message = data?.error?.message || `YouTube API 요청에 실패했습니다. (${response.status})`;
    throw new Error(`YouTube API 오류 (${path}): ${message}`);
  }

  return data || {};
}

async function searchYoutubeVideos(options = {}, fetchImpl = fetch) {
  const searchParams = {
    part: 'snippet',
    type: 'video',
    q: options.query,
    maxResults: String(options.maxResults || 25),
    order: options.order || 'relevance',
    safeSearch: 'moderate',
  };

  for (const key of [
    'pageToken',
    'publishedAfter',
    'publishedBefore',
    'regionCode',
    'relevanceLanguage',
    'videoDuration',
  ]) {
    if (options[key]) searchParams[key] = options[key];
  }

  const searchData = await fetchYoutubeJson('search', searchParams, fetchImpl);
  const searchItems = Array.isArray(searchData.items) ? searchData.items : [];
  const videoIds = searchItems.map((item) => item?.id?.videoId).filter(Boolean);
  if (videoIds.length === 0) {
    return {
      items: [],
      nextPageToken: searchData.nextPageToken || '',
      prevPageToken: searchData.prevPageToken || '',
      resultCount: 0,
    };
  }

  const videoData = await fetchYoutubeJson('videos', {
    part: 'snippet,statistics,contentDetails',
    id: videoIds.join(','),
  }, fetchImpl);
  const videoMap = new Map((videoData.items || []).map((item) => [item.id, item]));
  const channelIds = [...new Set((videoData.items || []).map((item) => item?.snippet?.channelId).filter(Boolean))];
  const channelData = channelIds.length > 0
    ? await fetchYoutubeJson('channels', {
      part: 'snippet,statistics',
      id: channelIds.join(','),
    }, fetchImpl)
    : { items: [] };
  const channelMap = new Map((channelData.items || []).map((item) => [item.id, item]));
  const now = Date.now();

  const items = videoIds.map((videoId) => {
    const video = videoMap.get(videoId);
    if (!video) return null;
    const channel = channelMap.get(video.snippet?.channelId) || {};
    const duration = parseDuration(video.contentDetails?.duration);
    const viewCount = toCount(video.statistics?.viewCount);
    const subscriberCount = toCount(channel.statistics?.subscriberCount);
    const publishedAt = video.snippet?.publishedAt || '';
    const publishedTime = Date.parse(publishedAt);
    const ageDays = Number.isFinite(publishedTime)
      ? Math.max(1, Math.floor((now - publishedTime) / 86400000))
      : 0;

    return {
      videoId,
      title: video.snippet?.title || '',
      description: video.snippet?.description || '',
      thumbnail: getBestThumbnail(video.snippet?.thumbnails),
      channelId: video.snippet?.channelId || '',
      channelTitle: video.snippet?.channelTitle || channel.snippet?.title || '',
      channelThumbnail: getBestThumbnail(channel.snippet?.thumbnails),
      publishedAt,
      duration: duration.formatted,
      durationSeconds: duration.totalSeconds,
      isShortsEstimate: duration.isShorts,
      viewCount,
      likeCount: toCount(video.statistics?.likeCount),
      commentCount: toCount(video.statistics?.commentCount),
      subscriberCount,
      hiddenSubscriberCount: Boolean(channel.statistics?.hiddenSubscriberCount),
      viralRatio: subscriberCount > 0 ? Math.round((viewCount / subscriberCount) * 100) : null,
      lifetimeViewsPerDay: ageDays > 0 ? Math.round(viewCount / ageDays) : null,
      ageDays,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }).filter(Boolean);

  return {
    items,
    nextPageToken: searchData.nextPageToken || '',
    prevPageToken: searchData.prevPageToken || '',
    resultCount: items.length,
  };
}

// 채널의 업로드 재생목록에서 영상 한 페이지(최대 50개)를 가져옴
async function fetchPlaylistPage(uploadsPlaylistId, pageToken) {
  const apiKey = getApiKey();
  const url = `${API_BASE}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50${
    pageToken ? `&pageToken=${pageToken}` : ''
  }&key=${apiKey}`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`YouTube API 오류 (playlistItems): ${data.error.message}`);
  }
  return data;
}

// 영상 ID 목록(최대 50개)의 통계/길이 정보를 한 번에 가져옴
async function fetchVideoStatsBatch(videoIds) {
  if (!videoIds || videoIds.length === 0) return [];
  const apiKey = getApiKey();
  const url = `${API_BASE}/videos?part=statistics,contentDetails&id=${videoIds.join(',')}&key=${apiKey}`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`YouTube API 오류 (videos): ${data.error.message}`);
  }
  return data.items || [];
}

// 사용자가 입력한 값이 무엇인지(영상 링크 / 채널 링크 / 핸들 / 채널ID) 자동으로 판별
function parseChannelInput(rawInput) {
  const input = rawInput.trim();

  try {
    const url = new URL(input.startsWith('http') ? input : `https://${input}`);
    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const videoId = url.pathname.replace('/', '');
      if (videoId) return { type: 'video', value: videoId };
    }

    if (host.endsWith('youtube.com')) {
      const path = decodeURIComponent(url.pathname);
      if (path.startsWith('/watch')) {
        const videoId = url.searchParams.get('v');
        if (videoId) return { type: 'video', value: videoId };
      }
      if (path.startsWith('/shorts/')) {
        const videoId = path.split('/shorts/')[1]?.split('/')[0];
        if (videoId) return { type: 'video', value: videoId };
      }
      if (path.startsWith('/channel/')) {
        const channelId = path.split('/channel/')[1]?.split('/')[0];
        if (channelId) return { type: 'channelId', value: channelId };
      }
      if (path.startsWith('/@')) {
        const handle = path.split('/')[1];
        if (handle) return { type: 'handle', value: handle };
      }
    }
  } catch {
    // URL이 아니면 아래에서 일반 핸들/ID로 처리
  }

  if (input.startsWith('UC') && input.length === 24) {
    return { type: 'channelId', value: input };
  }
  return { type: 'handle', value: input };
}

// 영상 ID로부터 그 영상이 속한 채널 ID를 알아냄
async function fetchChannelIdFromVideo(videoId) {
  const apiKey = getApiKey();
  const url = `${API_BASE}/videos?part=snippet&id=${videoId}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`YouTube API 오류 (videos): ${data.error.message}`);
  if (!data.items || data.items.length === 0) throw new Error('해당 영상을 찾을 수 없습니다.');
  return data.items[0].snippet.channelId;
}

// 채널 핸들/ID/채널링크/영상링크 - 무엇이든 받아서 채널 기본 정보를 조회 (채널 등록 시 사용)
async function fetchChannelInfo(rawInput) {
  const apiKey = getApiKey();
  const parsed = parseChannelInput(rawInput);

  let queryParam;
  if (parsed.type === 'video') {
    const channelId = await fetchChannelIdFromVideo(parsed.value);
    queryParam = `id=${channelId}`;
  } else if (parsed.type === 'channelId') {
    queryParam = `id=${parsed.value}`;
  } else {
    const handle = parsed.value.startsWith('@') ? parsed.value : `@${parsed.value}`;
    queryParam = `forHandle=${encodeURIComponent(handle)}`;
  }

  const url = `${API_BASE}/channels?part=snippet,contentDetails,statistics&${queryParam}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`YouTube API 오류 (channels): ${data.error.message}`);
  }
  if (!data.items || data.items.length === 0) {
    throw new Error('채널을 찾을 수 없습니다.');
  }

  const item = data.items[0];
  const s = item.statistics || {};
  const totalVideoCount = parseInt(s.videoCount || '0', 10);
  const totalViewCount = parseInt(s.viewCount || '0', 10);
  return {
    id: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.default?.url || '',
    uploadsId: item.contentDetails.relatedPlaylists.uploads,
    stats: {
      subscriberCount: parseInt(s.subscriberCount || '0', 10),
      totalVideoCount,
      totalViewCount,
      avgViewCount: totalVideoCount > 0 ? Math.round(totalViewCount / totalVideoCount) : 0, // 평균 조회수 (전체÷영상수)
      channelCreatedAt: item.snippet.publishedAt?.substring(0, 10) || '',
      lastUpdatedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  parseDuration,
  fetchPlaylistPage,
  fetchVideoStatsBatch,
  fetchChannelInfo,
  parseChannelInput,
  searchYoutubeVideos,
};
