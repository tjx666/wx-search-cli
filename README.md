# wx-search-cli

[![CI](https://github.com/tjx666/wx-search-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/tjx666/wx-search-cli/actions/workflows/ci.yml)
[![Live](https://github.com/tjx666/wx-search-cli/actions/workflows/live.yml/badge.svg)](https://github.com/tjx666/wx-search-cli/actions/workflows/live.yml)
[![npm](https://img.shields.io/npm/v/wx-search-cli)](https://www.npmjs.com/package/wx-search-cli)

A command-line tool for searching and reading WeChat official account (公众号) articles, powered by Sogou WeChat search. Results are printed as JSON / plain text to stdout, so it works great as a tool for AI agents (Claude Code, etc.) or in shell pipelines.

## Acknowledgements

This project is a TypeScript/CLI reimplementation of **[fancyboi999/weixin_search_mcp](https://github.com/fancyboi999/weixin_search_mcp)** — all credit for the original idea, the Sogou WeChat search approach, and the URL-resolution technique goes to its author. If you need a Python / MCP-server version, please check out and star the original project.

## Features

- Search WeChat official account articles by keyword via Sogou WeChat search
- Resolve Sogou redirect links to the real `mp.weixin.qq.com` article URLs
- Extract the full article body text
- Auto pagination for fetching multiple pages of results

## Usage

Run directly with npx / bunx (or install globally):

```bash
# search articles (single page, JSON output)
npx wx-search-cli search "人工智能"
npx wx-search-cli search "人工智能" --page 2

# search with auto pagination
npx wx-search-cli search-all "人工智能" --max-pages 3

# fetch article body text (use real_url and link from search results)
npx wx-search-cli content "https://mp.weixin.qq.com/s?src=11&..." --referer "https://weixin.sogou.com/link?..."

# help
npx wx-search-cli --help
```

### Commands

#### `search <query> [--page <n>]`

Search articles and print one page of results as JSON. Each result contains:

- `title` — article title
- `link` — Sogou redirect URL
- `real_url` — resolved `mp.weixin.qq.com` URL (empty string if resolution failed)
- `publish_time` — publish time in ISO 8601
- `page` — page number the result came from

#### `search-all <query> [--max-pages <n>]`

Search multiple pages with automatic pagination (~10 results per page, 1s delay between pages to avoid rate limiting). Stops when a page returns no results or `--max-pages` (default 10) is reached.

#### `content <real_url> [--referer <url>]`

Fetch the main body text of a WeChat article and print it as plain text. Pass the `real_url` field from search results as the argument, and ideally the `link` field via `--referer`.

#### `skill`

Print the bundled [SKILL.md](./SKILL.md) — an [agent skill](https://docs.claude.com/en/docs/claude-code/skills) document teaching AI agents how to use this CLI. Useful for self-serve onboarding:

```bash
npx wx-search-cli skill
```

Failures exit with code 1 and an error message on stderr, so scripts can rely on exit codes.

## Development

```bash
# install dependencies
ni

# run from source
bun run src/index.ts search "关键词"

# build
bun run build

# run tests (unit + CLI basics; no live requests)
bun run test

# live smoke tests against real Sogou (one search + one article fetch;
# excluded from the default test run to avoid tripping the captcha)
bun run test:live
```

## Notes

- This tool depends on the Sogou WeChat search endpoints; changes on their side may break functionality
- Keep the request rate reasonable to avoid being blocked by Sogou or WeChat (heavy usage triggers a captcha and `real_url` comes back empty)
- Fetched content is for learning and research purposes only; comply with applicable laws and regulations

## License

MIT
