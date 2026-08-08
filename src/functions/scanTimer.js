const { app } = require('@azure/functions');
const { buildScanRunSummary, runScan } = require('../shared/scanLogic');

// NCRONTAB 형식: 초 분 시 일 월 요일
// "0 0 18 * * *" = 매일 UTC 18:00 = 한국시간(UTC+9) 새벽 3시
app.timer('scanTimer', {
  schedule: '0 0 18 * * *',
  handler: async (myTimer, context) => {
    context.log('[자동 스캔] 시작');
    try {
      const results = await runScan({ trigger: 'timer' });
      const summary = buildScanRunSummary(results);
      context.log(`[자동 스캔] 완료 ${JSON.stringify(summary)}`);
    } catch (err) {
      context.error(`[자동 스캔] 오류: ${err.message}`);
    }
  },
});
