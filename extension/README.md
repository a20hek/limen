# Limen Chrome Extension

This extension redirects newly opened Reddit **post** tabs to Limen so the post opens directly in focus mode.

## Behavior

- Works for both new tabs and existing/current tab navigations.
- Redirects only Reddit post URLs (`/comments/{id}` and `redd.it/{id}`).
- Supports Google redirect links (for example `google.com/url?...q=<reddit-url>`).
- Ignores subreddit/home/profile pages.
- Redirect target format:
  - `http://localhost:3000/?url=<encoded_original_reddit_url>`

## Install (Development)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `extension`.

## Manual Verification

1. Run the web app from repo root: `bun run dev:web` (serves on `http://localhost:3000`).
2. Open `chrome://extensions` and click **Reload** on the Limen extension.
3. Open a new tab to a Reddit post URL.
4. Confirm the tab redirects to `http://localhost:3000/?url=...` and the post auto-loads.
5. In an existing tab, navigate to a Reddit post URL.
6. Confirm it also redirects to `http://localhost:3000/?url=...`.
7. Open a tab to a non-post Reddit URL (for example `https://www.reddit.com/r/programming/`).
8. Confirm there is no redirect.

## If It Still Doesn't Trigger

1. In `chrome://extensions`, open **Details** for Limen extension.
2. Click **Inspect views: service worker**.
3. Keep DevTools open, then reproduce the tab-open action.
4. Check for runtime errors in the service worker console.

## Switching to Production Later

Change `LIMEN_BASE_URL` in `background.js` to `https://limen.sh`.

## Permissions

- `tabs`: needed to detect newly created tabs and update their URL.
- Reddit host permissions: used to inspect and match Reddit URLs.
