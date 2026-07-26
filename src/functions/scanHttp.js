const { app } = require('@azure/functions');
const { randomUUID } = require('crypto');
const { runScan, scanChannel, isChannelScannable } = require('../shared/scanLogic');
const { backfillChannelHistory } = require('../shared/backfillLogic');
const { getChannelsContainer } = require('../shared/cosmosClient');

app.http('scanHttp', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'scan',
  handler: async (request, context) => {
    const tag = request.query.get('tag') || null;
    context.log(`[수동 스캔] 요청 받음${tag ? ` (태그: ${tag})` : ' (전체)'}`);
    try {
      const results = await runScan({
        ...(tag ? { tag } : {}),
        scanRunId: randomUUID(),
        trigger: tag ? 'manual_tag' : 'manual_all',
      });
      return { jsonBody: { success: true, results } };
    } catch (err) {
      context.error(`[수동 스캔] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

app.http('scanSelectedHttp', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'scan/selected',
  handler: async (request, context) => {
    try {
      const body = (await request.json()) || {};
      const channelIds = Array.isArray(body.channelIds)
        ? body.channelIds.map((id) => String(id).trim()).filter(Boolean)
        : [];

      if (channelIds.length === 0) {
        return { status: 400, jsonBody: { success: false, error: 'channelIds 배열이 필요합니다.' } };
      }

      const uniqueChannelIds = [...new Set(channelIds)];
      const scanRunId = randomUUID();
      context.log(`[selected scan] requested ${uniqueChannelIds.length} channels${body.reason ? ` (${body.reason})` : ''}`);

      const { resources: channels } = await getChannelsContainer().items
        .query({
          query: 'SELECT * FROM c WHERE ARRAY_CONTAINS(@channelIds, c.id)',
          parameters: [{ name: '@channelIds', value: uniqueChannelIds }],
        })
        .fetchAll();

      const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
      const results = [];

      for (const channelId of uniqueChannelIds) {
        const channel = channelsById.get(channelId);
        if (!channel) {
          results.push({ channelId, success: false, error: 'channel not found' });
          continue;
        }

        if (!isChannelScannable(channel)) {
          results.push({ channelId, channelTitle: channel.title, success: false, skipped: true, reason: 'channel is not active' });
          continue;
        }

        try {
          const result = await scanChannel(channel, { scanRunId, trigger: 'selected' });
          results.push({ ...result, success: true });
        } catch (err) {
          results.push({ channelId, channelTitle: channel.title, success: false, error: err.message });
        }
      }

      return { jsonBody: { success: true, results } };
    } catch (err) {
      context.error(`[selected scan] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

app.http('scanBackfillHttp', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'scan/backfill',
  handler: async (request, context) => {
    try {
      const body = (await request.json()) || {};
      const channelId = String(body.channelId || '').trim();

      if (!channelId) {
        return { status: 400, jsonBody: { success: false, error: 'channelId가 필요합니다.' } };
      }

      const { resources: channels } = await getChannelsContainer().items
        .query({
          query: 'SELECT * FROM c WHERE c.id = @channelId',
          parameters: [{ name: '@channelId', value: channelId }],
        })
        .fetchAll();
      const channel = channels[0];

      if (!channel) {
        return { status: 404, jsonBody: { success: false, error: '저장된 채널을 찾을 수 없습니다.' } };
      }
      if (!isChannelScannable(channel)) {
        return {
          status: 409,
          jsonBody: { success: false, error: '운영중 채널만 과거 영상 채우기를 실행할 수 있습니다.' },
        };
      }

      context.log(`[historical backfill] requested channel ${channelId}`);
      const result = await backfillChannelHistory(channel, { maxPages: body.maxPages });
      return { jsonBody: { success: true, result } };
    } catch (err) {
      context.error(`[historical backfill] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});
