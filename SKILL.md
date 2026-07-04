---
name: wx-search
description: Search and read WeChat official account (微信公众号) articles from the command line via Sogou WeChat search. Use this skill whenever the user wants to find, search, read, summarize, or analyze 公众号 articles or WeChat content — including requests like "搜一下公众号关于 X 的文章", "find WeChat articles about X", reading an mp.weixin.qq.com link, or researching Chinese-language coverage of a topic where WeChat official accounts are a primary source.
---

# wx-search: Search & Read WeChat Official Account Articles

`wx-search-cli` searches WeChat official account (公众号) articles through Sogou WeChat search and extracts article body text. Output is JSON (search) or plain text (content) on stdout; all failures exit 1 with the message on stderr.

Run it with `npx wx-search-cli` or `bunx wx-search-cli` (no install needed), or plain `wx-search-cli` if globally installed.

## Typical workflow

1. **Search** for articles by keyword:

   ```bash
   npx wx-search-cli search "人工智能"
   ```

   Output is a JSON array; each item has:
   - `title` — article title
   - `link` — Sogou redirect URL (use as `--referer` when fetching content)
   - `real_url` — resolved `mp.weixin.qq.com` URL (empty string `""` if resolution failed, usually due to rate limiting)
   - `publish_time` — ISO 8601 timestamp
   - `page` — result page number, as a string

2. **Read** an article's body text, passing `real_url` as the argument and `link` as `--referer`:

   ```bash
   npx wx-search-cli content "<real_url>" --referer "<link>"
   ```

## Commands

| Command | Purpose |
| --- | --- |
| `search <query> [--page <n>]` | One page of results (~10 items) as JSON. `--page` defaults to 1. |
| `search-all <query> [--max-pages <n>]` | Auto-paginate (1s delay between pages), stop on empty page or `--max-pages` (default 10). |
| `content <real_url> [--referer <url>]` | Print article body as plain text. |
| `skill` | Print this skill document. |

## Important tips

- **Keep request volume low.** Heavy usage triggers Sogou's captcha; the symptom is `real_url` coming back as `""` or the search command erroring with an anti-spider message. When that happens, back off and retry later — don't hammer the endpoint.
- **Prefer `search` over `search-all`** unless the user genuinely needs many results; fewer requests means less captcha risk.
- **Always pass `--referer`** when fetching content if you have the `link` field — it noticeably improves the success rate against WeChat's anti-scraping checks.
- Search queries in Chinese generally return better results than English for 公众号 content.
- Nonzero exit code means failure; the reason is on stderr. Don't parse stdout on failure.
