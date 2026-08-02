const assert = require('assert');
const {
  handleYoutubeChannelSearch,
  normalizeYoutubeChannelSearchQuery,
} = require('../src/functions/youtubeChannelSearch');
const { searchYoutubeChannels } = require('../src/shared/youtube');

function query(values = {}) {
  const params = new URLSearchParams(values);
  return { get: (key) => params.get(key) };
}

assert.strictEqual(
  normalizeYoutubeChannelSearchQuery(query()).error,
  '검색 키워드를 입력해 주세요.',
  'empty searches should be rejected before calling YouTube'
);
assert.deepStrictEqual(
  normalizeYoutubeChannelSearchQuery(query({ q: ' 바이브 코딩 ', maxResults: '50', regionCode: 'kr', relevanceLanguage: 'ko' })),
  { query: '바이브 코딩', maxResults: 25, regionCode: 'KR', relevanceLanguage: 'ko', pageToken: '' },
  'channel search options should be normalized and capped at 25'
);

const calls = [];
process.env.YOUTUBE_API_KEY = 'test-key';
const fakeFetch = async (url) => {
  calls.push(url);
  if (url.includes('/search?')) {
    return {
      ok: true,
      json: async () => ({ nextPageToken: 'next-channel', items: [{ id: { channelId: 'channel-1' } }] }),
    };
  }
  return {
    ok: true,
    json: async () => ({
      items: [{
        id: 'channel-1',
        snippet: {
          title: '아이디어 채널',
          description: '아이디어를 찾는 채널',
          customUrl: '@idea',
          publishedAt: '2024-01-01T00:00:00Z',
          thumbnails: { high: { url: 'channel.jpg' } },
          country: 'KR',
        },
        statistics: { subscriberCount: '2000', videoCount: '100', viewCount: '1000000' },
        contentDetails: { relatedPlaylists: { uploads: 'uploads-1' } },
      }],
    }),
  };
};

(async () => {
  const result = await searchYoutubeChannels({ query: '아이디어', maxResults: 12 }, fakeFetch);
  assert.strictEqual(calls.length, 2, 'one channel search action should use search and channel detail requests');
  assert.strictEqual(result.items[0].channelId, 'channel-1');
  assert.strictEqual(result.items[0].avgViewCount, 10000);
  assert.strictEqual(result.items[0].url, 'https://www.youtube.com/channel/channel-1');
  assert.strictEqual(result.nextPageToken, 'next-channel');

  let receivedOptions = null;
  const response = await handleYoutubeChannelSearch(
    { query: query({ q: '경제', maxResults: '12' }) },
    { error: () => {} },
    { searchYoutubeChannels: async (options) => {
      receivedOptions = options;
      return { items: [], resultCount: 0, nextPageToken: '', prevPageToken: '' };
    } }
  );
  assert.strictEqual(response.jsonBody.success, true);
  assert.strictEqual(response.jsonBody.saved, false, 'search results must remain temporary');
  assert.strictEqual(response.jsonBody.snapshot, true, 'channel metrics must be identified as a point-in-time snapshot');
  assert.strictEqual(receivedOptions.query, '경제');
  console.log('youtube channel search tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
