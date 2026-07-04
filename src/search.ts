/**
 * Network orchestration for Sogou WeChat search: fetch the search page,
 * resolve each result's /link redirect to the real mp.weixin.qq.com URL.
 * All HTML parsing lives in parsers.ts.
 */
import { BROWSER_UA, REQUEST_TIMEOUT_MS, SOGOU_BASE_URL } from './constants.js';
import {
    extractRealUrlFromLinkPage,
    extractSessionCookie,
    isAntispiderResponse,
    parseSearchPage,
} from './parsers.js';
import type { WeixinSearchResult } from './types.js';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Search WeChat official account articles on Sogou WeChat search.
 *
 * @param query search keyword
 * @param page page number, defaults to 1
 * @param strict when true, throw on non-200 / anti-spider / parse errors
 *   instead of returning an empty array (used by pagination to stop early)
 */
export async function sogouWeixinSearch(
    query: string,
    page = 1,
    strict = false,
): Promise<WeixinSearchResult[]> {
    const headers = {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        Pragma: 'no-cache',
        Referer: `${SOGOU_BASE_URL}/weixin?query=${encodeURIComponent(query)}`,
        'User-Agent': BROWSER_UA,
    };

    const searchUrl = new URL(`${SOGOU_BASE_URL}/weixin`);
    searchUrl.search = new URLSearchParams({
        type: '2',
        s_from: 'input',
        query,
        ie: 'utf8',
        page: String(page),
        _sug_: 'n',
        _sug_type_: '',
    }).toString();

    try {
        const response = await fetch(searchUrl, {
            headers,
            redirect: 'follow',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (response.status !== 200) {
            if (strict) {
                throw new Error(`Sogou WeChat search returned unexpected status: ${response.status}`);
            }
            return [];
        }

        const body = await response.text();
        if (isAntispiderResponse(response.url, body)) {
            if (strict) {
                throw new Error(
                    'Sogou WeChat search triggered anti-spider verification (rate limited); wait a while and retry',
                );
            }
            return [];
        }

        const sessionCookie = extractSessionCookie(response);
        const items = parseSearchPage(body, SOGOU_BASE_URL);

        const results: WeixinSearchResult[] = [];
        // sequential on purpose: parallelizing the /link requests sharply
        // raises the captcha risk
        for (const item of items) {
            let realUrl = '';
            try {
                realUrl = await getRealUrlFromSogou(item.link, {
                    cookie: sessionCookie,
                    referer: searchUrl.toString(),
                });
            } catch {
                // best-effort: keep the Sogou link even if resolution fails
            }

            results.push({
                title: item.title,
                link: item.link,
                real_url: realUrl,
                publish_time: item.publishTime,
                page: String(page),
            });
        }

        return results;
    } catch (error) {
        if (strict) {
            throw error instanceof Error ? error : new Error(String(error));
        }
        return [];
    }
}

/**
 * Search all pages, automatically paginating until a page returns no
 * results or `maxPages` is reached. Individual pages run in strict mode so
 * that anti-spider blocks abort pagination instead of silently returning
 * partial data.
 */
export async function sogouWeixinSearchAll(
    query: string,
    maxPages = 10,
): Promise<WeixinSearchResult[]> {
    const allResults: WeixinSearchResult[] = [];
    for (let page = 1; page <= maxPages; page++) {
        const results = await sogouWeixinSearch(query, page, true);
        if (results.length === 0) {
            break;
        }
        allResults.push(...results);
        // throttle between pages to avoid Sogou rate limiting
        if (page < maxPages) {
            await sleep(1000);
        }
    }
    return allResults;
}

/**
 * Resolve a Sogou redirect link to the real mp.weixin.qq.com article URL
 * (see {@link extractRealUrlFromLinkPage} for the extraction technique).
 * Returns an empty string on failure.
 *
 * `options.cookie` should be the session cookies issued by the search
 * response (see {@link extractSessionCookie}); without them Sogou serves an
 * anti-spider challenge instead of the redirect page.
 */
export async function getRealUrlFromSogou(
    sogouUrl: string,
    options: { cookie?: string; referer?: string } = {},
): Promise<string> {
    const headers: Record<string, string> = {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        Pragma: 'no-cache',
        'User-Agent': BROWSER_UA,
    };
    if (options.cookie) {
        headers.Cookie = options.cookie;
    }
    if (options.referer) {
        headers.Referer = options.referer;
    }

    try {
        const response = await fetch(sogouUrl, {
            headers,
            redirect: 'follow',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        const body = await response.text();
        if (isAntispiderResponse(response.url, body)) {
            return '';
        }

        return extractRealUrlFromLinkPage(body);
    } catch {
        return '';
    }
}
