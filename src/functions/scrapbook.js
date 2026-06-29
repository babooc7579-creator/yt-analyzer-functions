const { app } = require('@azure/functions');
const { getScrapbookContainer } = require('../shared/cosmosClient');

const DEFAULT_USER_ID = 'default';
const SCRAPBOOK_DOC_TYPE = 'scrapbook';

function getUserId(request) {
  return request.query.get('userId') || DEFAULT_USER_ID;
}

function getVideoId(video) {
  return String(video?.videoId || video?.id || '').trim();
}

function toScrapbookId(userId, videoId) {
  return `${userId}:${videoId}`;
}

function getScrapbookPartitionKey(userId) {
  return `__scrapbook_${userId}`;
}

function toScrapbookDocument(video, userId, now = new Date().toISOString()) {
  const videoId = getVideoId(video);
  if (!videoId) return { error: 'videoId is required.' };
  const partitionKey = getScrapbookPartitionKey(userId);
  const sourceChannelId = video.sourceChannelId || video.channelId || video.channel_id || '';

  return {
    ...video,
    id: toScrapbookId(userId, videoId),
    docType: SCRAPBOOK_DOC_TYPE,
    userId,
    channelId: partitionKey,
    sourceChannelId,
    videoId,
    savedAt: video.savedAt || now,
    updatedAt: now,
  };
}

function toClientVideo(document) {
  const { docType, userId, channelId, sourceChannelId, updatedAt, ...video } = document;
  if (sourceChannelId && !video.channelId) {
    video.channelId = sourceChannelId;
  }
  return video;
}

app.http('listScrapbook', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'scrapbook',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const partitionKey = getScrapbookPartitionKey(userId);
      const container = await getScrapbookContainer();
      const { resources } = await container.items
        .query(
          {
            query: 'SELECT * FROM c WHERE c.docType = @docType AND c.userId = @userId ORDER BY c.savedAt DESC',
            parameters: [
              { name: '@docType', value: SCRAPBOOK_DOC_TYPE },
              { name: '@userId', value: userId },
            ],
          },
          { partitionKey }
        )
        .fetchAll();

      return { jsonBody: { success: true, videos: resources.map(toClientVideo) } };
    } catch (err) {
      context.error(`[scrapbook list] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

app.http('saveScrapbook', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'scrapbook',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const partitionKey = getScrapbookPartitionKey(userId);
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
        await container.items.upsert(document, { partitionKey });
        saved.push(toClientVideo(document));
      }

      return { jsonBody: { success: true, videos: saved, saved: saved.length } };
    } catch (err) {
      context.error(`[scrapbook save] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

app.http('deleteScrapbookItem', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'scrapbook/{videoId}',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const videoId = String(request.params.videoId || '').trim();
      if (!videoId) {
        return { status: 400, jsonBody: { success: false, error: 'videoId is required.' } };
      }

      const container = await getScrapbookContainer();
      await container.item(toScrapbookId(userId, videoId), getScrapbookPartitionKey(userId)).delete();
      return { jsonBody: { success: true, videoId } };
    } catch (err) {
      if (err.code === 404) return { jsonBody: { success: true } };
      context.error(`[scrapbook delete] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});
