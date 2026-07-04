/**
 * Live tests against REAL Sogou/WeChat endpoints — the source of truth for
 * "does the scraper still work today". Run deliberately via `bun run
 * test:live`; excluded from the default `bun run test` so day-to-day dev
 * loops don't hammer Sogou and trip its captcha.
 *
 * Kept intentionally small (one search page + one article fetch, the
 * footprint of a normal user session). A failure here usually means either
 * Sogou changed their page structure or the runner's IP is rate-limited —
 * check the error message before assuming the code broke.
 */
import { describe, expect, it } from 'vitest';

import type { WeixinSearchResult } from '../../src/types.js';
import { runCli } from '../helpers/run-cli.js';

describe.sequential('live sogou weixin search', () => {
    // shared across tests: content test reuses the search results to avoid
    // issuing a second search request
    let resolved: WeixinSearchResult[] = [];

    it('search returns results with resolved real_url', async () => {
        const { code, stdout, stderr } = await runCli(['search', '人工智能']);

        expect(stderr).toBe('');
        expect(code).toBe(0);

        const results: WeixinSearchResult[] = JSON.parse(stdout);
        expect(results.length).toBeGreaterThan(0);

        for (const result of results) {
            expect(result.title).toBeTruthy();
            expect(result.link).toMatch(/^https:\/\/weixin\.sogou\.com\/link/);
            expect(result.page).toBe('1');
        }

        // publish_time should be ISO 8601 (timeConvert extraction working)
        expect(
            results.some((r) => /^\d{4}-\d{2}-\d{2}T/.test(r.publish_time)),
            'no result has an ISO publish_time — timeConvert extraction may be broken',
        ).toBe(true);

        resolved = results.filter((r) => r.real_url.startsWith('https://mp.weixin.qq.com/'));
        // real_url resolution failing across the board = cookie handling or
        // `url +=` extraction broke (or this IP is captcha-blocked)
        expect(
            resolved.length,
            'no real_url resolved — session cookies / redirect extraction may be broken, or IP is rate-limited',
        ).toBeGreaterThan(0);
    }, 120_000);

    it('content fetches the article body of the first resolved result', async () => {
        expect(resolved.length, 'needs a resolved result from the search test').toBeGreaterThan(0);
        const article = resolved[0];

        const { code, stdout } = await runCli([
            'content',
            article.real_url,
            '--referer',
            article.link,
        ]);

        expect(code).toBe(0);
        expect(stdout.trim().length).toBeGreaterThan(0);
    }, 60_000);
});
