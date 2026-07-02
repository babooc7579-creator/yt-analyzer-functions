const { app } = require('@azure/functions');
const { randomUUID } = require('crypto');
const { getVideosContainer } = require('../shared/cosmosClient');

const DEFAULT_USER_ID = 'default';
const DISCOVERY_LINK_DOC_TYPE = 'discovery_link';
const DISCOVERY_LINK_STATUSES = new Set(['inbox', 'reviewing', 'saved', 'candidate', 'discarded']);
const DISCOVERY_LINK_RIGHTS_STATUSES = new Set(['unknown', 'needs_check', 'cleared', 'do_not_use']);
const DISCOVERY_LINK_PLATFORMS = new Set(['youtube', 'instagram', 'tiktok', 'web', 'unknown']);

function getUserId(request) {
  return request.query.get('userId') || DEFAULT_USER_ID;
}

function getPartitionKey(userId) {
  return `__discovery_links_${userId}`;
}

function createDiscoveryLinkId(userId) {
  return `${userId}:${randomUUID()}`;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUrl(rawUrl) {
  const url = normalizeText(rawUrl);
  if (!url) return { error: 'url is required.' };

  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { error: 'url must use http or https.' };
    }
    parsedUrl.hash = '';
    return { url, normalizedUrl: parsedUrl.toString() };
  } catch {
    return { error: 'url must be a valid URL.' };
  }
}

function inferPlatform(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname.includes('tiktok.com')) return 'tiktok';
    return 'web';
  } catch {
    return 'unknown';
  }
}

function normalizeEnum(value, allowedValues, fallback) {
  const normalized = normalizeText(value);
  return allowedValues.has(normalized) ? normalized : fallback;
}

function toClientDiscoveryLink(document) {
  const { docType, userId, channelId, ...link } = document;
  return link;
}

function toDiscoveryLinkDocument(input, userId, now = new Date().toISOString()) {
  const normalizedUrl = normalizeUrl(input?.url);
  if (normalizedUrl.error) return { error: normalizedUrl.error };

  const platformInput = normalizeText(input?.platform);
  const platform = DISCOVERY_LINK_PLATFORMS.has(platformInput)
    ? platformInput
    : inferPlatform(normalizedUrl.normalizedUrl);

  return {
    id: createDiscoveryLinkId(userId),
    docType: DISCOVERY_LINK_DOC_TYPE,
    userId,
    channelId: getPartitionKey(userId),
    url: normalizedUrl.url,
    normalizedUrl: normalizedUrl.normalizedUrl,
    platform,
    title: normalizeText(input?.title),
    memo: normalizeText(input?.memo),
    status: normalizeEnum(input?.status, DISCOVERY_LINK_STATUSES, 'inbox'),
    rightsStatus: normalizeEnum(input?.rightsStatus, DISCOVERY_LINK_RIGHTS_STATUSES, 'unknown'),
    linkedVideoId: normalizeText(input?.linkedVideoId),
    createdAt: now,
    updatedAt: now,
  };
}

function applyDiscoveryLinkUpdates(existingDocument, updates = {}, now = new Date().toISOString()) {
  const document = { ...existingDocument };

  if (hasOwn(updates, 'url')) {
    const normalizedUrl = normalizeUrl(updates.url);
    if (normalizedUrl.error) return { error: normalizedUrl.error };
    document.url = normalizedUrl.url;
    document.normalizedUrl = normalizedUrl.normalizedUrl;
    if (!hasOwn(updates, 'platform')) {
      document.platform = inferPlatform(normalizedUrl.normalizedUrl);
    }
  }

  if (hasOwn(updates, 'platform')) {
    document.platform = normalizeEnum(updates.platform, DISCOVERY_LINK_PLATFORMS, document.platform || 'unknown');
  }
  if (hasOwn(updates, 'title')) {
    document.title = normalizeText(updates.title);
  }
  if (hasOwn(updates, 'memo')) {
    document.memo = normalizeText(updates.memo);
  }
  if (hasOwn(updates, 'status')) {
    document.status = normalizeEnum(updates.status, DISCOVERY_LINK_STATUSES, document.status || 'inbox');
  }
  if (hasOwn(updates, 'rightsStatus')) {
    document.rightsStatus = normalizeEnum(updates.rightsStatus, DISCOVERY_LINK_RIGHTS_STATUSES, document.rightsStatus || 'unknown');
  }
  if (hasOwn(updates, 'linkedVideoId')) {
    document.linkedVideoId = normalizeText(updates.linkedVideoId);
  }

  document.updatedAt = now;
  return document;
}

app.http('listDiscoveryLinks', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'discovery-links',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const partitionKey = getPartitionKey(userId);
      const container = getVideosContainer();
      const { resources } = await container.items
        .query(
          {
            query: 'SELECT * FROM c WHERE c.docType = @docType AND c.userId = @userId ORDER BY c.createdAt DESC',
            parameters: [
              { name: '@docType', value: DISCOVERY_LINK_DOC_TYPE },
              { name: '@userId', value: userId },
            ],
          },
          { partitionKey }
        )
        .fetchAll();

      return { jsonBody: { success: true, links: resources.map(toClientDiscoveryLink) } };
    } catch (err) {
      context.error(`[discovery-links list] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

app.http('createDiscoveryLink', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'discovery-links',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const body = await request.json();
      const now = new Date().toISOString();
      const document = toDiscoveryLinkDocument(body, userId, now);
      if (document.error) {
        return { status: 400, jsonBody: { success: false, error: document.error } };
      }

      const container = getVideosContainer();
      await container.items.upsert(document, { partitionKey: getPartitionKey(userId) });
      return { jsonBody: { success: true, link: toClientDiscoveryLink(document) } };
    } catch (err) {
      context.error(`[discovery-links create] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

app.http('updateDiscoveryLink', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'discovery-links/{id}',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const id = normalizeText(request.params.id);
      if (!id) {
        return { status: 400, jsonBody: { success: false, error: 'id is required.' } };
      }

      const partitionKey = getPartitionKey(userId);
      const container = getVideosContainer();
      const { resource } = await container.item(id, partitionKey).read();
      if (!resource || resource.docType !== DISCOVERY_LINK_DOC_TYPE || resource.userId !== userId) {
        return { status: 404, jsonBody: { success: false, error: 'discovery link not found.' } };
      }

      const updates = await request.json();
      const document = applyDiscoveryLinkUpdates(resource, updates, new Date().toISOString());
      if (document.error) {
        return { status: 400, jsonBody: { success: false, error: document.error } };
      }

      await container.items.upsert(document, { partitionKey });
      return { jsonBody: { success: true, link: toClientDiscoveryLink(document) } };
    } catch (err) {
      if (err.code === 404) {
        return { status: 404, jsonBody: { success: false, error: 'discovery link not found.' } };
      }
      context.error(`[discovery-links update] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

app.http('deleteDiscoveryLink', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'discovery-links/{id}',
  handler: async (request, context) => {
    try {
      const userId = getUserId(request);
      const id = normalizeText(request.params.id);
      if (!id) {
        return { status: 400, jsonBody: { success: false, error: 'id is required.' } };
      }

      await getVideosContainer().item(id, getPartitionKey(userId)).delete();
      return { jsonBody: { success: true, id } };
    } catch (err) {
      if (err.code === 404) return { jsonBody: { success: true } };
      context.error(`[discovery-links delete] error: ${err.message}`);
      return { status: 500, jsonBody: { success: false, error: err.message } };
    }
  },
});

module.exports = {
  DISCOVERY_LINK_DOC_TYPE,
  applyDiscoveryLinkUpdates,
  getPartitionKey,
  inferPlatform,
  normalizeUrl,
  toClientDiscoveryLink,
  toDiscoveryLinkDocument,
};
