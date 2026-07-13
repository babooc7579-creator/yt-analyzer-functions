const assert = require('assert');
const {
  getRecordStatusIds,
  normalizeStatusIds,
  toClientRecord,
  toRecordDocument,
} = require('../src/functions/videoUserRecords');

const now = '2026-07-02T00:00:00.000Z';

assert.deepStrictEqual(
  normalizeStatusIds(['production_candidate', 'used', 'production_candidate', '  reference_material  ', '', null]),
  ['production_candidate', 'used', 'reference_material'],
  'statusIds should be trimmed, deduped, and limited to non-empty strings'
);

assert.deepStrictEqual(
  getRecordStatusIds({ statusIds: ['reference_material'] }, 'used'),
  ['reference_material', 'used'],
  'fallback status should be included when statusIds does not already contain it'
);

assert.deepStrictEqual(
  toClientRecord({
    id: 'default:video-1',
    docType: 'video_user_record',
    userId: 'default',
    channelId: '__video_user_records_default',
    videoId: 'video-1',
    status: 'used',
  }).statusIds,
  ['used'],
  'old records without statusIds should return a statusIds fallback'
);

assert.strictEqual(
  toClientRecord({
    id: 'default:video-1',
    docType: 'video_user_record',
    userId: 'default',
    channelId: '__video_user_records_default',
    videoId: 'video-1',
    status: 'used',
  }).focusPinnedAt,
  '',
  'old records without focusPinnedAt should return an empty focus value'
);

const existingDocument = {
  id: 'default:video-2',
  docType: 'video_user_record',
  userId: 'default',
  channelId: '__video_user_records_default',
  videoId: 'video-2',
  status: 'reference_material',
  statusIds: ['reference_material', 'production_candidate'],
  focusPinnedAt: '2026-07-01T09:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const preservedDocument = toRecordDocument(
  {
    videoId: 'video-2',
    status: 'used',
    note: 'updated note',
  },
  'default',
  now,
  existingDocument
);

assert.deepStrictEqual(
  preservedDocument.statusIds,
  ['reference_material', 'production_candidate', 'used'],
  'saving without statusIds should preserve existing statusIds and include the current status'
);
assert.strictEqual(preservedDocument.status, 'used', 'representative status should remain unchanged');
assert.strictEqual(
  preservedDocument.focusPinnedAt,
  '2026-07-01T09:00:00.000Z',
  'saving without focusPinnedAt should preserve the existing focus pin'
);

const focusedDocument = toRecordDocument(
  {
    videoId: 'video-2',
    status: 'production_candidate',
    focusPinnedAt: ' 2026-07-02T09:30:00.000Z ',
  },
  'default',
  now,
  existingDocument
);

assert.strictEqual(
  focusedDocument.focusPinnedAt,
  '2026-07-02T09:30:00.000Z',
  'an explicit focus pin should be normalized and saved'
);

const unfocusedDocument = toRecordDocument(
  {
    videoId: 'video-2',
    status: 'production_candidate',
    focusPinnedAt: '',
  },
  'default',
  now,
  existingDocument
);

assert.strictEqual(
  unfocusedDocument.focusPinnedAt,
  '',
  'an explicit empty focus value should clear the focus pin'
);

const explicitStatusIdsDocument = toRecordDocument(
  {
    videoId: 'video-3',
    status: 'used',
    statusIds: ['used', 'used', 'exclude', ''],
  },
  'default',
  now
);

assert.deepStrictEqual(
  explicitStatusIdsDocument.statusIds,
  ['used', 'exclude'],
  'explicit statusIds should be normalized before saving'
);
assert.strictEqual(explicitStatusIdsDocument.status, 'used', 'status should stay as the representative status');

assert.strictEqual(
  toRecordDocument({}, 'default', now).error,
  'videoId is required.',
  'records without videoId should still fail validation'
);

console.log('video user record statusIds tests passed.');
