const LIMEN_BASE_URL = "https://limen.sh";

const REDDIT_HOSTS = new Set([
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "m.reddit.com",
  "np.reddit.com",
  "redd.it",
]);

const GOOGLE_REDIRECT_HOSTS = new Set(["google.com", "www.google.com"]);

const MAX_COMMENTS = 2000;
const MAX_COMMENT_DEPTH = 20;
const MORE_CHILDREN_BATCH = 100;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

function parseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function isWebUrl(urlObject) {
  return urlObject.protocol === "http:" || urlObject.protocol === "https:";
}

function getRedditPostId(urlObject) {
  if (urlObject.hostname === "redd.it") {
    const shortlinkId = urlObject.pathname.split("/").filter(Boolean)[0];
    return shortlinkId || null;
  }

  const match = urlObject.pathname.match(/\/comments\/([a-z0-9]+)/i);
  return match?.[1] || null;
}

function getResolvedRedditUrl(rawUrl) {
  const parsed = parseUrl(rawUrl);
  if (!parsed) return null;

  if (GOOGLE_REDIRECT_HOSTS.has(parsed.hostname)) {
    const redirected =
      parsed.searchParams.get("q") || parsed.searchParams.get("url");
    if (redirected) {
      return getResolvedRedditUrl(redirected);
    }
  }

  if (!REDDIT_HOSTS.has(parsed.hostname)) {
    return null;
  }

  return parsed;
}

function getRedirectTarget(rawUrl) {
  const resolvedRedditUrl = getResolvedRedditUrl(rawUrl);
  if (!resolvedRedditUrl) return null;

  const postId = getRedditPostId(resolvedRedditUrl);
  if (!postId) return null;

  return `${LIMEN_BASE_URL}/?url=${encodeURIComponent(resolvedRedditUrl.toString())}`;
}

function decodeHtmlEntities(input) {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function tryParseUrl(input) {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    return new URL(withProtocol);
  } catch {
    return null;
  }
}

function normalizeRedditUrl(input) {
  const directUrl = tryParseUrl(input);
  if (!directUrl) {
    throw new ValidationError("Please paste a valid URL.");
  }

  if (GOOGLE_REDIRECT_HOSTS.has(directUrl.hostname)) {
    const redirected =
      directUrl.searchParams.get("q") ?? directUrl.searchParams.get("url");
    if (redirected) {
      return normalizeRedditUrl(redirected);
    }
  }

  if (!REDDIT_HOSTS.has(directUrl.hostname)) {
    throw new ValidationError("Only Reddit post links are supported.");
  }

  const postIdFromCommentsPath = directUrl.pathname.match(
    /\/comments\/([a-z0-9]+)/i,
  )?.[1];
  const postIdFromShortLink =
    directUrl.hostname === "redd.it"
      ? directUrl.pathname.split("/").filter(Boolean)[0]
      : null;

  const postId = postIdFromCommentsPath ?? postIdFromShortLink;

  if (!postId) {
    throw new ValidationError("This URL does not look like a Reddit post URL.");
  }

  const canonicalUrl = `https://www.reddit.com/comments/${postId}`;
  const jsonEndpoint = `${canonicalUrl}.json?raw_json=1&sort=confidence&limit=500`;

  return {
    originalUrl: directUrl.toString(),
    canonicalUrl,
    jsonEndpoint,
  };
}

function extractPostMedia(postData) {
  const media = [];

  const mediaMetadata = postData.media_metadata;
  const galleryItems = postData.gallery_data?.items;

  if (Array.isArray(galleryItems) && mediaMetadata) {
    for (const item of galleryItems) {
      const mediaId = item.media_id;
      if (!mediaId) {
        continue;
      }
      const metadata = mediaMetadata[mediaId];
      if (!metadata || metadata.status !== "valid") {
        continue;
      }
      const sourceUrl = metadata.s?.u;
      if (!sourceUrl) {
        continue;
      }

      media.push({
        kind: "image",
        url: decodeHtmlEntities(sourceUrl),
        width: metadata.s?.x,
        height: metadata.s?.y,
      });
    }
  }

  if (media.length > 0) {
    return media;
  }

  const redditVideo = postData.secure_media?.reddit_video;

  if (redditVideo?.fallback_url) {
    media.push({
      kind: "video",
      url: decodeHtmlEntities(redditVideo.fallback_url),
      width: redditVideo.width,
      height: redditVideo.height,
    });
    return media;
  }

  const previewImage = postData.preview?.images?.[0]?.source;

  const destinationUrl =
    typeof postData.url_overridden_by_dest === "string"
      ? postData.url_overridden_by_dest
      : typeof postData.url === "string"
        ? postData.url
        : "";

  const imageByHint =
    typeof postData.post_hint === "string" && postData.post_hint === "image"
      ? destinationUrl
      : "";

  if (imageByHint) {
    media.push({ kind: "image", url: decodeHtmlEntities(imageByHint) });
    return media;
  }

  if (previewImage?.url) {
    media.push({
      kind: "image",
      url: decodeHtmlEntities(previewImage.url),
      width: previewImage.width,
      height: previewImage.height,
    });
  }

  return media;
}

async function fetchRedditListing(jsonEndpoint) {
  const endpoints = [
    jsonEndpoint,
    jsonEndpoint.replace("www.reddit.com", "old.reddit.com"),
    jsonEndpoint.replace("www.reddit.com", "api.reddit.com"),
  ];

  let lastStatus = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent": "limen/1.0",
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });

      if (response.ok) {
        return response;
      }

      lastStatus = response.status;
    } catch {
      // try next endpoint
    }
  }

  if (lastStatus) {
    throw new UpstreamError(
      lastStatus === 403
        ? "Reddit denied the request. Try opening a public post URL."
        : "Reddit could not return this post right now.",
      lastStatus,
    );
  }

  throw new UpstreamError("Could not reach Reddit from this browser.", 502);
}

function parseComments(children, depth = 0, state = { count: 0 }, moreStubs = []) {
  if (
    !Array.isArray(children) ||
    depth > MAX_COMMENT_DEPTH ||
    state.count >= MAX_COMMENTS
  ) {
    return [];
  }

  const parsed = [];

  for (const child of children) {
    if (state.count >= MAX_COMMENTS) {
      break;
    }

    const node = child;

    if (node.kind === "more" && node.data) {
      const moreChildren = node.data.children;
      const parentId = typeof node.data.parent_id === "string" ? node.data.parent_id : "";
      if (Array.isArray(moreChildren) && moreChildren.length > 0 && parentId) {
        moreStubs.push({ parentId, childIds: moreChildren });
      }
      continue;
    }

    if (node.kind !== "t1" || !node.data) {
      continue;
    }

    const author = typeof node.data.author === "string" ? node.data.author : "[deleted]";
    const body = typeof node.data.body === "string" ? node.data.body : "";

    if (!body.trim()) {
      continue;
    }

    state.count += 1;

    const repliesListing = node.data.replies;

    const repliesChildren =
      repliesListing && typeof repliesListing === "object"
        ? repliesListing.data?.children
        : undefined;

    parsed.push({
      id: typeof node.data.id === "string" ? node.data.id : crypto.randomUUID(),
      author,
      body,
      score: typeof node.data.score === "number" ? node.data.score : 0,
      createdUtc: typeof node.data.created_utc === "number" ? node.data.created_utc : 0,
      replies: parseComments(repliesChildren, depth + 1, state, moreStubs),
    });
  }

  return parsed;
}

async function fetchMoreChildren(postId, childIds) {
  const allThings = [];

  for (let i = 0; i < childIds.length; i += MORE_CHILDREN_BATCH) {
    const batch = childIds.slice(i, i + MORE_CHILDREN_BATCH);
    const url = `https://www.reddit.com/api/morechildren.json?api_type=json&link_id=t3_${postId}&children=${batch.join(",")}&limit_children=false&raw_json=1`;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "limen/1.0",
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const things = data?.json?.data?.things;
      if (Array.isArray(things)) {
        allThings.push(...things);
      }
    } catch {
      // continue with what we have
    }
  }

  return allThings;
}

function buildTreeFromFlat(things) {
  const nodeMap = new Map();
  const parentMap = new Map();

  for (const thing of things) {
    if (thing.kind !== "t1" || !thing.data) continue;

    const id = typeof thing.data.id === "string" ? thing.data.id : crypto.randomUUID();
    const author = typeof thing.data.author === "string" ? thing.data.author : "[deleted]";
    const body = typeof thing.data.body === "string" ? thing.data.body : "";

    if (!body.trim()) continue;

    const parentId = typeof thing.data.parent_id === "string" ? thing.data.parent_id : "";

    nodeMap.set(id, {
      id,
      author,
      body,
      score: typeof thing.data.score === "number" ? thing.data.score : 0,
      createdUtc: typeof thing.data.created_utc === "number" ? thing.data.created_utc : 0,
      replies: [],
    });
    parentMap.set(id, parentId);
  }

  for (const [id, parentFullId] of parentMap) {
    const parentShortId = parentFullId.replace(/^t[0-9]_/, "");
    const parentNode = nodeMap.get(parentShortId);
    if (parentNode) {
      const child = nodeMap.get(id);
      if (child) {
        parentNode.replies.push(child);
      }
    }
  }

  const byParent = new Map();

  for (const [id, parentFullId] of parentMap) {
    const parentShortId = parentFullId.replace(/^t[0-9]_/, "");
    if (!nodeMap.has(parentShortId)) {
      const existing = byParent.get(parentFullId) ?? [];
      const child = nodeMap.get(id);
      if (child) {
        existing.push(child);
        byParent.set(parentFullId, existing);
      }
    }
  }

  return { byParent };
}

function insertIntoTree(tree, parentId, nodes) {
  for (const comment of tree) {
    if (`t1_${comment.id}` === parentId || `t3_${comment.id}` === parentId) {
      comment.replies.push(...nodes);
      return true;
    }
    if (comment.replies.length > 0) {
      if (insertIntoTree(comment.replies, parentId, nodes)) return true;
    }
  }
  return false;
}

async function fetchRedditPayload(inputUrl) {
  const normalized = normalizeRedditUrl(inputUrl);
  const redditResponse = await fetchRedditListing(normalized.jsonEndpoint);

  const listings = await redditResponse.json();
  const postData = listings?.[0]?.data?.children?.[0]?.data;

  if (!postData) {
    throw new UpstreamError("Could not parse this Reddit post.", 422);
  }

  const commentsChildren = listings?.[1]?.data?.children;
  const postId = typeof postData.id === "string" ? postData.id : "";

  const moreStubs = [];
  const comments = parseComments(commentsChildren, 0, { count: 0 }, moreStubs);

  const allMoreChildIds = moreStubs.flatMap((s) => s.childIds);
  if (allMoreChildIds.length > 0 && postId) {
    try {
      const moreThings = await fetchMoreChildren(postId, allMoreChildIds);
      if (moreThings.length > 0) {
        const { byParent } = buildTreeFromFlat(moreThings);
        for (const [parentId, nodes] of byParent) {
          if (!insertIntoTree(comments, parentId, nodes)) {
            if (parentId === `t3_${postId}`) {
              comments.push(...nodes);
            }
          }
        }
      }
    } catch {
      // keep initial comment listing
    }
  }

  return {
    requestedUrl: normalized.originalUrl,
    canonicalUrl: normalized.canonicalUrl,
    fetchedAt: new Date().toISOString(),
    post: {
      id: postId,
      title: typeof postData.title === "string" ? postData.title : "Untitled",
      author: typeof postData.author === "string" ? postData.author : "[deleted]",
      subreddit: typeof postData.subreddit === "string" ? postData.subreddit : "unknown",
      createdUtc: typeof postData.created_utc === "number" ? postData.created_utc : 0,
      score: typeof postData.score === "number" ? postData.score : 0,
      upvoteRatio:
        typeof postData.upvote_ratio === "number" ? postData.upvote_ratio : undefined,
      numComments:
        typeof postData.num_comments === "number" ? postData.num_comments : 0,
      permalink:
        typeof postData.permalink === "string"
          ? `https://www.reddit.com${postData.permalink}`
          : normalized.canonicalUrl,
      domain: typeof postData.domain === "string" ? postData.domain : "",
      selftext: typeof postData.selftext === "string" ? postData.selftext : "",
      url:
        typeof postData.url_overridden_by_dest === "string"
          ? postData.url_overridden_by_dest
          : typeof postData.url === "string"
            ? postData.url
            : "",
      media: extractPostMedia(postData),
    },
    comments,
  };
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const currentUrl = changeInfo.url || tab.pendingUrl || tab.url;
  if (!currentUrl) return;

  const parsedCurrentUrl = parseUrl(currentUrl);
  if (!parsedCurrentUrl) return;

  if (!isWebUrl(parsedCurrentUrl)) return;

  const redirectTarget = getRedirectTarget(currentUrl);
  if (redirectTarget && currentUrl !== redirectTarget) {
    chrome.tabs.update(tabId, { url: redirectTarget });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "FETCH_REDDIT_POST") {
    return;
  }

  const requestId = typeof message.requestId === "string" ? message.requestId : "";
  const url = typeof message.url === "string" ? message.url : "";

  (async () => {
    try {
      if (!url.trim()) {
        throw new ValidationError("Paste a Reddit URL to continue.");
      }

      const payload = await fetchRedditPayload(url);
      sendResponse({ requestId, ok: true, payload });
    } catch (error) {
      const status =
        error instanceof ValidationError || error instanceof UpstreamError
          ? error.status
          : 500;
      const message =
        error instanceof Error
          ? error.message
          : "Something went wrong while loading Reddit.";
      sendResponse({ requestId, ok: false, error: message, status });
    }
  })();

  return true;
});
