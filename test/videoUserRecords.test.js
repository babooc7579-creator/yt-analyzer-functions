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

assert.deepStrictEqual(
  {
    scriptAnalysis: toClientRecord({
      videoId: 'legacy-video',
      status: 'production_candidate',
    }).scriptAnalysis,
    scriptBody: toClientRecord({
      videoId: 'legacy-video',
      status: 'production_candidate',
    }).scriptBody,
    scriptOutline: toClientRecord({
      videoId: 'legacy-video',
      status: 'production_candidate',
    }).scriptOutline,
    scriptStatus: toClientRecord({
      videoId: 'legacy-video',
      status: 'production_candidate',
    }).scriptStatus,
  },
  {
    scriptAnalysis: '',
    scriptBody: '',
    scriptOutline: '',
    scriptStatus: '',
  },
  'old records without structured script fields should return empty values'
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
  scriptAnalysis: '기존 분석',
  scriptBody: '기존 대본 본문',
  scriptOutline: '기존 구성안',
  scriptStatus: 'draft',
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
assert.deepStrictEqual(
  {
    scriptAnalysis: preservedDocument.scriptAnalysis,
    scriptBody: preservedDocument.scriptBody,
    scriptOutline: preservedDocument.scriptOutline,
    scriptStatus: preservedDocument.scriptStatus,
  },
  {
    scriptAnalysis: '기존 분석',
    scriptBody: '기존 대본 본문',
    scriptOutline: '기존 구성안',
    scriptStatus: 'draft',
  },
  'old clients should not erase structured script fields when saving another record value'
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

const structuredScriptDocument = toRecordDocument(
  {
    videoId: 'video-2',
    status: 'production_candidate',
    scriptAnalysis: '  핵심 소재 분석  ',
    scriptBody: '  최종 대본 본문  ',
    scriptOutline: '  도입 → 전개 → 마무리  ',
    scriptStatus: '  revision  ',
  },
  'default',
  now,
  existingDocument
);

assert.deepStrictEqual(
  {
    scriptAnalysis: structuredScriptDocument.scriptAnalysis,
    scriptBody: structuredScriptDocument.scriptBody,
    scriptOutline: structuredScriptDocument.scriptOutline,
    scriptStatus: structuredScriptDocument.scriptStatus,
  },
  {
    scriptAnalysis: '핵심 소재 분석',
    scriptBody: '최종 대본 본문',
    scriptOutline: '도입 → 전개 → 마무리',
    scriptStatus: 'revision',
  },
  'structured script fields should be normalized and saved explicitly'
);

const clearedScriptDocument = toRecordDocument(
  {
    videoId: 'video-2',
    status: 'production_candidate',
    scriptAnalysis: '',
    scriptBody: '',
    scriptOutline: '',
    scriptStatus: '',
  },
  'default',
  now,
  existingDocument
);

assert.deepStrictEqual(
  {
    scriptAnalysis: clearedScriptDocument.scriptAnalysis,
    scriptBody: clearedScriptDocument.scriptBody,
    scriptOutline: clearedScriptDocument.scriptOutline,
    scriptStatus: clearedScriptDocument.scriptStatus,
  },
  {
    scriptAnalysis: '',
    scriptBody: '',
    scriptOutline: '',
    scriptStatus: '',
  },
  'explicit empty structured script values should clear those fields'
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
