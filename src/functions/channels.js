const { app } = require('@azure/functions');
const { getChannelsContainer } = require('../shared/cosmosClient');
const { fetchChannelInfo } = require('../shared/youtube');

const MAX_BULK_CHANNELS = 50;
const BULK_CHANNEL_BATCH_SIZE = 10;

function withChannelOperationalDefaults(channel, now = new Date().toISOString()) {
  const createdAt = channel.createdAt || now;
  return {
    ...channel,
    grade: channel.grade ?? 'unclassified',
    status: channel.status ?? 'active',
    collectionMode: channel.collectionMode ?? 'manual',
    scanIntervalHours: channel.scanIntervalHours ?? null,
    nextScanAt: channel.nextScanAt ?? null,
    latestVideoId: channel.latestVideoId ?? null,
    latestVideoPublishedAt: channel.latestVideoPublishedAt ?? null,
    backfillCursor: channel.backfillCursor ?? null,
    hasMoreVideos: channel.hasMoreVideos ?? true,
    backfillStatus: channel.backfillStatus ?? 'none',
    errorCount: channel.errorCount ?? 0,
    lastError: channel.lastError ?? null,
    lastErrorAt: channel.lastErrorAt ?? null,
    backoffUntil: channel.backoffUntil ?? null,
    updatedAt: channel.updatedAt || createdAt || now,
  };
}

const CHANNEL_OPERATION_FIELDS = [
  'grade',
  'status',
  'collectionMode',
  'scanIntervalHours',
  'nextScanAt',
  'latestVideoId',
  'latestVideoPublishedAt',
  'backfillCursor',
  'hasMoreVideos',
  'backfillStatus',
  'errorCount',
  'lastError',
  'lastErrorAt',
  'backoffUntil',
  'notes',
  'tags',
  'category',
  'language',
];

const CHANNEL_FIELD_VALUES = {
  grade: ['S', 'A', 'B', 'C', 'unclassified'],
  status: ['active', 'paused', 'discarded'],
  collectionMode: ['manual', 'auto', 'watch'],
  backfillStatus: ['none', 'pending', 'running', 'done', 'failed'],
};

function applyChannelUpdates(channel, body, now = new Date().toISOString()) {
  const updated = withChannelOperationalDefaults(channel, now);
  for (const field of CHANNEL_OPERATION_FIELDS) {
    if (body[field] === undefined) continue;
    if (CHANNEL_FIELD_VALUES[field] && !CHANNEL_FIELD_VALUES[field].includes(body[field])) {
      return { error: `${field} 값이 허용되지 않습니다.` };
    }
    updated[field] = body[field];
  }
  updated.updatedAt = now;
  return { channel: updated };
}

// GET /api/channel-preview?handle=... - 저장하지 않고 채널 정보만 미리 조회
app.http('previewChannel', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'channel-preview',
  handler: async (request, context) => {
    try {
      const handle = request.query.get('handle');
      if (!handle) {
        return { status: 400, jsonBody: { success: false, error: 'handle 쿼리 파라미터가 필요합니다.' } };
      }
      const info = await fetchChannelInfo(handle);
      return { jsonBody: { success: true, channel: info } };
    } catch (err) {
      context.error(`[채널 미리보기] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

// GET /api/channels - 등록된 채널 전체 목록 조회
app.http('listChannels', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'channels',
  handler: async (request, context) => {
    try {
      const { resources } = await getChannelsContainer().items.readAll().fetchAll();
      return { jsonBody: { success: true, channels: resources.map((channel) => withChannelOperationalDefaults(channel)) } };
    } catch (err) {
      context.error(`[채널 조회] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

// POST /api/channels - 새 채널 등록 { handle, tags: string[], language }
app.http('addChannel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'channels',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { handle, tags, language, note } = body;
      if (!handle) {
        return { status: 400, jsonBody: { success: false, error: 'handle(핸들/채널링크/영상링크)은 필수입니다.' } };
      }

      const cleanTags = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [];
      const category = cleanTags[0] || '미분류'; // Cosmos 파티션 키로 쓰일 내부용 값 (태그 중 첫 번째)
      const initialNotes = note && note.trim() ? [{ date: new Date().toISOString(), text: note.trim() }] : [];

      const info = await fetchChannelInfo(handle);
      const now = new Date().toISOString();
      const channelDoc = withChannelOperationalDefaults({
        id: info.id,
        title: info.title,
        thumbnail: info.thumbnail,
        uploadsId: info.uploadsId,
        stats: info.stats,
        category,
        tags: cleanTags,
        language: language || 'KR',
        notes: initialNotes,
        createdAt: now,
      }, now);

      await getChannelsContainer().items.upsert(channelDoc);
      return { jsonBody: { success: true, channel: channelDoc } };
    } catch (err) {
      context.error(`[채널 추가] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

function normalizeBulkChannelHandles(handles) {
  if (!Array.isArray(handles)) return [];
  return [...new Set(handles.map((handle) => String(handle || '').trim()).filter(Boolean))];
}

function chunkBulkChannelHandles(handles, size = BULK_CHANNEL_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < handles.length; index += size) {
    chunks.push(handles.slice(index, index + size));
  }
  return chunks;
}

async function handleBulkAddChannels(request, context, dependencies = {}) {
  try {
    const body = await request.json();
    if (!Array.isArray(body.handles)) {
      return { status: 400, jsonBody: { success: false, error: 'handles 배열이 필요합니다.' } };
    }

    const handles = normalizeBulkChannelHandles(body.handles);
    if (handles.length === 0) {
      return { status: 400, jsonBody: { success: false, error: '등록할 채널을 한 개 이상 입력해 주세요.' } };
    }
    if (handles.length > MAX_BULK_CHANNELS) {
      return { status: 400, jsonBody: { success: false, error: `채널은 한 번에 최대 ${MAX_BULK_CHANNELS}개까지 등록할 수 있습니다.` } };
    }

    const cleanTags = Array.isArray(body.tags) ? body.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
    const category = cleanTags[0] || '미분류';
    const container = dependencies.getContainer?.() || getChannelsContainer();
    const lookupChannel = dependencies.fetchChannelInfo || fetchChannelInfo;
    const { resources: storedChannels = [] } = await container.items.readAll().fetchAll();
    const storedById = new Map(storedChannels.map((channel) => [String(channel.id), channel]));
    const resolvedIds = new Set();
    const results = [];
    const batches = chunkBulkChannelHandles(handles);

    for (const batch of batches) {
      const resolvedBatch = await Promise.all(batch.map(async (handle) => {
        try {
          const info = await lookupChannel(handle);
          return { handle, info };
        } catch (error) {
          return { handle, error };
        }
      }));

      for (const resolved of resolvedBatch) {
        const { handle, info, error } = resolved;
        if (error) {
          results.push({ handle, success: false, status: 'failed', error: error.message });
          continue;
        }
        const channelId = String(info.id || '');
        const storedChannel = storedById.get(channelId);
        if (resolvedIds.has(channelId)) {
          results.push({ handle, success: true, status: 'duplicate', duplicate: true, channel: storedChannel || null });
          continue;
        }
        if (storedChannel) {
          results.push({ handle, success: true, status: 'existing', existing: true, channel: storedChannel });
          continue;
        }

        resolvedIds.add(channelId);
        try {
          const now = new Date().toISOString();
          const channelDoc = withChannelOperationalDefaults({
            id: info.id,
            title: info.title,
            thumbnail: info.thumbnail,
            uploadsId: info.uploadsId,
            stats: info.stats,
            category,
            tags: cleanTags,
            language: body.language || 'KR',
            notes: [],
            createdAt: now,
          }, now);
          await container.items.upsert(channelDoc);
          storedById.set(channelId, channelDoc);
          results.push({ handle, success: true, status: 'added', existing: false, channel: channelDoc });
        } catch (writeError) {
          resolvedIds.delete(channelId);
          results.push({ handle, success: false, status: 'failed', error: writeError.message });
        }
      }
    }

    const added = results.filter((result) => result.status === 'added').length;
    const existing = results.filter((result) => result.status === 'existing').length;
    const duplicate = results.filter((result) => result.status === 'duplicate').length;
    const failed = results.filter((result) => result.status === 'failed').length;
    return {
      jsonBody: {
        success: true,
        total: handles.length,
        added,
        existing,
        duplicate,
        failed,
        batchSize: BULK_CHANNEL_BATCH_SIZE,
        processedBatches: batches.length,
        results,
      },
    };
  } catch (err) {
    context.error(`[일괄 추가] 오류: ${err.message}`);
    return { status: 500, jsonBody: { success: false, error: err.message } };
  }
}

// POST /api/channels/bulk - 최대 50개 채널을 10개 단위로 확인·등록 { handles: string[], tags, language }
app.http('bulkAddChannels', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'channels/bulk',
  handler: handleBulkAddChannels,
});

// PATCH /api/channels/{id}?category=xxx - 채널 태그/언어 수정
app.http('updateChannel', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'channels/{id}',
  handler: async (request, context) => {
    try {
      const id = request.params.id;
      const category = request.query.get('category');
      if (!category) return { status: 400, jsonBody: { success: false, error: 'category 쿼리 파라미터가 필요합니다.' } };

      const body = await request.json();
      const container = getChannelsContainer();
      const { resource: channel } = await container.item(id, category).read();
      if (!channel) return { status: 404, jsonBody: { success: false, error: '채널을 찾을 수 없습니다.' } };

      // 허용된 필드만 업데이트
      const result = applyChannelUpdates(channel, body);
      if (result.error) {
        return { status: 400, jsonBody: { success: false, error: result.error } };
      }

      await container.items.upsert(result.channel);
      return { jsonBody: { success: true, channel: result.channel } };
    } catch (err) {
      context.error(`[채널 수정] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

// GET /api/tags/rename?from=해짜&to=해외짜집기 - 태그 이름 일괄 변경
app.http('renameTag', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'tags/rename',
  handler: async (request, context) => {
    try {
      const from = request.query.get('from');
      const to = request.query.get('to');
      if (!from || !to) return { status: 400, jsonBody: { success: false, error: 'from과 to 파라미터가 필요합니다.' } };

      const container = getChannelsContainer();
      const { resources: allChannels } = await container.items.readAll().fetchAll();
      const affected = allChannels.filter((c) => Array.isArray(c.tags) && c.tags.includes(from));

      let count = 0;
      for (const channel of affected) {
        channel.tags = channel.tags.map((t) => (t === from ? to : t));
        if (channel.category === from) channel.category = to;
        await container.items.upsert(channel);
        count++;
      }

      return { jsonBody: { success: true, renamed: { from, to }, channelsAffected: count } };
    } catch (err) {
      context.error(`[태그 이름 변경] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

// DELETE /api/channels/{id}?category=xxx - 채널 삭제 (파티션 키가 category라 필요)
app.http('deleteChannel', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
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

// POST /api/channels/{id}/notes?category=xxx - 채널에 분석/기록 한 줄 추가 (계속 쌓이는 로그)
app.http('addChannelNote', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'channels/{id}/notes',
  handler: async (request, context) => {
    try {
      const id = request.params.id;
      const category = request.query.get('category');
      const body = await request.json();
      const text = (body.text || '').trim();

      if (!category) return { status: 400, jsonBody: { success: false, error: 'category 쿼리 파라미터가 필요합니다.' } };
      if (!text) return { status: 400, jsonBody: { success: false, error: '기록 내용을 입력해주세요.' } };

      const container = getChannelsContainer();
      const { resource: channel } = await container.item(id, category).read();
      if (!channel) return { status: 404, jsonBody: { success: false, error: '채널을 찾을 수 없습니다.' } };

      const notes = Array.isArray(channel.notes) ? channel.notes : [];
      notes.unshift({ date: new Date().toISOString(), text });
      channel.notes = notes;

      await container.items.upsert(channel);
      return { jsonBody: { success: true, channel } };
    } catch (err) {
      context.error(`[채널 기록 추가] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

module.exports = {
  BULK_CHANNEL_BATCH_SIZE,
  MAX_BULK_CHANNELS,
  applyChannelUpdates,
  chunkBulkChannelHandles,
  handleBulkAddChannels,
  normalizeBulkChannelHandles,
  withChannelOperationalDefaults,
};
