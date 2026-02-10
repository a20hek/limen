"use client";
/* eslint-disable @next/next/no-img-element */

import { type SubmitEvent, useMemo, useState } from "react";
import {
  type RedditCommentNode,
  type RedditViewerResponse,
  formatDate,
  formatRelative,
  formatScore,
} from "./lib/reddit";

function countReplies(node: RedditCommentNode): number {
  let count = node.replies.length;
  for (const reply of node.replies) count += countReplies(reply);
  return count;
}

function CommentTree({
  node,
  depth = 0,
}: {
  node: RedditCommentNode;
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={`comment ${collapsed ? "comment-collapsed" : ""}`}
      style={{ marginLeft: `${depth * 16}px` }}
      onClick={(e) => {
        e.stopPropagation();
        setCollapsed((c) => !c);
      }}
    >
      <div className="comment-meta">
        <span className="comment-author">u/{node.author}</span>
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

  const sourceHost = useMemo(() => {
    if (!data?.post.url) return null;
    try {
      return new URL(data.post.url).hostname;
    } catch {
      return null;
    }
  }, [data]);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!url.trim()) {
      setError("Please paste a Reddit post URL.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/reddit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const payload = (await response.json()) as RedditViewerResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load this post.");
      }

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
                  <CommentTree key={comment.id} node={comment} />
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
