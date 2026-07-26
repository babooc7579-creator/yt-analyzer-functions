const { app } = require('@azure/functions');
const { randomUUID } = require('crypto');
const { getVideosContainer } = require('../shared/cosmosClient');

const DEFAULT_USER_ID = 'default';
const WORK_TOOL_PREFERENCES_DOC_TYPE = 'work_tool_preferences';
const MAX_CUSTOM_TOOLS = 100;

function getUserId(request) {
  return request.query.get('userId') || DEFAULT_USER_ID;
}

function getPartitionKey(userId) {
  return `__work_tool_preferences_${userId}`;
}

function getDocumentId(userId) {
  return `${userId}:work-tool-preferences`;
}

function normalizeText(value, maxLength = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeStringList(values, maxItems = 200) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => normalizeText(value, 120)).filter(Boolean))].slice(0, maxItems);
}

function normalizeUrl(rawUrl) {
  const url = normalizeText(rawUrl, 2048);
  if (!url) return { error: 'url is required.' };

  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { error: 'url must use http or https.' };
    }
    return { url: parsedUrl.toString() };
  } catch {
    return { error: 'url must be a valid URL.' };
  }
}

function normalizeCustomTool(input = {}) {
  const normalizedUrl = normalizeUrl(input.href);
  if (normalizedUrl.error) return { error: normalizedUrl.error };

  const label = normalizeText(input.label, 80);
  if (!label) return { error: 'label is required.' };

  return {
    id: normalizeText(input.id, 120) || `custom-${randomUUID()}`,
    label,
    description: normalizeText(input.description, 240),
    href: normalizedUrl.url,
    groupId: normalizeText(input.groupId, 80) || 'personal',
    badge: normalizeText(input.badge, 40) || '개인 도구',
  };
}

function normalizePreferences(input = {}) {
  const customTools = [];
  const usedIds = new Set();

  for (const inputTool of Array.isArray(input.customTools) ? input.customTools.slice(0, MAX_CUSTOM_TOOLS) : []) {
    const tool = normalizeCustomTool(inputTool);
    if (tool.error) return { error: tool.error };
    if (usedIds.has(tool.id)) return { error: 'custom tool ids must be unique.' };
    usedIds.add(tool.id);
    customTools.push(tool);
  }

  return {
    customTools,
    hiddenDefaultToolIds: normalizeStringList(input.hiddenDefaultToolIds),
    toolOrder: normalizeStringList(input.toolOrder),
  };
}

function toClientPreferences(document = {}) {
  return {
    customTools: Array.isArray(document.customTools) ? document.customTools : [],
    hiddenDefaultToolIds: Array.isArray(document.hiddenDefaultToolIds) ? document.hiddenDefaultToolIds : [],
    toolOrder: Array.isArray(document.toolOrder) ? document.toolOrder : [],
    updatedAt: normalizeText(document.updatedAt, 80),
  };
}

function toPreferencesDocument(input, userId, now = new Date().toISOString()) {
  const preferences = normalizePreferences(input);
  if (preferences.error) return preferences;

  return {
    id: getDocumentId(userId),
    docType: WORK_TOOL_PREFERENCES_DOC_TYPE,
    userId,
    channelId: getPartitionKey(userId),
    ...preferences,
    updatedAt: now,
  };
}

app.http('workToolPreferences', {
  methods: ['GET', 'PUT'],
  authLevel: 'anonymous',
  route: 'work-tool-preferences',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const partitionKey = getPartitionKey(userId);
      const container = getVideosContainer();

      if (request.method === 'GET') {
        try {
          const { resource } = await container.item(getDocumentId(userId), partitionKey).read();
          return {
            jsonBody: {
              success: true,
              preferences: toClientPreferences(resource),
            },
          };
        } catch (err) {
          if (err.code === 404) {
            return {
              jsonBody: {
                success: true,
                preferences: toClientPreferences(),
              },
            };
          }
          throw err;
        }
      }

      const body = await request.json();
      const document = toPreferencesDocument(body, userId);
      if (document.error) {
        return { status: 400, jsonBody: { success: false, error: document.error } };
      }

      await container.items.upsert(document, { partitionKey });
      return {
        jsonBody: {
          success: true,
          preferences: toClientPreferences(document),
        },
      };
    } catch (err) {
      context.error(`[work-tool-preferences] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

module.exports = {
  WORK_TOOL_PREFERENCES_DOC_TYPE,
  getDocumentId,
  getPartitionKey,
  normalizeCustomTool,
  normalizePreferences,
  normalizeStringList,
  toClientPreferences,
  toPreferencesDocument,
};
