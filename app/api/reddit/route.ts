import { NextResponse } from "next/server";

type RedditCommentNode = {
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  replies: RedditCommentNode[];
};

type RedditMediaItem =
  | {
      kind: "image";
      url: string;
      width?: number;
      height?: number;
      caption?: string;
    }
  | {
      kind: "video";
      url: string;
      width?: number;
      height?: number;
    };

type RedditPostPayload = {
  id: string;
  title: string;
  author: string;
  subreddit: string;
  createdUtc: number;
  score: number;
  upvoteRatio?: number;
  numComments: number;
  permalink: string;
  domain: string;
  selftext: string;
  url: string;
  media: RedditMediaItem[];
};

type RedditViewerResponse = {
  requestedUrl: string;
  canonicalUrl: string;
  fetchedAt: string;
  post: RedditPostPayload;
  comments: RedditCommentNode[];
};

type RedditUrlInfo = {
  originalUrl: string;
  canonicalUrl: string;
};

const REDDIT_HOSTS = new Set([
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "m.reddit.com",
  "np.reddit.com",
  "redd.it",
]);

const GOOGLE_REDIRECT_HOSTS = new Set(["www.google.com", "google.com"]);

const MAX_COMMENTS = 2000;
const MAX_COMMENT_DEPTH = 20;
const APIFY_API_BASE = "https://api.apify.com/v2";
const DEFAULT_APIFY_REDDIT_ACTOR_ID = "backhoe/reddit-post-scraper";
const APIFY_MAX_COMMENTS = 500;
const APIFY_TIMEOUT_MS = 120_000;

class ValidationError extends Error {
  status = 400;
}

class UpstreamError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function tryParseUrl(input: string): URL | null {
  const trimmed = input.trim();
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

function normalizeRedditUrl(input: string): {
  originalUrl: string;
  canonicalUrl: string;
} {
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

  return {
    originalUrl: directUrl.toString(),
    canonicalUrl,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toUnixSeconds(value: unknown): number | undefined {
  const numeric = toNumberValue(value);
  if (numeric === undefined) {
    return undefined;
  }

  if (numeric > 1_000_000_000_000) {
    return Math.floor(numeric / 1000);
  }
  return Math.floor(numeric);
}

function stripThingPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function normalizeActorId(input: string): string {
  if (input.includes("~")) {
    return input;
  }
  return input.replace("/", "~");
}

function extractPostIdFromText(input: string): string | undefined {
  const match = input.match(/\/comments\/([a-z0-9]+)/i);
  return match?.[1]?.toLowerCase();
}

function inferDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function toApifyCommentNode(
  input: unknown,
  depth = 0,
  state = { count: 0 },
): RedditCommentNode | null {
  const node = asRecord(input);
  if (!node) {
    return null;
  }

  if (
    depth > MAX_COMMENT_DEPTH ||
    state.count >= MAX_COMMENTS
  ) {
    return null;
  }

  const rawBody = toStringValue(node.body) ?? toStringValue(node.text) ?? "";
  const body = decodeHtmlEntities(rawBody);
  if (!body.trim()) {
    return null;
  }

  state.count += 1;

  const repliesSource = Array.isArray(node.replies) ? node.replies : [];
  const replies: RedditCommentNode[] = [];

  for (const reply of repliesSource) {
    if (state.count >= MAX_COMMENTS) {
      break;
    }
    const parsedReply = toApifyCommentNode(reply, depth + 1, state);
    if (parsedReply) {
      replies.push(parsedReply);
    }
  }

  const rawId = toStringValue(node.id) ?? crypto.randomUUID();
  return {
    id: stripThingPrefix(rawId, "t1_"),
    author: toStringValue(node.author) ?? "[deleted]",
    body,
    score: toNumberValue(node.score) ?? toNumberValue(node.upvotes) ?? 0,
    createdUtc:
      toUnixSeconds(node.created_utc) ?? toUnixSeconds(node.createdUtc) ?? 0,
    replies,
  };
}

function parseApifyComments(
  input: unknown,
  state = { count: 0 },
): RedditCommentNode[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const parsed: RedditCommentNode[] = [];
  for (const node of input) {
    if (state.count >= MAX_COMMENTS) {
      break;
    }
    const parsedNode = toApifyCommentNode(node, 0, state);
    if (parsedNode) {
      parsed.push(parsedNode);
    }
  }

  return parsed;
}

function countComments(nodes: RedditCommentNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1;
    if (node.replies.length > 0) {
      total += countComments(node.replies);
    }
  }
  return total;
}

function toMediaItem(input: unknown): RedditMediaItem | null {
  const media = asRecord(input);
  if (!media) {
    return null;
  }

  const url =
    toStringValue(media.url) ??
    toStringValue(media.src) ??
    toStringValue(media.fallback_url);

  if (!url) {
    return null;
  }

  const type =
    (
      toStringValue(media.type) ??
      toStringValue(media.kind) ??
      toStringValue(media.mediaType) ??
      ""
    ).toLowerCase();

  if (type.includes("video")) {
    return {
      kind: "video",
      url: decodeHtmlEntities(url),
      width: toNumberValue(media.width),
      height: toNumberValue(media.height),
    };
  }

  return {
    kind: "image",
    url: decodeHtmlEntities(url),
    width: toNumberValue(media.width),
    height: toNumberValue(media.height),
    caption: toStringValue(media.caption),
  };
}

function extractPostMedia(postData: Record<string, unknown>): RedditMediaItem[] {
  const media: RedditMediaItem[] = [];

  if (Array.isArray(postData.media)) {
    for (const item of postData.media) {
      const parsed = toMediaItem(item);
      if (parsed) {
        media.push(parsed);
      }
    }
  } else {
    const parsed = toMediaItem(postData.media);
    if (parsed) {
      media.push(parsed);
    }
  }

  if (media.length === 0) {
    const fallbackImage =
      toStringValue(postData.image) ?? toStringValue(postData.thumbnail);
    if (fallbackImage?.startsWith("http")) {
      media.push({
        kind: "image",
        url: decodeHtmlEntities(fallbackImage),
      });
    }
  }

  return media;
}

function selectPostItem(
  items: Record<string, unknown>[],
): Record<string, unknown> | null {
  for (const item of items) {
    const dataType = toStringValue(item.dataType)?.toLowerCase();
    const entityType = toStringValue(item.entityType)?.toLowerCase();
    if (dataType === "post" || entityType === "post") {
      return item;
    }
  }

  return items[0] ?? null;
}

function buildPostPayload(
  postItem: Record<string, unknown>,
  normalized: RedditUrlInfo,
  commentsCount: number,
): RedditPostPayload {
  const stats = asRecord(postItem.stats);

  const rawPermalink =
    toStringValue(postItem.permalink) ?? toStringValue(postItem.url) ?? "";
  const permalink = rawPermalink.startsWith("/")
    ? `https://www.reddit.com${rawPermalink}`
    : rawPermalink.startsWith("http")
      ? rawPermalink
      : normalized.canonicalUrl;

  const rawId = toStringValue(postItem.id) ?? "";
  const idFromPermalink = extractPostIdFromText(permalink);
  const postId = stripThingPrefix(rawId, "t3_") || idFromPermalink || "";

  const destinationUrl =
    toStringValue(postItem.link) ??
    toStringValue(postItem.linkUrl) ??
    toStringValue(postItem.url) ??
    permalink;

  return {
    id: postId,
    title: toStringValue(postItem.title) ?? "Untitled",
    author: toStringValue(postItem.author) ?? "[deleted]",
    subreddit: toStringValue(postItem.subreddit) ?? "unknown",
    createdUtc:
      toUnixSeconds(postItem.created_utc) ?? toUnixSeconds(postItem.createdUtc) ?? 0,
    score:
      toNumberValue(postItem.score) ??
      toNumberValue(postItem.upvotes) ??
      toNumberValue(stats?.upvotes) ??
      0,
    upvoteRatio:
      toNumberValue(postItem.upvote_ratio) ??
      toNumberValue(postItem.upvoteRatio) ??
      toNumberValue(stats?.upvote_ratio) ??
      toNumberValue(stats?.upvoteRatio),
    numComments:
      toNumberValue(postItem.num_comments) ??
      toNumberValue(postItem.numComments) ??
      toNumberValue(stats?.comments_total) ??
      commentsCount,
    permalink,
    domain:
      toStringValue(postItem.domain) ||
      inferDomain(destinationUrl) ||
      "reddit.com",
    selftext:
      decodeHtmlEntities(
        toStringValue(postItem.body) ?? toStringValue(postItem.selftext) ?? "",
      ),
    url: destinationUrl,
    media: extractPostMedia(postItem),
  };
}

async function fetchFromApify(canonicalUrl: string): Promise<unknown[]> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) {
    throw new UpstreamError(
      "Server is missing APIFY_TOKEN. Add it in deployment environment variables.",
      500,
    );
  }

  const actorId = normalizeActorId(
    process.env.APIFY_REDDIT_ACTOR_ID?.trim() ??
      DEFAULT_APIFY_REDDIT_ACTOR_ID,
  );

  const endpoint = `${APIFY_API_BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?format=json&clean=true`;

  const input = {
    startUrls: [canonicalUrl],
    skipComments: false,
    maxComments: APIFY_MAX_COMMENTS,
    sort: "confidence",
    includeNSFW: true,
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: AbortSignal.timeout(APIFY_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new UpstreamError("Apify request timed out.", 504);
    }
    throw new UpstreamError("Could not reach Apify right now.", 502);
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    const suffix = detail ? ` Details: ${detail}` : "";
    const message =
      response.status === 401 || response.status === 403
        ? `Apify rejected the request. Check APIFY_TOKEN and actor access.${suffix}`
        : `Apify could not return this post right now.${suffix}`;
    throw new UpstreamError(message, 502);
  }

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new UpstreamError("Apify returned an unexpected response format.", 502);
  }

  return data;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: string };
    const inputUrl = body.url?.trim() ?? "";

    if (!inputUrl) {
      return NextResponse.json(
        { error: "Paste a Reddit URL to continue." },
        { status: 400 },
      );
    }

    const normalized = normalizeRedditUrl(inputUrl);

    const apifyItems = await fetchFromApify(normalized.canonicalUrl);
    const records = apifyItems
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => item !== null);

    if (records.length === 0) {
      return NextResponse.json(
        { error: "Apify returned no data for this post URL." },
        { status: 422 },
      );
    }

    const postItem = selectPostItem(records);
    if (!postItem) {
      return NextResponse.json(
        { error: "Apify did not return a Reddit post payload." },
        { status: 422 },
      );
    }

    const nestedComments = parseApifyComments(postItem.comments);
    const fallbackComments =
      nestedComments.length > 0
        ? nestedComments
        : parseApifyComments(
            records.filter((item) => {
              const dataType = toStringValue(item.dataType)?.toLowerCase();
              const entityType = toStringValue(item.entityType)?.toLowerCase();
              return dataType === "comment" || entityType === "comment";
            }),
          );
    const comments = fallbackComments;
    const commentsCount = countComments(comments);

    const payload: RedditViewerResponse = {
      requestedUrl: normalized.originalUrl,
      canonicalUrl: normalized.canonicalUrl,
      fetchedAt: new Date().toISOString(),
      post: buildPostPayload(postItem, normalized, commentsCount),
      comments,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong while loading Reddit.";
    const status =
      error instanceof ValidationError
        ? error.status
        : error instanceof UpstreamError
          ? error.status
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
