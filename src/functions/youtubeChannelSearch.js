const { app } = require('@azure/functions');
const { searchYoutubeChannels } = require('../shared/youtube');

function normalizeYoutubeChannelSearchQuery(query) {
  const keyword = String(query.get('q') || '').trim();
  if (!keyword) return { error: '검색 키워드를 입력해 주세요.' };
  if (keyword.length > 100) return { error: '검색 키워드는 100자 이하로 입력해 주세요.' };

  const requestedMaxResults = Number.parseInt(query.get('maxResults') || '12', 10);
  const maxResults = Number.isFinite(requestedMaxResults)
    ? Math.min(25, Math.max(1, requestedMaxResults))
    : 12;
  const regionCode = String(query.get('regionCode') || '').trim().toUpperCase();
  const relevanceLanguage = String(query.get('relevanceLanguage') || '').trim();
  const pageToken = String(query.get('pageToken') || '').trim();

  if (regionCode && !/^[A-Z]{2}$/.test(regionCode)) {
    return { error: '국가 코드는 두 자리 영문으로 입력해 주세요.' };
  }
  if (relevanceLanguage && !/^[A-Za-z-]{2,12}$/.test(relevanceLanguage)) {
    return { error: '검색 언어 형식이 올바르지 않습니다.' };
  }
  if (pageToken.length > 200) return { error: '페이지 정보가 올바르지 않습니다.' };

  return { query: keyword, maxResults, regionCode, relevanceLanguage, pageToken };
}

async function handleYoutubeChannelSearch(request, context, dependencies = {}) {
  const options = normalizeYoutubeChannelSearchQuery(request.query);
  if (options.error) {
    return { status: 400, jsonBody: { success: false, error: options.error } };
  }

  try {
    const search = dependencies.searchYoutubeChannels || searchYoutubeChannels;
    const result = await search(options);
    return {
      jsonBody: {
        success: true,
        query: options.query,
        source: 'youtube-api',
        saved: false,
        snapshot: true,
        ...result,
      },
    };
  } catch (error) {
    context.error(`[YouTube 채널 검색] 오류: ${error.message}`);
    return { status: 500, jsonBody: { success: false, error: error.message } };
  }
}

app.http('searchYoutubeChannels', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'youtube-channel-search',
  handler: handleYoutubeChannelSearch,
});

module.exports = { handleYoutubeChannelSearch, normalizeYoutubeChannelSearchQuery };
