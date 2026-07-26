const { app } = require('@azure/functions');
const { getVideosContainer } = require('../shared/cosmosClient');

const VIDEO_DOC_TYPE = 'video';
const MAX_PAGE_SIZE = 500;

function parsePaginationParams(queryParams) {
  const pageSizeParam = queryParams.get('pageSize');
  const continuationToken = queryParams.get('continuationToken') || '';

  if (pageSizeParam === null) {
    if (continuationToken) {
      return { error: 'pageSize is required when continuationToken is provided.' };
    }
    return { paged: false };
  }

  const normalizedPageSize = pageSizeParam.trim();
  if (!/^\d+$/.test(normalizedPageSize)) {
    return { error: `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.` };
  }

  const pageSize = Number(normalizedPageSize);
  if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    return { error: `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.` };
  }

  return {
    continuationToken,
    pageSize,
    paged: true,
  };
}

function createListVideosHandler({
  getContainer = getVideosContainer,
} = {}) {
  return async (request, context) => {
    try {
      const channelIdsParam = request.query.get('channelIds');
      if (!channelIdsParam) {
        return {
          status: 400,
          jsonBody: { success: false, error: 'channelIds 쿼리 파라미터가 필요합니다. (예: ?channelIds=UC123,UC456)' },
        };
      }

      const channelIds = channelIdsParam
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      const pagination = parsePaginationParams(request.query);
      if (pagination.error) {
        return {
          status: 400,
          jsonBody: { success: false, error: pagination.error },
        };
      }

      const container = getContainer();
      const query = {
        query: 'SELECT * FROM c WHERE ARRAY_CONTAINS(@channelIds, c.channelId) AND (NOT IS_DEFINED(c.docType) OR c.docType = @videoDocType)',
        parameters: [
          { name: '@channelIds', value: channelIds },
          { name: '@videoDocType', value: VIDEO_DOC_TYPE },
        ],
      };

      if (!pagination.paged) {
        const { resources } = await container.items.query(query).fetchAll();
        return { jsonBody: { success: true, videos: resources } };
      }

      const queryOptions = {
        maxItemCount: pagination.pageSize,
      };
      if (pagination.continuationToken) {
        queryOptions.continuationToken = pagination.continuationToken;
      }

      const {
        continuationToken: nextContinuationToken,
        resources,
      } = await container.items.query(query, queryOptions).fetchNext();

      return {
        jsonBody: {
          success: true,
          videos: resources,
          continuationToken: nextContinuationToken || null,
          hasMore: Boolean(nextContinuationToken),
        },
      };
    } catch (err) {
      context.error(`[영상 조회] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  };
}

const listVideosHandler = createListVideosHandler();

// GET /api/videos?channelIds=UC123,UC456 - 선택한 채널들의 저장 영상 조회
app.http('listVideos', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'videos',
  handler: listVideosHandler,
});

module.exports = {
  MAX_PAGE_SIZE,
  VIDEO_DOC_TYPE,
  createListVideosHandler,
  parsePaginationParams,
};
