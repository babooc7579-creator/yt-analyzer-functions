const assert = require('assert');

const {
  BULK_CHANNEL_BATCH_SIZE,
  MAX_BULK_CHANNELS,
  handleBulkAddChannels,
  normalizeBulkChannelHandles,
  withChannelOperationalDefaults,
} = require('../src/functions/channels');

function makeRequest(body) {
  return { json: async () => body };
}

function makeContext() {
  return { error: () => {} };
}

function makeChannelInfo(handle) {
  const id = handle.includes('same') ? 'same-channel' : handle.replace(/\W/g, '') || 'channel';
  return {
    id,
    title: `채널 ${handle}`,
    thumbnail: '',
    uploadsId: `uploads-${id}`,
    stats: { subscriberCount: 10 },
  };
}

async function run() {
  assert.strictEqual(MAX_BULK_CHANNELS, 50);
  assert.strictEqual(BULK_CHANNEL_BATCH_SIZE, 10);
  assert.strictEqual(
    withChannelOperationalDefaults({ id: 'new-channel' }).collectionMode,
    'manual',
    '새 채널 등록은 자동 수집 승인이 아니라 수동 수집 대기 상태여야 합니다.',
  );
  assert.deepStrictEqual(
    normalizeBulkChannelHandles([' @one ', '', '@one', '@two']),
    ['@one', '@two'],
    '빈 줄과 같은 입력은 API 실행 전에 제거해야 합니다.',
  );

  const tooMany = await handleBulkAddChannels(
    makeRequest({ handles: Array.from({ length: 51 }, (_, index) => `@channel-${index}`) }),
    makeContext(),
  );
  assert.strictEqual(tooMany.status, 400);
  assert.match(tooMany.jsonBody.error, /최대 50개/);

  const upserts = [];
  let activeLookups = 0;
  let maxActiveLookups = 0;
  const container = {
    items: {
      readAll: () => ({ fetchAll: async () => ({ resources: [{ id: 'existing', title: '기존 채널' }] }) }),
      upsert: async (channel) => { upserts.push(channel); },
    },
  };
  const handles = [
    'existing',
    'same-one',
    'same-two',
    ...Array.from({ length: 18 }, (_, index) => `new-${index}`),
    'broken',
  ];
  const result = await handleBulkAddChannels(
    makeRequest({ handles, tags: ['중요'], language: 'KO' }),
    makeContext(),
    {
      getContainer: () => container,
      fetchChannelInfo: async (handle) => {
        activeLookups += 1;
        maxActiveLookups = Math.max(maxActiveLookups, activeLookups);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeLookups -= 1;
        if (handle === 'broken') throw new Error('확인 실패');
        return makeChannelInfo(handle);
      },
    },
  );

  assert.strictEqual(result.jsonBody.success, true);
  assert.strictEqual(result.jsonBody.total, handles.length);
  assert.strictEqual(result.jsonBody.added, 19);
  assert.strictEqual(result.jsonBody.existing, 1);
  assert.strictEqual(result.jsonBody.duplicate, 1);
  assert.strictEqual(result.jsonBody.failed, 1);
  assert.strictEqual(result.jsonBody.batchSize, 10);
  assert.strictEqual(result.jsonBody.processedBatches, 3);
  assert.ok(maxActiveLookups <= 10, '동시에 확인하는 채널은 10개를 넘지 않아야 합니다.');
  assert.strictEqual(upserts.length, 19, '기존 채널과 같은 요청의 중복 채널은 다시 저장하지 않아야 합니다.');
  assert.ok(upserts.every((channel) => channel.category === '중요' && channel.language === 'KO'));
  assert.strictEqual(upserts.some((channel) => channel.id === 'existing'), false);

  console.log('channelsBulk tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
