# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

`wx-search-cli` is a TypeScript command-line tool for searching and reading WeChat official account (公众号) articles via Sogou WeChat search. Output goes to stdout as JSON (search commands) or plain text (content command), designed for AI-agent and shell-pipeline consumption. It is a CLI reimplementation of the Python project [fancyboi999/weixin_search_mcp](https://github.com/fancyboi999/weixin_search_mcp) (an MCP server), with several scraping bugs fixed along the way — keep the Acknowledgements section in README.md crediting the original project.

## Commands

```bash
ni                                       # install dependencies (bun agent)
bun run build                            # tsc -> dist/
bun run src/index.ts search "关键词"      # run from source
```

There are no tests yet. Quick smoke test (hits live Sogou):

```bash
node dist/index.js search "人工智能" | head -20
```

## Architecture

Two source files under `src/`:

- `index.ts` — bin entry (`#!/usr/bin/env node`). Subcommand parsing via `node:util` `parseArgs` with `allowPositionals`. Commands: `search <query> [--page]`, `search-all <query> [--max-pages]`, `content <real_url> [--referer]`. Search commands print pretty JSON; `content` prints plain text. All failures exit 1 with the message on stderr. `search` runs in strict mode so anti-spider/network failures error out instead of printing `[]`.
- `weixin-search.ts` — all scraping logic (cheerio + native fetch, 15s timeout via `AbortSignal.timeout`).

### Scraping flow and its load-bearing hacks

Search request → parse result list → for each result, resolve the Sogou `/link` redirect to the real `mp.weixin.qq.com` URL → optionally fetch the article body (`div#js_content` text nodes).

Things that look odd but are required — do not "clean up" without re-testing against live Sogou:

- **Dynamic session cookies**: Sogou's `/link` endpoint returns an anti-spider challenge unless the request carries the session cookies (SNUID/SUID/ABTEST) issued by the *same* search response. `extractSessionCookie()` harvests them from Set-Cookie; the original Python project hardcoded stale cookies and is broken today.
- **`url += '...'` extraction**: the redirect page builds the destination URL via inline JS string concatenation. We extract all `url += '...'` literals, join, strip `@` noise chars, and prepend `https://mp.` only when the scheme is missing (newer pages already include it; unconditional prepending produces `https://mp.https://mp.…`).
- **Anti-spider detection** (`isAntispiderResponse`): final URL contains `antispider`, or body contains `seccoderight` / `anti.min.css`. Such pages otherwise look like empty results.
- **Browser-mimicking headers**: full Chrome/Edge header sets (including lowercase `sec-ch-ua` etc. for article fetches) are part of what keeps Sogou/WeChat serving real pages.
- **`publish_time`**: the result page renders time via `document.write(timeConvert('<unix ts>'))`; `formatPublishTime()` extracts the timestamp and emits ISO 8601, falling back to raw text.
- **strict mode**: `sogouWeixinSearch(query, page, strict)` swallows errors and returns `[]` when `strict` is false; pagination (`sogouWeixinSearchAll`) and the `search` CLI command run in strict mode so anti-spider blocks surface as errors instead of silently truncating. Pagination sleeps 1s between pages.
- **Error-as-string**: `getArticleContent` never throws; it returns `"Failed to get article content: …"` strings (parity with the original Python version). The `content` CLI command detects that sentinel prefix and converts it to a nonzero exit.
- **real_url resolution is sequential on purpose**: parallelizing the `/link` requests speeds up a page (~1.6–5s today) but sharply raises the captcha risk.

## Gotchas

- Live testing hits real Sogou endpoints; keep request volume low or you will trigger captcha (then `real_url` comes back as `""`).
- Result field names are snake_case strings (`real_url`, `publish_time`, `page` as a stringified number) for parity with the original Python API — keep them stable.
- `engines.node >= 18.17` is required for `fetch`, `AbortSignal.timeout`, and `Headers.getSetCookie`.
