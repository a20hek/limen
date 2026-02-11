# Limen Monorepo

Limen is a focused Reddit post viewer that removes feed distractions.

## Apps

- `web`: Next.js web app (limen.sh)
- `extension`: Chrome extension that redirects newly opened Reddit post tabs to Limen

## Requirements

- Bun

## Install

```bash
bun install
```

## Web App Commands

From repo root:

```bash
bun run dev:web
bun run build:web
bun run start:web
bun run lint:web
```

Convenience aliases:

```bash
bun run dev
bun run build
bun run lint
```

## URL Handoff Contract

Limen web supports this entrypoint:

- `https://limen.sh/?url=<reddit_post_url>`

When `url` is present, the web app prefills the input and auto-opens the post.

## Chrome Extension

Location:

- `extension`

Load unpacked via `chrome://extensions`, then select `extension`.

Behavior:

- Trigger: new tabs and existing/current tab navigations
- Redirect condition: URL is a Reddit post URL
- Action (current dev default): same tab navigates to `http://localhost:3000/?url=<encoded_reddit_url>`

Optional packaging command:

```bash
bun run extension:pack
```
