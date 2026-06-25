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

// 채널 핸들/ID로 채널 기본 정보 조회 (채널 등록 시 사용)
async function fetchChannelInfo(handleOrId) {
  const apiKey = getApiKey();
  const trimmed = handleOrId.trim();
  const queryParam =
    trimmed.startsWith('UC') && trimmed.length === 24
      ? `id=${trimmed}`
      : `forHandle=${trimmed.startsWith('@') ? trimmed : '@' + trimmed}`;

  const url = `${API_BASE}/channels?part=snippet,contentDetails&${queryParam}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`YouTube API 오류 (channels): ${data.error.message}`);
  }
  if (!data.items || data.items.length === 0) {
    throw new Error('채널을 찾을 수 없습니다.');
  }

  const item = data.items[0];
  return {
    id: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.default?.url || '',
    uploadsId: item.contentDetails.relatedPlaylists.uploads,
  };
}

module.exports = { parseDuration, fetchPlaylistPage, fetchVideoStatsBatch, fetchChannelInfo };
