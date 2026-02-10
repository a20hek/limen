export type RedditCommentNode = {
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  replies: RedditCommentNode[];
};

export type RedditMediaItem =
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

export type RedditPostPayload = {
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

export type RedditViewerResponse = {
  requestedUrl: string;
  canonicalUrl: string;
  fetchedAt: string;
  post: RedditPostPayload;
  comments: RedditCommentNode[];
};

export function formatDate(timestamp: number): string {
  if (!timestamp) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}

export function formatRelative(timestamp: number): string {
  if (!timestamp) {
    return "";
  }

  const deltaSeconds = Math.round(timestamp - Date.now() / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];

  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(deltaSeconds) >= secondsInUnit) {
      return rtf.format(Math.round(deltaSeconds / secondsInUnit), unit);
    }
  }

  return rtf.format(deltaSeconds, "second");
}

export function formatScore(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}
