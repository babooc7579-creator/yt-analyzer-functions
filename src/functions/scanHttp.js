const { app } = require('@azure/functions');
const { runScan, scanChannel } = require('../shared/scanLogic');
const { getChannelsContainer } = require('../shared/cosmosClient');

app.http('scanHttp', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'scan',
  handler: async (request, context) => {
    const tag = request.query.get('tag') || null;
    context.log(`[수동 스캔] 요청 받음${tag ? ` (태그: ${tag})` : ' (전체)'}`);
    try {
      const results = await runScan(tag ? { tag } : {});
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

        try {
          const result = await scanChannel(channel);
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
