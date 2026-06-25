const { app } = require('@azure/functions');
const { getVideosContainer } = require('../shared/cosmosClient');

// GET /api/videos?channelIds=UC123,UC456 - 선택한 채널들의 영상 데이터 조회
app.http('listVideos', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'videos',
  handler: async (request, context) => {
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
        .map((s) => s.trim())
        .filter(Boolean);

      const container = getVideosContainer();
      const query = {
        query: 'SELECT * FROM c WHERE ARRAY_CONTAINS(@channelIds, c.channelId)',
        parameters: [{ name: '@channelIds', value: channelIds }],
      };
      const { resources } = await container.items.query(query).fetchAll();

      return { jsonBody: { success: true, videos: resources } };
    } catch (err) {
      context.error(`[영상 조회] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});
