const { app } = require('@azure/functions');
const { getVideosContainer } = require('../shared/cosmosClient');

const DEFAULT_USER_ID = 'default';
const VIDEO_RECORD_DOC_TYPE = 'video_user_record';

function getUserId(request) {
  return request.query.get('userId') || DEFAULT_USER_ID;
}

function getPartitionKey(userId) {
  return `__video_user_records_${userId}`;
}

function toRecordId(userId, videoId) {
  return `${userId}:${videoId}`;
}

function toClientRecord(document) {
  const { docType, userId, channelId, id, ...record } = document;
  return record;
}

function toRecordDocument(record, userId, now = new Date().toISOString()) {
  const videoId = String(record?.videoId || '').trim();
  if (!videoId) return { error: 'videoId is required.' };

  const partitionKey = getPartitionKey(userId);

  return {
    id: toRecordId(userId, videoId),
    docType: VIDEO_RECORD_DOC_TYPE,
    userId,
    channelId: partitionKey,
    videoId,
    status: record.status || 'new',
    draftTitle: record.draftTitle || '',
    note: record.note || '',
    targetPublishDate: record.targetPublishDate || '',
    createdAt: record.createdAt || now,
    updatedAt: now,
  };
}

app.http('listVideoUserRecords', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'video-records',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const partitionKey = getPartitionKey(userId);
      const container = getVideosContainer();
      const { resources } = await container.items
        .query(
          {
            query: 'SELECT * FROM c WHERE c.docType = @docType AND c.userId = @userId',
            parameters: [
              { name: '@docType', value: VIDEO_RECORD_DOC_TYPE },
              { name: '@userId', value: userId },
            ],
          },
          { partitionKey }
        )
        .fetchAll();

      return {
        jsonBody: {
          success: true,
          records: resources.reduce((acc, record) => {
            acc[record.videoId] = toClientRecord(record);
            return acc;
          }, {}),
        },
      };
    } catch (err) {
      context.error(`[video-records list] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

app.http('saveVideoUserRecord', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'video-records',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const body = await request.json();
      const document = toRecordDocument(body, userId);
      if (document.error) {
        return { status: 400, jsonBody: { success: false, error: document.error } };
      }

      const container = getVideosContainer();
      await container.items.upsert(document, { partitionKey: getPartitionKey(userId) });
      return { jsonBody: { success: true, record: toClientRecord(document) } };
    } catch (err) {
      context.error(`[video-records save] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

app.http('clearVideoUserRecords', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'video-records',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const partitionKey = getPartitionKey(userId);
      const container = getVideosContainer();
      const { resources } = await container.items
        .query(
          {
            query: 'SELECT c.id FROM c WHERE c.docType = @docType AND c.userId = @userId',
            parameters: [
              { name: '@docType', value: VIDEO_RECORD_DOC_TYPE },
              { name: '@userId', value: userId },
            ],
          },
          { partitionKey }
        )
        .fetchAll();

      for (const record of resources) {
        await container.item(record.id, partitionKey).delete();
      }

      return { jsonBody: { success: true, deleted: resources.length } };
    } catch (err) {
      context.error(`[video-records clear] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});
