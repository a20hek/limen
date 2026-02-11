# limen web

this is the ui.
it renders a reddit post (and comments) in a clean, single-thread view.

one important thing:
reddit fetching happens in the chrome extension, not in this app.

## run (local)

from repo root:

```bash
bun install
bun run dev:web
```

then load the extension from `extension` via `chrome://extensions` (developer mode).

## url handoff

limen supports:

- `/?url=<reddit_post_url>` (prefills + auto-opens)

production example:

- `https://limen.sh/?url=<reddit_post_url>`

## why the extension is required

prod backends often get 403'd by reddit.
fetching from the user's browser (via the extension) behaves more like "normal browsing" and is much more reliable for read-only, public post fetches.

## build note

this app uses `next/font/google`.
your build environment needs outbound access to fetch the font css at build time.
