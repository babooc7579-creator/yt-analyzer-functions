const { app } = require('@azure/functions');
const { runScan } = require('../shared/scanLogic');

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
