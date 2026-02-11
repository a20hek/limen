# limen

read one reddit post.
don't get pulled into the feed.

drop in a post link and you get:

- the post (clean)
- media (inline)
- comments (threaded, collapsible)

## how it works

- the chrome extension catches reddit post tabs and redirects them to limen with the url prefilled
- the extension fetches reddit json from the user's browser (so prod doesn't get stuck on backend 403s)
- the web app renders post + comments

## apps

- `web`: next.js web app (limen.sh)
- `extension`: chrome extension (redirect + reddit fetch bridge)

## quickstart (local)

```bash
bun install
bun run dev:web
```

then:

1. load the extension unpacked via `chrome://extensions` (developer mode)
2. select `extension`
3. open any reddit post url in chrome and it should redirect to `http://localhost:3000/?url=...`

## important

limen loads reddit content via the extension bridge.
if the extension isn't installed/enabled, the web app can't fetch posts.

## urls

- `https://limen.sh/?url=<reddit_post_url>` prefills + auto-opens

## dev commands

```bash
bun run dev
bun run build
bun run lint
bun run start:web
```

## extension packaging

```bash
bun run extension:pack
```

## notes

- limen is not affiliated with reddit
