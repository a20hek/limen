const LIMEN_BASE_URL = "http://localhost:3000";

const REDDIT_HOSTS = new Set([
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "m.reddit.com",
  "np.reddit.com",
  "redd.it",
]);

const GOOGLE_REDIRECT_HOSTS = new Set(["google.com", "www.google.com"]);

function parseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
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

function isWebUrl(urlObject) {
  return urlObject.protocol === "http:" || urlObject.protocol === "https:";
}

function getRedirectTarget(rawUrl) {
  const resolvedRedditUrl = getResolvedRedditUrl(rawUrl);
  if (!resolvedRedditUrl) return null;

  const postId = getRedditPostId(resolvedRedditUrl);
  if (!postId) return null;

  return `${LIMEN_BASE_URL}/?url=${encodeURIComponent(resolvedRedditUrl.toString())}`;
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
