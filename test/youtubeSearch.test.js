const assert = require('assert');
const { handleYoutubeVideoSearch, normalizeYoutubeSearchQuery } = require('../src/functions/youtubeSearch');
const { searchYoutubeVideos } = require('../src/shared/youtube');

function query(values = {}) {
  const params = new URLSearchParams(values);
  return { get: (key) => params.get(key) };
}

assert.strictEqual(
  normalizeYoutubeSearchQuery(query()).error,
  '검색 키워드를 입력해 주세요.',
  'empty searches should be rejected before calling YouTube'
);

assert.deepStrictEqual(
  normalizeYoutubeSearchQuery(query({
    q: ' 바이브 코딩 ',
    maxResults: '100',
    order: 'viewCount',
    videoDuration: 'medium',
    regionCode: 'kr',
    relevanceLanguage: 'ko',
  })),
  {
    query: '바이브 코딩',
    maxResults: 50,
    order: 'viewCount',
    videoDuration: 'medium',
    regionCode: 'KR',
    relevanceLanguage: 'ko',
    pageToken: '',
    publishedAfter: '',
    publishedBefore: '',
  },
  'supported search filters should be normalized and result count capped at 50'
);

const calls = [];
process.env.YOUTUBE_API_KEY = 'test-key';
const fakeFetch = async (url) => {
  calls.push(url);
  if (url.includes('/search?')) {
    return {
      ok: true,
      json: async () => ({
        nextPageToken: 'next-1',
        items: [{ id: { videoId: 'video-1' } }],
      }),
    };
  }
  if (url.includes('/videos?')) {
    return {
      ok: true,
      json: async () => ({
        items: [{
          id: 'video-1',
          snippet: {
            title: '아이디어 영상',
            channelId: 'channel-1',
            channelTitle: '아이디어 채널',
            publishedAt: '2026-08-01T00:00:00Z',
            thumbnails: { high: { url: 'video.jpg' } },
          },
          statistics: { viewCount: '10000', likeCount: '500', commentCount: '30' },
          contentDetails: { duration: 'PT8M3S' },
        }],
      }),
    };
  }
  return {
    ok: true,
    json: async () => ({
      items: [{
        id: 'channel-1',
        snippet: { title: '아이디어 채널', thumbnails: { default: { url: 'channel.jpg' } } },
        statistics: { subscriberCount: '2000', hiddenSubscriberCount: false },
      }],
    }),
  };
};

(async () => {
  const result = await searchYoutubeVideos({ query: '아이디어', maxResults: 25 }, fakeFetch);
  assert.strictEqual(calls.length, 3, 'one search action should enrich videos and channels in three API requests');
  assert.strictEqual(result.items[0].videoId, 'video-1');
  assert.strictEqual(result.items[0].duration, '08:03');
  assert.strictEqual(result.items[0].viralRatio, 500, 'viral ratio should be an explicit app-calculated estimate');
  assert.strictEqual(result.items[0].url, 'https://www.youtube.com/watch?v=video-1');
  assert.strictEqual(result.nextPageToken, 'next-1');

  let receivedOptions = null;
  const response = await handleYoutubeVideoSearch(
    { query: query({ q: '경제', maxResults: '25' }) },
    { error: () => {} },
    { searchYoutubeVideos: async (options) => {
      receivedOptions = options;
      return { items: [], resultCount: 0, nextPageToken: '', prevPageToken: '' };
    } }
  );
  assert.strictEqual(response.jsonBody.success, true);
  assert.strictEqual(response.jsonBody.saved, false, 'search results must stay temporary until the user saves them');
  assert.strictEqual(receivedOptions.query, '경제');
  console.log('youtube search tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
