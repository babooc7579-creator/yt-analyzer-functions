const assert = require('assert');
const {
  DISCOVERY_LINK_DOC_TYPE,
  applyDiscoveryLinkUpdates,
  getPartitionKey,
  inferPlatform,
  normalizeUrl,
  toClientDiscoveryLink,
  toDiscoveryLinkDocument,
} = require('../src/functions/discoveryLinks');

const now = '2026-07-02T00:00:00.000Z';

assert.deepStrictEqual(
  normalizeUrl(' https://www.instagram.com/reel/abc123/#comments '),
  {
    url: 'https://www.instagram.com/reel/abc123/#comments',
    normalizedUrl: 'https://www.instagram.com/reel/abc123/',
  },
  'normalizeUrl should trim URL input and remove hash fragments'
);

assert.strictEqual(
  normalizeUrl('ftp://example.com/video').error,
  'url must use http or https.',
  'only http and https URLs should be accepted'
);

assert.strictEqual(inferPlatform('https://youtu.be/abc123'), 'youtube', 'YouTube short URLs should be detected');
assert.strictEqual(inferPlatform('https://www.instagram.com/reel/abc123/'), 'instagram', 'Instagram URLs should be detected');
assert.strictEqual(inferPlatform('https://example.com/story'), 'web', 'generic URLs should be web');

const document = toDiscoveryLinkDocument(
  {
    url: 'https://www.instagram.com/reel/abc123/',
    title: '  좋은 소재  ',
    memo: '  군무 포인트  ',
    status: 'candidate',
    rightsStatus: 'needs_check',
    linkedVideoId: '  yt-1  ',
  },
  'default',
  now
);

assert.strictEqual(document.docType, DISCOVERY_LINK_DOC_TYPE, 'document should use discovery_link docType');
assert.strictEqual(document.channelId, getPartitionKey('default'), 'channelId should be the discovery partition key');
assert.strictEqual(document.platform, 'instagram', 'platform should be inferred from the URL');
assert.strictEqual(document.title, '좋은 소재', 'title should be trimmed');
assert.strictEqual(document.memo, '군무 포인트', 'memo should be trimmed');
assert.strictEqual(document.status, 'candidate', 'valid status should be preserved');
assert.strictEqual(document.rightsStatus, 'needs_check', 'valid rightsStatus should be preserved');
assert.strictEqual(document.linkedVideoId, 'yt-1', 'linkedVideoId should be trimmed');
assert.strictEqual(document.createdAt, now, 'createdAt should use the provided timestamp');
assert.strictEqual(document.updatedAt, now, 'updatedAt should use the provided timestamp');
assert.ok(document.id.startsWith('default:'), 'id should be scoped to userId');

const fallbackDocument = toDiscoveryLinkDocument(
  {
    url: 'https://example.com/story',
    platform: 'invalid',
    status: 'invalid',
    rightsStatus: 'invalid',
  },
  'default',
  now
);

assert.strictEqual(fallbackDocument.platform, 'web', 'invalid platform should fall back to URL inference');
assert.strictEqual(fallbackDocument.status, 'inbox', 'invalid status should fall back to inbox');
assert.strictEqual(fallbackDocument.rightsStatus, 'unknown', 'invalid rightsStatus should fall back to unknown');

const updatedDocument = applyDiscoveryLinkUpdates(
  document,
  {
    url: 'https://www.youtube.com/watch?v=abc123#section',
    memo: '새 메모',
    status: 'saved',
    rightsStatus: 'cleared',
  },
  '2026-07-02T01:00:00.000Z'
);

assert.strictEqual(updatedDocument.normalizedUrl, 'https://www.youtube.com/watch?v=abc123', 'updated URL should be normalized');
assert.strictEqual(updatedDocument.platform, 'youtube', 'platform should be re-inferred when URL changes');
assert.strictEqual(updatedDocument.memo, '새 메모', 'memo should update');
assert.strictEqual(updatedDocument.status, 'saved', 'status should update');
assert.strictEqual(updatedDocument.rightsStatus, 'cleared', 'rightsStatus should update');
assert.strictEqual(updatedDocument.updatedAt, '2026-07-02T01:00:00.000Z', 'updatedAt should refresh');

const clientDocument = toClientDiscoveryLink(document);
assert.strictEqual(clientDocument.docType, undefined, 'client document should not expose docType');
assert.strictEqual(clientDocument.userId, undefined, 'client document should not expose userId');
assert.strictEqual(clientDocument.channelId, undefined, 'client document should not expose partition channelId');

assert.strictEqual(
  toDiscoveryLinkDocument({}, 'default', now).error,
  'url is required.',
  'documents without URL should fail validation'
);

console.log('discovery link tests passed.');
