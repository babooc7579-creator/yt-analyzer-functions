const { app } = require('@azure/functions');
const { searchYoutubeVideos } = require('../shared/youtube');

const ALLOWED_ORDERS = new Set(['relevance', 'date', 'viewCount']);
const ALLOWED_DURATIONS = new Set(['any', 'short', 'medium', 'long']);

function normalizeYoutubeSearchQuery(query) {
  const keyword = String(query.get('q') || '').trim();
  if (!keyword) return { error: '검색 키워드를 입력해 주세요.' };
  if (keyword.length > 100) return { error: '검색 키워드는 100자 이하로 입력해 주세요.' };

  const requestedMaxResults = Number.parseInt(query.get('maxResults') || '25', 10);
  const maxResults = Number.isFinite(requestedMaxResults)
    ? Math.min(50, Math.max(1, requestedMaxResults))
    : 25;
  const requestedOrder = query.get('order') || 'relevance';
  const requestedDuration = query.get('videoDuration') || 'any';
  const regionCode = String(query.get('regionCode') || '').trim().toUpperCase();
  const relevanceLanguage = String(query.get('relevanceLanguage') || '').trim();
  const pageToken = String(query.get('pageToken') || '').trim();
  const publishedAfter = String(query.get('publishedAfter') || '').trim();
  const publishedBefore = String(query.get('publishedBefore') || '').trim();

  if (regionCode && !/^[A-Z]{2}$/.test(regionCode)) {
    return { error: '국가 코드는 두 자리 영문으로 입력해 주세요.' };
  }
  if (relevanceLanguage && !/^[A-Za-z-]{2,12}$/.test(relevanceLanguage)) {
    return { error: '검색 언어 형식이 올바르지 않습니다.' };
  }
  if (pageToken.length > 200) return { error: '페이지 정보가 올바르지 않습니다.' };
  if (publishedAfter && !Number.isFinite(Date.parse(publishedAfter))) {
    return { error: '검색 시작 날짜가 올바르지 않습니다.' };
  }
  if (publishedBefore && !Number.isFinite(Date.parse(publishedBefore))) {
    return { error: '검색 종료 날짜가 올바르지 않습니다.' };
  }

  return {
    query: keyword,
    maxResults,
    order: ALLOWED_ORDERS.has(requestedOrder) ? requestedOrder : 'relevance',
    videoDuration: ALLOWED_DURATIONS.has(requestedDuration) && requestedDuration !== 'any'
      ? requestedDuration
      : '',
    regionCode,
    relevanceLanguage,
    pageToken,
    publishedAfter,
    publishedBefore,
  };
}

async function handleYoutubeVideoSearch(request, context, dependencies = {}) {
  const options = normalizeYoutubeSearchQuery(request.query);
  if (options.error) {
    return { status: 400, jsonBody: { success: false, error: options.error } };
  }

  try {
    const search = dependencies.searchYoutubeVideos || searchYoutubeVideos;
    const result = await search(options);
    return {
      jsonBody: {
        success: true,
        query: options.query,
        source: 'youtube-api',
        saved: false,
        ...result,
      },
    };
  } catch (error) {
    context.error(`[YouTube 키워드 검색] 오류: ${error.message}`);
    return { status: 500, jsonBody: { success: false, error: error.message } };
  }
}

app.http('searchYoutubeVideos', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'youtube-search',
  handler: handleYoutubeVideoSearch,
});

module.exports = { handleYoutubeVideoSearch, normalizeYoutubeSearchQuery };
