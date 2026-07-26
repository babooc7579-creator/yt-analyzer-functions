const assert = require('assert');
const {
  MAX_PAGE_SIZE,
  createListVideosHandler,
  parsePaginationParams,
} = require('../src/functions/videos');

const createRequest = (query = '') => ({
  query: new URLSearchParams(query),
});

const context = {
  error: () => {},
};

assert.deepStrictEqual(
  parsePaginationParams(new URLSearchParams('')),
  { paged: false },
  'requests without pageSize should preserve the legacy full lookup'
);

assert.deepStrictEqual(
  parsePaginationParams(new URLSearchParams('pageSize=200&continuationToken=next-token')),
  {
    continuationToken: 'next-token',
    pageSize: 200,
    paged: true,
  },
  'paged requests should preserve the requested page size and continuation token'
);

assert.strictEqual(
  parsePaginationParams(new URLSearchParams('pageSize=0')).error,
  `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.`,
  'pageSize below the supported range should be rejected'
);

assert.strictEqual(
  parsePaginationParams(new URLSearchParams(`pageSize=${MAX_PAGE_SIZE + 1}`)).error,
  `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}.`,
  'pageSize above the supported range should be rejected'
);

assert.strictEqual(
  parsePaginationParams(new URLSearchParams('continuationToken=next-token')).error,
  'pageSize is required when continuationToken is provided.',
  'continuation tokens should not be accepted without pageSize'
);

async function run() {
  let legacyQuery;
  const legacyHandler = createListVideosHandler({
    getContainer: () => ({
      items: {
        query: (query) => {
          legacyQuery = query;
          return {
            fetchAll: async () => ({
              resources: [{ id: 'video-1', channelId: 'channel-1' }],
            }),
          };
        },
      },
    }),
  });

  const legacyResponse = await legacyHandler(
    createRequest('channelIds=channel-1,channel-2'),
    context
  );

  assert.deepStrictEqual(
    legacyResponse.jsonBody,
    {
      success: true,
      videos: [{ id: 'video-1', channelId: 'channel-1' }],
    },
    'legacy requests should keep the existing response shape'
  );
  assert.deepStrictEqual(
    legacyQuery.parameters.find(({ name }) => name === '@channelIds').value,
    ['channel-1', 'channel-2'],
    'channelIds should remain the query boundary'
  );
  assert.strictEqual(
    legacyQuery.parameters.find(({ name }) => name === '@videoDocType').value,
    'video',
    'discovery links and other document types should stay outside the videos response'
  );

  let pagedQueryOptions;
  const pagedHandler = createListVideosHandler({
    getContainer: () => ({
      items: {
        query: (_query, options) => {
          pagedQueryOptions = options;
          return {
            fetchNext: async () => ({
              continuationToken: 'next-token',
              resources: [{ id: 'video-2', channelId: 'channel-1' }],
            }),
          };
        },
      },
    }),
  });

  const pagedResponse = await pagedHandler(
    createRequest('channelIds=channel-1&pageSize=200&continuationToken=current-token'),
    context
  );

  assert.deepStrictEqual(
    pagedQueryOptions,
    {
      continuationToken: 'current-token',
      maxItemCount: 200,
    },
    'paged requests should pass Cosmos query paging options without changing the query'
  );
  assert.deepStrictEqual(
    pagedResponse.jsonBody,
    {
      continuationToken: 'next-token',
      hasMore: true,
      success: true,
      videos: [{ id: 'video-2', channelId: 'channel-1' }],
    },
    'paged requests should return videos and the next continuation token'
  );

  const finalPageHandler = createListVideosHandler({
    getContainer: () => ({
      items: {
        query: () => ({
          fetchNext: async () => ({
            continuationToken: undefined,
            resources: [],
          }),
        }),
      },
    }),
  });

  const finalPageResponse = await finalPageHandler(
    createRequest('channelIds=channel-1&pageSize=200'),
    context
  );

  assert.deepStrictEqual(
    finalPageResponse.jsonBody,
    {
      continuationToken: null,
      hasMore: false,
      success: true,
      videos: [],
    },
    'the final page should explicitly report that no more pages remain'
  );

  const invalidResponse = await pagedHandler(
    createRequest('channelIds=channel-1&pageSize=not-a-number'),
    context
  );

  assert.strictEqual(invalidResponse.status, 400, 'invalid page sizes should return HTTP 400');
  assert.strictEqual(
    invalidResponse.jsonBody.success,
    false,
    'invalid page sizes should never be reported as a successful lookup'
  );
}

run()
  .then(() => {
    console.log('videos pagination tests passed.');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
