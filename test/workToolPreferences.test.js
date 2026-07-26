const assert = require('assert');
const {
  WORK_TOOL_PREFERENCES_DOC_TYPE,
  getDocumentId,
  getPartitionKey,
  normalizeCustomTool,
  normalizePreferences,
  normalizeStringList,
  toClientPreferences,
  toPreferencesDocument,
} = require('../src/functions/workToolPreferences');

const now = '2026-07-26T12:00:00.000Z';

assert.deepStrictEqual(
  normalizeStringList(['youtube-search', ' youtube-search ', '', null, 'google-trends']),
  ['youtube-search', 'google-trends'],
  'string lists should be trimmed and deduplicated'
);

assert.deepStrictEqual(
  normalizeCustomTool({
    id: ' custom-tool ',
    label: ' 내 분석 도구 ',
    description: ' 매일 확인 ',
    href: 'https://example.com/path',
    groupId: ' operations ',
  }),
  {
    id: 'custom-tool',
    label: '내 분석 도구',
    description: '매일 확인',
    href: 'https://example.com/path',
    groupId: 'operations',
    badge: '개인 도구',
  },
  'custom tools should normalize editable fields'
);

assert.strictEqual(
  normalizeCustomTool({ label: '위험한 주소', href: 'javascript:alert(1)' }).error,
  'url must use http or https.',
  'custom tools should reject unsafe URL protocols'
);

assert.strictEqual(
  normalizePreferences({
    customTools: [
      { id: 'duplicate', label: '도구 1', href: 'https://example.com/1' },
      { id: 'duplicate', label: '도구 2', href: 'https://example.com/2' },
    ],
  }).error,
  'custom tool ids must be unique.',
  'custom tool ids should remain unique'
);

const document = toPreferencesDocument(
  {
    customTools: [
      {
        id: 'custom-keyword-tool',
        label: '키워드 도구',
        href: 'https://example.com/keyword',
        description: '개인 조사 도구',
        groupId: 'keyword-research',
        badge: '매일 확인',
      },
    ],
    hiddenDefaultToolIds: ['naver-search-ad', 'naver-search-ad'],
    toolOrder: ['custom-keyword-tool', 'google-trends'],
  },
  'default',
  now
);

assert.strictEqual(document.docType, WORK_TOOL_PREFERENCES_DOC_TYPE, 'document should use work tool preferences docType');
assert.strictEqual(document.id, getDocumentId('default'), 'document id should be stable per user');
assert.strictEqual(document.channelId, getPartitionKey('default'), 'document should use an isolated partition key');
assert.deepStrictEqual(document.hiddenDefaultToolIds, ['naver-search-ad'], 'hidden defaults should be deduplicated');
assert.deepStrictEqual(document.toolOrder, ['custom-keyword-tool', 'google-trends'], 'tool order should be preserved');
assert.strictEqual(document.updatedAt, now, 'updatedAt should use the provided time');

assert.deepStrictEqual(
  toClientPreferences(document),
  {
    customTools: document.customTools,
    hiddenDefaultToolIds: ['naver-search-ad'],
    toolOrder: ['custom-keyword-tool', 'google-trends'],
    updatedAt: now,
  },
  'client preferences should not expose storage fields'
);

assert.deepStrictEqual(
  toClientPreferences(),
  {
    customTools: [],
    hiddenDefaultToolIds: [],
    toolOrder: [],
    updatedAt: '',
  },
  'missing documents should return safe empty preferences'
);

console.log('work tool preferences tests passed.');
