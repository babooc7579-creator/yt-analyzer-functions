const { app } = require('@azure/functions');
const { getChannelsContainer } = require('../shared/cosmosClient');
const { fetchChannelInfo } = require('../shared/youtube');

// GET /api/channels - 등록된 채널 전체 목록 조회
app.http('listChannels', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'channels',
  handler: async (request, context) => {
    try {
      const { resources } = await getChannelsContainer().items.readAll().fetchAll();
      return { jsonBody: { success: true, channels: resources } };
    } catch (err) {
      context.error(`[채널 조회] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

// POST /api/channels - 새 채널 등록 { handle, category, language }
app.http('addChannel', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'channels',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { handle, category, language } = body;
      if (!handle || !category) {
        return { status: 400, jsonBody: { success: false, error: 'handle과 category는 필수입니다.' } };
      }

      const info = await fetchChannelInfo(handle);
      const channelDoc = {
        id: info.id,
        title: info.title,
        thumbnail: info.thumbnail,
        uploadsId: info.uploadsId,
        category,
        language: language || 'KR',
        createdAt: new Date().toISOString(),
      };

      await getChannelsContainer().items.upsert(channelDoc);
      return { jsonBody: { success: true, channel: channelDoc } };
    } catch (err) {
      context.error(`[채널 추가] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

// DELETE /api/channels/{id}?category=xxx - 채널 삭제 (파티션 키가 category라 필요)
app.http('deleteChannel', {
  methods: ['DELETE'],
  authLevel: 'function',
  route: 'channels/{id}',
  handler: async (request, context) => {
    try {
      const id = request.params.id;
      const category = request.query.get('category');
      if (!category) {
        return { status: 400, jsonBody: { success: false, error: 'category 쿼리 파라미터가 필요합니다.' } };
      }
      await getChannelsContainer().item(id, category).delete();
      return { jsonBody: { success: true } };
    } catch (err) {
      context.error(`[채널 삭제] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});
