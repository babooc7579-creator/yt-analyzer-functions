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
  if (!match) return { isShorts: false, formatted: '00:00' };

  const hours = parseInt(match[1]) || 0;
  const minutes = parseInt(match[2]) || 0;
  const seconds = parseInt(match[3]) || 0;
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  const isShorts = totalSeconds > 0 && totalSeconds <= 61;

  let formatted = '';
  if (hours > 0) formatted += `${hours}:`;
  formatted += `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return { isShorts, formatted };
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

module.exports = { parseDuration, fetchPlaylistPage, fetchVideoStatsBatch, fetchChannelInfo, parseChannelInput };
