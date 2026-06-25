const { app } = require('@azure/functions');
const { runScan } = require('../shared/scanLogic');

app.http('scanHttp', {
  methods: ['GET', 'POST'],
  authLevel: 'function',
  route: 'scan',
  handler: async (request, context) => {
    context.log('[수동 스캔] 요청 받음');
    try {
      const results = await runScan();
      return { jsonBody: { success: true, results } };
    } catch (err) {
      context.error(`[수동 스캔] 오류: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});
