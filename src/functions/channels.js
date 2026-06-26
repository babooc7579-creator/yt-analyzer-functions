const { app } = require('@azure/functions');
const { getChannelsContainer } = require('../shared/cosmosClient');
const { fetchChannelInfo } = require('../shared/youtube');

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
      return { jsonBody: { success: true, channels: resources } };
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
      const channelDoc = {
        id: info.id,
        title: info.title,
        thumbnail: info.thumbnail,
        uploadsId: info.uploadsId,
        stats: info.stats,
        category,
        tags: cleanTags,
        language: language || 'KR',
        notes: initialNotes,
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

// POST /api/channels/bulk - 여러 채널 일괄 등록 { handles: string[], tags, language }
app.http('bulkAddChannels', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'channels/bulk',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { handles, tags, language } = body;
      if (!Array.isArray(handles) || handles.length === 0) {
        return { status: 400, jsonBody: { success: false, error: 'handles 배열이 필요합니다.' } };
      }

      const cleanTags = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [];
      const category = cleanTags[0] || '미분류';
      const container = getChannelsContainer();
      const results = [];

      for (const rawHandle of handles) {
        const handle = rawHandle.trim();
        if (!handle) continue;
        try {
          const info = await fetchChannelInfo(handle);
          const channelDoc = {
            id: info.id,
            title: info.title,
            thumbnail: info.thumbnail,
            uploadsId: info.uploadsId,
            stats: info.stats,
            category,
            tags: cleanTags,
            language: language || 'KR',
            notes: [],
            createdAt: new Date().toISOString(),
          };
          await container.items.upsert(channelDoc);
          results.push({ handle, success: true, channel: channelDoc });
        } catch (err) {
          results.push({ handle, success: false, error: err.message });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      return { jsonBody: { success: true, total: handles.length, added: successCount, results } };
    } catch (err) {
      context.error(`[일괄 추가] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
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
      if (body.tags !== undefined) channel.tags = Array.isArray(body.tags) ? body.tags : channel.tags;
      if (body.language !== undefined) channel.language = body.language;

      await container.items.upsert(channel);
      return { jsonBody: { success: true, channel } };
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
