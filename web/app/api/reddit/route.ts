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
const MORE_CHILDREN_BATCH = 100;

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
  jsonEndpoint: string;
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
  const jsonEndpoint = `${canonicalUrl}.json?raw_json=1&sort=confidence&limit=500`;

  return {
    originalUrl: directUrl.toString(),
    canonicalUrl,
    jsonEndpoint,
  };
}

function extractPostMedia(
  postData: Record<string, unknown>,
): RedditMediaItem[] {
  const media: RedditMediaItem[] = [];

  const mediaMetadata = postData.media_metadata as
    | Record<
        string,
        {
          status?: string;
          e?: string;
          s?: { u?: string; x?: number; y?: number };
        }
      >
    | undefined;

  const galleryItems = (
    postData.gallery_data as { items?: { media_id?: string }[] } | undefined
  )?.items;

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

  const redditVideo = (
    postData.secure_media as {
      reddit_video?: { fallback_url?: string; width?: number; height?: number };
    } | null
  )?.reddit_video;

  if (redditVideo?.fallback_url) {
    media.push({
      kind: "video",
      url: decodeHtmlEntities(redditVideo.fallback_url),
      width: redditVideo.width,
      height: redditVideo.height,
    });
    return media;
  }

  const previewImage = (
    postData.preview as {
      images?: {
        source?: { url?: string; width?: number; height?: number };
      }[];
    } | null
  )?.images?.[0]?.source;

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

async function fetchRedditListing(jsonEndpoint: string): Promise<Response> {
  const endpoints = [
    jsonEndpoint,
    jsonEndpoint.replace("www.reddit.com", "old.reddit.com"),
    jsonEndpoint.replace("www.reddit.com", "api.reddit.com"),
  ];

  let lastStatus: number | null = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent": "limen/1.0",
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
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
        ? "Reddit denied the request. If Reddit is blocked on this machine, allow this app to access reddit.com."
        : "Reddit could not return this post right now.",
      lastStatus,
    );
  }

  throw new UpstreamError(
    "Could not reach Reddit from this machine. If you blocked reddit.com via hosts/firewall, this app is blocked too.",
    502,
  );
}

type MoreStub = {
  parentId: string;
  childIds: string[];
};

function parseComments(
  children: unknown,
  depth = 0,
  state = { count: 0 },
  moreStubs: MoreStub[] = [],
): RedditCommentNode[] {
  if (
    !Array.isArray(children) ||
    depth > MAX_COMMENT_DEPTH ||
    state.count >= MAX_COMMENTS
  ) {
    return [];
  }

  const parsed: RedditCommentNode[] = [];

  for (const child of children) {
    if (state.count >= MAX_COMMENTS) {
      break;
    }

    const node = child as { kind?: string; data?: Record<string, unknown> };

    if (node.kind === "more" && node.data) {
      const moreChildren = node.data.children as string[] | undefined;
      const parentId =
        typeof node.data.parent_id === "string" ? node.data.parent_id : "";
      if (Array.isArray(moreChildren) && moreChildren.length > 0 && parentId) {
        moreStubs.push({ parentId, childIds: moreChildren });
      }
      continue;
    }

    if (node.kind !== "t1" || !node.data) {
      continue;
    }

    const author =
      typeof node.data.author === "string" ? node.data.author : "[deleted]";
    const body = typeof node.data.body === "string" ? node.data.body : "";

    if (!body.trim()) {
      continue;
    }

    state.count += 1;

    const repliesListing = node.data.replies as
      | { data?: { children?: unknown[] } }
      | ""
      | undefined;

    const repliesChildren =
      repliesListing && typeof repliesListing === "object"
        ? repliesListing.data?.children
        : undefined;

    parsed.push({
      id: typeof node.data.id === "string" ? node.data.id : crypto.randomUUID(),
      author,
      body,
      score: typeof node.data.score === "number" ? node.data.score : 0,
      createdUtc:
        typeof node.data.created_utc === "number" ? node.data.created_utc : 0,
      replies: parseComments(repliesChildren, depth + 1, state, moreStubs),
    });
  }

  return parsed;
}

async function fetchMoreChildren(
  postId: string,
  childIds: string[],
): Promise<{ kind?: string; data?: Record<string, unknown> }[]> {
  const allThings: { kind?: string; data?: Record<string, unknown> }[] = [];

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
        signal: AbortSignal.timeout(12_000),
      });

      if (!response.ok) continue;

      const data = (await response.json()) as {
        json?: {
          data?: {
            things?: { kind?: string; data?: Record<string, unknown> }[];
          };
        };
      };
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

function buildTreeFromFlat(
  things: { kind?: string; data?: Record<string, unknown> }[],
): { byParent: Map<string, RedditCommentNode[]>; allIds: Set<string> } {
  const nodeMap = new Map<string, RedditCommentNode>();
  const parentMap = new Map<string, string>();

  for (const thing of things) {
    if (thing.kind !== "t1" || !thing.data) continue;

    const id =
      typeof thing.data.id === "string" ? thing.data.id : crypto.randomUUID();
    const author =
      typeof thing.data.author === "string" ? thing.data.author : "[deleted]";
    const body = typeof thing.data.body === "string" ? thing.data.body : "";

    if (!body.trim()) continue;

    const parentId =
      typeof thing.data.parent_id === "string" ? thing.data.parent_id : "";

    nodeMap.set(id, {
      id,
      author,
      body,
      score: typeof thing.data.score === "number" ? thing.data.score : 0,
      createdUtc:
        typeof thing.data.created_utc === "number" ? thing.data.created_utc : 0,
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

  const byParent = new Map<string, RedditCommentNode[]>();
  const allIds = new Set(nodeMap.keys());

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

  return { byParent, allIds };
}

function insertIntoTree(
  tree: RedditCommentNode[],
  parentId: string,
  nodes: RedditCommentNode[],
): boolean {
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

    const redditResponse = await fetchRedditListing(normalized.jsonEndpoint);

    if (!redditResponse.ok) {
      const reason =
        redditResponse.status === 403
          ? "Reddit rejected this request. Try another public post URL."
          : "Reddit could not return this post right now.";

      return NextResponse.json(
        { error: reason },
        { status: redditResponse.status },
      );
    }

    const listings = (await redditResponse.json()) as {
      data?: { children?: { data?: Record<string, unknown> }[] };
    }[];

    const postData = listings?.[0]?.data?.children?.[0]?.data;

    if (!postData) {
      return NextResponse.json(
        { error: "Could not parse this Reddit post." },
        { status: 422 },
      );
    }

    const commentsChildren = listings?.[1]?.data?.children;
    const postId = typeof postData.id === "string" ? postData.id : "";

    const moreStubs: MoreStub[] = [];
    const comments = parseComments(
      commentsChildren,
      0,
      { count: 0 },
      moreStubs,
    );

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
      } catch {}
    }

    const payload: RedditViewerResponse = {
      requestedUrl: normalized.originalUrl,
      canonicalUrl: normalized.canonicalUrl,
      fetchedAt: new Date().toISOString(),
      post: {
        id: postId,
        title: typeof postData.title === "string" ? postData.title : "Untitled",
        author:
          typeof postData.author === "string" ? postData.author : "[deleted]",
        subreddit:
          typeof postData.subreddit === "string"
            ? postData.subreddit
            : "unknown",
        createdUtc:
          typeof postData.created_utc === "number" ? postData.created_utc : 0,
        score: typeof postData.score === "number" ? postData.score : 0,
        upvoteRatio:
          typeof postData.upvote_ratio === "number"
            ? postData.upvote_ratio
            : undefined,
        numComments:
          typeof postData.num_comments === "number" ? postData.num_comments : 0,
        permalink:
          typeof postData.permalink === "string"
            ? `https://www.reddit.com${postData.permalink}`
            : normalized.canonicalUrl,
        domain: typeof postData.domain === "string" ? postData.domain : "",
        selftext:
          typeof postData.selftext === "string" ? postData.selftext : "",
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
