# limen extension

this extension does two things:

- if you open a reddit post, it redirects the tab to limen (with the url prefilled)
- when you're on limen (`localhost` or `limen.sh`), it fetches the reddit json in the background and hands it back to the page

## behavior

- works for new tabs and existing/current tab navigations
- only redirects actual post urls (`/comments/{id}` and `redd.it/{id}`)
- supports google redirect links (like `google.com/url?...q=<reddit-url>`)
- ignores subreddit/home/profile pages
- redirect target looks like: `https://limen.sh/?url=<encoded_original_reddit_url>`

## install (dev)

1. open `chrome://extensions`
2. enable developer mode
3. click load unpacked
4. select this folder: `extension`

## quick test

1. run the web app from repo root: `bun run dev:web` (serves `http://localhost:3000`)
2. in `chrome://extensions`, hit reload on the limen extension
3. open a reddit post url
4. it should redirect to `https://limen.sh/?url=...` and auto-load

## debugging

- open `chrome://extensions` -> limen -> inspect views: service worker
- also check the limen page console (the content-script bridge lives there)
- if things are weird: reload extension, then hard refresh the limen tab

## switching to prod

this repo defaults to `https://limen.sh`.

for local dev, set `LIMEN_BASE_URL` in `background.js` to `http://localhost:3000`.

## permissions (why we ask)

- `tabs`: detect and update tabs for redirect
- reddit host permissions: let the service worker fetch reddit json
- content script matches on `localhost`/`limen.sh`: lets the page talk to the extension
