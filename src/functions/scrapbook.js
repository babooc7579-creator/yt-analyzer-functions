const { app } = require('@azure/functions');
const { getScrapbookContainer } = require('../shared/cosmosClient');

const DEFAULT_USER_ID = 'default';

function getUserId(request) {
  return request.query.get('userId') || DEFAULT_USER_ID;
}

function getVideoId(video) {
  return String(video?.videoId || video?.id || '').trim();
}

function toScrapbookId(userId, videoId) {
  return `${userId}:${videoId}`;
}

function toScrapbookDocument(video, userId, now = new Date().toISOString()) {
  const videoId = getVideoId(video);
  if (!videoId) return { error: 'videoId가 필요합니다.' };

  return {
    ...video,
    id: toScrapbookId(userId, videoId),
    userId,
    videoId,
    savedAt: video.savedAt || now,
    updatedAt: now,
  };
}

function toClientVideo(document) {
  const { userId, updatedAt, ...video } = document;
  return video;
}

// GET /api/scrapbook - 저장된 스크랩 영상 목록 조회
app.http('listScrapbook', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'scrapbook',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const container = await getScrapbookContainer();
      const { resources } = await container.items
        .query(
          {
            query: 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.savedAt DESC',
            parameters: [{ name: '@userId', value: userId }],
          },
          { partitionKey: userId }
        )
        .fetchAll();

      return { jsonBody: { success: true, videos: resources.map(toClientVideo) } };
    } catch (err) {
      context.error(`[스크랩북 조회] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

// POST /api/scrapbook - 영상 하나 또는 여러 개 저장 { video } / { videos: [] }
app.http('saveScrapbook', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'scrapbook',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const body = await request.json();
      const videos = Array.isArray(body?.videos) ? body.videos : [body?.video || body];
      const container = await getScrapbookContainer();
      const saved = [];
      const now = new Date().toISOString();

      for (const video of videos) {
        const document = toScrapbookDocument(video, userId, now);
        if (document.error) {
          return { status: 400, jsonBody: { success: false, error: document.error } };
        }
        await container.items.upsert(document);
        saved.push(toClientVideo(document));
      }

      return { jsonBody: { success: true, videos: saved, saved: saved.length } };
    } catch (err) {
      context.error(`[스크랩북 저장] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

// DELETE /api/scrapbook/{videoId} - 스크랩 영상 삭제
app.http('deleteScrapbookItem', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'scrapbook/{videoId}',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const videoId = String(request.params.videoId || '').trim();
      if (!videoId) {
        return { status: 400, jsonBody: { success: false, error: 'videoId가 필요합니다.' } };
      }

      const container = await getScrapbookContainer();
      await container.item(toScrapbookId(userId, videoId), userId).delete();
      return { jsonBody: { success: true, videoId } };
    } catch (err) {
      if (err.code === 404) return { jsonBody: { success: true } };
      context.error(`[스크랩북 삭제] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});
