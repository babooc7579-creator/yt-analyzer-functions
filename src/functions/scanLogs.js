const { app } = require('@azure/functions');
const { getVideosContainer } = require('../shared/cosmosClient');
const { SCAN_LOG_DOC_TYPE } = require('../shared/scanLogs');

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const VALID_STATUSES = new Set(['success', 'partial', 'failed']);

function parsePageSize(value) {
  if (value === null || value === '') return { pageSize: DEFAULT_PAGE_SIZE };
  if (!/^\d+$/.test(value)) {
    return { error: `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.` };
  }

  const pageSize = Number(value);
  if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    return { error: `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.` };
  }
  return { pageSize };
}

function createListScanLogsHandler({
  getContainer = getVideosContainer,
} = {}) {
  return async (request, context) => {
    try {
      const parsedPageSize = parsePageSize(request.query.get('pageSize'));
      if (parsedPageSize.error) {
        return { status: 400, jsonBody: { success: false, error: parsedPageSize.error } };
      }

      const channelId = (request.query.get('channelId') || '').trim();
      const status = (request.query.get('status') || '').trim();
      if (status && !VALID_STATUSES.has(status)) {
        return {
          status: 400,
          jsonBody: { success: false, error: 'status must be success, partial, or failed.' },
        };
      }

      const filters = ['c.docType = @docType'];
      const parameters = [{ name: '@docType', value: SCAN_LOG_DOC_TYPE }];
      if (channelId) {
        filters.push('c.channelId = @channelId');
        parameters.push({ name: '@channelId', value: channelId });
      }
      if (status) {
        filters.push('c.status = @status');
        parameters.push({ name: '@status', value: status });
      }

      const query = {
        query: `SELECT * FROM c WHERE ${filters.join(' AND ')} ORDER BY c.scannedAt DESC`,
        parameters,
      };
      const queryOptions = { maxItemCount: parsedPageSize.pageSize };
      const continuationToken = request.query.get('continuationToken') || '';
      if (continuationToken) queryOptions.continuationToken = continuationToken;
      if (channelId) queryOptions.partitionKey = channelId;

      const page = await getContainer().items.query(query, queryOptions).fetchNext();
      return {
        jsonBody: {
          success: true,
          scanLogs: page.resources,
          continuationToken: page.continuationToken || null,
          hasMore: Boolean(page.continuationToken),
        },
      };
    } catch (error) {
      context.error(`[scan_logs] read failed: ${error.message}`);
      return { status: 500, jsonBody: { success: false, error: error.message } };
    }
  };
}

const listScanLogsHandler = createListScanLogsHandler();

app.http('listScanLogs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'scan-logs',
  handler: listScanLogsHandler,
});

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  createListScanLogsHandler,
  parsePageSize,
};
