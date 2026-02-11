"use client";
/* eslint-disable @next/next/no-img-element */

import {
  type SubmitEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type RedditCommentNode,
  type RedditViewerResponse,
  formatDate,
  formatRelative,
  formatScore,
} from "./lib/reddit";

const EXTENSION_REQUEST_TYPE = "LIMEN_FETCH_REDDIT";
const EXTENSION_RESPONSE_TYPE = "LIMEN_FETCH_REDDIT_RESULT";
const EXTENSION_TIMEOUT_MS = 20_000;

type ExtensionSuccessResponse = {
  type: typeof EXTENSION_RESPONSE_TYPE;
  requestId: string;
  ok: true;
  payload: RedditViewerResponse;
};

type ExtensionErrorResponse = {
  type: typeof EXTENSION_RESPONSE_TYPE;
  requestId: string;
  ok: false;
  error?: string;
};

type ExtensionBridgeResponse = ExtensionSuccessResponse | ExtensionErrorResponse;

function isBridgeResponse(
  value: unknown,
  requestId: string,
): value is ExtensionBridgeResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === EXTENSION_RESPONSE_TYPE &&
    candidate.requestId === requestId &&
    typeof candidate.ok === "boolean"
  );
}

function fetchRedditViaExtension(url: string): Promise<RedditViewerResponse> {
  const requestId = `limen-${crypto.randomUUID()}`;

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(
        new Error(
          "Limen extension did not respond. Reload the extension and this page, then try again.",
        ),
      );
    }, EXTENSION_TIMEOUT_MS);

    function cleanup() {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", handleMessage);
    }

    function handleMessage(event: MessageEvent) {
      if (event.source !== window) return;
      if (!isBridgeResponse(event.data, requestId)) return;

      cleanup();

      if (event.data.ok) {
        resolve(event.data.payload);
        return;
      }

      reject(
        new Error(event.data.error ?? "Unable to load this post via extension."),
      );
    }

    window.addEventListener("message", handleMessage);
    window.postMessage(
      { type: EXTENSION_REQUEST_TYPE, requestId, url },
      window.location.origin,
    );
  });
}

function countReplies(node: RedditCommentNode): number {
  let count = node.replies.length;
  for (const reply of node.replies) count += countReplies(reply);
  return count;
}

function isSameAuthor(authorA: string, authorB: string): boolean {
  return authorA.trim().toLowerCase() === authorB.trim().toLowerCase();
}

function CommentTree({
  node,
  depth = 0,
  opAuthor,
}: {
  node: RedditCommentNode;
  depth?: number;
  opAuthor: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const isOpComment = isSameAuthor(node.author, opAuthor);

  return (
    <div
      className={`comment ${isOpComment ? "comment-op" : ""} ${collapsed ? "comment-collapsed" : ""}`}
      style={{ marginLeft: `${depth * 16}px` }}
      onClick={(e) => {
        e.stopPropagation();
        setCollapsed((c) => !c);
      }}
    >
      <div className="comment-meta">
        <span className="comment-author">u/{node.author}</span>
        {isOpComment && <span className="comment-op-badge">OP</span>}
        <span className="comment-score">{formatScore(node.score)} points</span>
        <span className="comment-time">{formatRelative(node.createdUtc)}</span>
        {collapsed && node.replies.length > 0 && (
          <span className="comment-collapsed-count">
            +{countReplies(node)}{" "}
            {countReplies(node) === 1 ? "reply" : "replies"}
          </span>
        )}
      </div>
      {!collapsed && (
        <>
          <p className="comment-body">{node.body}</p>
          {node.replies.length > 0 && (
            <div className="comment-replies">
              {node.replies.map((reply) => (
                <CommentTree
                  key={`${node.id}-${reply.id}`}
                  node={reply}
                  depth={depth + 1}
                  opAuthor={opAuthor}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<RedditViewerResponse | null>(null);
  const hasAutoOpenedRef = useRef(false);

  const sourceHost = useMemo(() => {
    if (!data?.post.url) return null;
    try {
      return new URL(data.post.url).hostname;
    } catch {
      return null;
    }
  }, [data]);

  const loadPost = useCallback(async (rawUrl: string) => {
    const trimmedUrl = rawUrl.trim();
    if (!trimmedUrl) {
      setError("Please paste a Reddit post URL.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const payload = await fetchRedditViaExtension(trimmedUrl);
      setData(payload);
    } catch (submitError) {
      setData(null);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Something went wrong while opening that link.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasAutoOpenedRef.current) {
      return;
    }

    hasAutoOpenedRef.current = true;
    const incomingUrl = new URLSearchParams(window.location.search).get("url");
    if (!incomingUrl?.trim()) {
      return;
    }

    setUrl(incomingUrl);
    void loadPost(incomingUrl);
  }, [loadPost]);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadPost(url);
  }

  return (
    <div className="page">
      <div className="top-rule" />

      <div className="wrapper">
        <header className="masthead">
          <h1 className="masthead-title">Limen</h1>
          <hr className="masthead-rule" />
        </header>

        <div className="input-section">
          <label htmlFor="url" className="input-label">
            Post URL
          </label>
          <form onSubmit={handleSubmit} className="form">
            <input
              id="url"
              type="url"
              inputMode="url"
              autoComplete="off"
              className="url-input"
              placeholder="https://www.reddit.com/r/.../comments/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button type="submit" className="submit-btn" disabled={isLoading}>
              {isLoading ? "Opening\u2026" : "Open Post"}
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>

        {isLoading && <p className="loading">Fetching post\u2026</p>}

        {data && (
          <article className="article" aria-live="polite">
            <div className="flex justify-between pt-4">
              <p>
                By <span className="byline-author">u/{data.post.author}</span>{" "}
                in{" "}
                <span className="byline-author">r/{data.post.subreddit}</span>
              </p>
              <p className="post-dateline">
                {formatDate(data.post.createdUtc)} &mdash;&mdash;{" "}
                {formatRelative(data.post.createdUtc)}
              </p>
            </div>

            <h2 className="post-title pt-4">{data.post.title}</h2>

            <p className="body-text">{data.post.selftext}</p>
            <div className="stats py-4">
              <span className="stat-item">
                {formatScore(data.post.score)} upvotes
              </span>
              <span className="stat-sep">&middot;</span>
              <span className="stat-item">
                {formatScore(data.post.numComments)} comments
              </span>
              {typeof data.post.upvoteRatio === "number" && (
                <>
                  <span className="stat-sep">&middot;</span>
                  <span className="stat-item">
                    {Math.round(data.post.upvoteRatio * 100)}% upvotes
                  </span>
                </>
              )}
            </div>

            {data.post.media.length > 0 && (
              <>
                <h3 className="section-header">Media</h3>
                <hr className="section-rule" />
                <div className="media-grid">
                  {data.post.media.map((item, index) =>
                    item.kind === "image" ? (
                      <figure
                        key={`${item.url}-${index}`}
                        style={{ margin: 0 }}
                      >
                        <img
                          src={item.url}
                          alt={item.caption ?? `Media ${index + 1}`}
                          loading="lazy"
                        />
                        {item.caption && (
                          <figcaption className="media-caption">
                            {item.caption}
                          </figcaption>
                        )}
                      </figure>
                    ) : (
                      <video
                        key={`${item.url}-${index}`}
                        controls
                        preload="metadata"
                        src={item.url}
                      />
                    ),
                  )}
                </div>
              </>
            )}

            {!data.post.selftext.trim() && data.post.url && (
              <>
                <h3 className="section-header">Linked URL</h3>
                <hr className="section-rule" />
                <p className="linked-url">{data.post.url}</p>
                {sourceHost && (
                  <p className="source-domain">Source domain: {sourceHost}</p>
                )}
              </>
            )}

            <hr className="section-rule" />
            {data.comments.length > 0 ? (
              <div className="comments-list">
                {data.comments.map((comment) => (
                  <CommentTree
                    key={comment.id}
                    node={comment}
                    opAuthor={data.post.author}
                  />
                ))}
              </div>
            ) : (
              <p className="no-comments">
                No comments were returned for this post.
              </p>
            )}

            <footer className="footer">
              <p className="footer-text">Canonical URL: {data.canonicalUrl}</p>
              <p className="footer-text">
                Loaded at: {formatDate(Date.parse(data.fetchedAt) / 1000)}
              </p>
            </footer>
          </article>
        )}
      </div>
    </div>
  );
}
