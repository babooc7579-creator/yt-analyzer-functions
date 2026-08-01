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

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeStatusIds(statusIds) {
  if (!Array.isArray(statusIds)) return [];
  return [...new Set(statusIds.map((status) => (typeof status === 'string' ? status.trim() : '')).filter(Boolean))];
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getPreservedString(record, existingDocument, fieldName) {
  if (hasOwn(record, fieldName)) return normalizeString(record[fieldName]);
  return normalizeString(existingDocument?.[fieldName]);
}

function getPreservedStatus(record, existingDocument) {
  if (hasOwn(record, 'status')) return normalizeString(record.status) || 'new';
  return normalizeString(existingDocument?.status) || 'new';
}

function getRecordStatusIds(record, fallbackStatus) {
  const statusIds = hasOwn(record, 'statusIds') ? normalizeStatusIds(record.statusIds) : [];
  if (fallbackStatus && !statusIds.includes(fallbackStatus)) return [...statusIds, fallbackStatus];
  return statusIds;
}

function toClientRecord(document) {
  const { docType, userId, channelId, id, ...record } = document;
  return {
    ...record,
    focusPinnedAt: normalizeString(record.focusPinnedAt),
    scriptAnalysis: normalizeString(record.scriptAnalysis),
    scriptBody: normalizeString(record.scriptBody),
    scriptOutline: normalizeString(record.scriptOutline),
    scriptStatus: normalizeString(record.scriptStatus),
    statusIds: getRecordStatusIds(record, record.status),
  };
}

function toRecordDocument(record, userId, now = new Date().toISOString(), existingDocument = null) {
  const videoId = String(record?.videoId || '').trim();
  if (!videoId) return { error: 'videoId is required.' };

  const partitionKey = getPartitionKey(userId);
  const status = getPreservedStatus(record, existingDocument);
  const statusIds = hasOwn(record, 'statusIds')
    ? normalizeStatusIds(record.statusIds)
    : getRecordStatusIds(existingDocument, status);

  return {
    id: toRecordId(userId, videoId),
    docType: VIDEO_RECORD_DOC_TYPE,
    userId,
    channelId: partitionKey,
    videoId,
    status,
    statusIds,
    draftTitle: getPreservedString(record, existingDocument, 'draftTitle'),
    note: getPreservedString(record, existingDocument, 'note'),
    targetPublishDate: getPreservedString(record, existingDocument, 'targetPublishDate'),
    uploadedAt: getPreservedString(record, existingDocument, 'uploadedAt'),
    focusPinnedAt: getPreservedString(record, existingDocument, 'focusPinnedAt'),
    scriptAnalysis: getPreservedString(record, existingDocument, 'scriptAnalysis'),
    scriptBody: getPreservedString(record, existingDocument, 'scriptBody'),
    scriptOutline: getPreservedString(record, existingDocument, 'scriptOutline'),
    scriptStatus: getPreservedString(record, existingDocument, 'scriptStatus'),
    createdAt: record.createdAt || existingDocument?.createdAt || now,
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
      const container = getVideosContainer();
      const partitionKey = getPartitionKey(userId);
      const videoId = String(body?.videoId || '').trim();
      let existingDocument = null;

      if (videoId) {
        try {
          const { resource } = await container.item(toRecordId(userId, videoId), partitionKey).read();
          existingDocument = resource || null;
        } catch {
          existingDocument = null;
        }
      }

      const document = toRecordDocument(body, userId, new Date().toISOString(), existingDocument);
      if (document.error) {
        return { status: 400, jsonBody: { success: false, error: document.error } };
      }

      await container.items.upsert(document, { partitionKey });
      return { jsonBody: { success: true, record: toClientRecord(document) } };
    } catch (err) {
      context.error(`[video-records save] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

module.exports = {
  getRecordStatusIds,
  getPreservedStatus,
  normalizeStatusIds,
  toClientRecord,
  toRecordDocument,
};

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
