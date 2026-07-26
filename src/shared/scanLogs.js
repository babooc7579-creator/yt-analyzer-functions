const { randomUUID } = require('crypto');
const { getVideosContainer } = require('./cosmosClient');

const SCAN_LOG_DOC_TYPE = 'scan_log';
const SCAN_LOG_TRIGGERS = new Set(['manual_all', 'manual_tag', 'selected', 'timer', 'unknown']);

function normalizeTrigger(value) {
  return SCAN_LOG_TRIGGERS.has(value) ? value : 'unknown';
}

function buildScanLogDocument(channel, summary, metadata = {}) {
  const scannedAt = summary.scannedAt || new Date().toISOString();

  return {
    id: metadata.id || `scan-${scannedAt}-${channel.id}-${randomUUID()}`,
    docType: SCAN_LOG_DOC_TYPE,
    channelId: channel.id,
    channelTitle: channel.title || channel.id,
    status: summary.status || 'success',
    scannedAt,
    newVideosFound: summary.newVideosFound ?? 0,
    statsRefreshed: summary.statsRefreshed ?? 0,
    stoppedAtLatestVideoId: summary.stoppedAtLatestVideoId ?? false,
    savedVideosTotal: summary.savedVideosTotal ?? 0,
    channelTotalVideos: summary.channelTotalVideos ?? 0,
    estimatedMissingVideos: summary.estimatedMissingVideos ?? 0,
    coverageRate: summary.coverageRate ?? null,
    error: summary.error || null,
    trigger: normalizeTrigger(metadata.trigger),
    scanRunId: metadata.scanRunId || null,
  };
}

async function saveScanLog(channel, summary, metadata = {}) {
  try {
    const document = buildScanLogDocument(channel, summary, metadata);
    await getVideosContainer().items.create(document, { partitionKey: document.channelId });
    return { saved: true, document };
  } catch (error) {
    console.error(`[scan_logs] history write failed for ${channel.id}: ${error.message}`);
    return { saved: false, error: error.message };
  }
}

module.exports = {
  SCAN_LOG_DOC_TYPE,
  SCAN_LOG_TRIGGERS,
  buildScanLogDocument,
  normalizeTrigger,
  saveScanLog,
};
