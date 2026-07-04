import * as cheerio from 'cheerio';

export const REQUEST_TIMEOUT_MS = 15_000;

export interface WeixinSearchResult {
    /** Article title */
    title: string;
    /** Sogou redirect link (relative links are resolved against weixin.sogou.com) */
    link: string;
    /** Real article URL on mp.weixin.qq.com, empty string if resolution failed */
    real_url: string;
    /** Publish time text as shown on the search result page */
    publish_time: string;
    /** Page number this result came from (stringified for parity with the Python version) */
    page: string;
}

const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0';

/**
 * Detect Sogou anti-spider pages that otherwise look like empty results:
 * either the request got redirected to an antispider URL, or the page
 * contains the captcha widget (seccoderight) / its stylesheet (anti.min.css).
 */
function isAntispiderResponse(finalUrl: string, body: string): boolean {
    const url = finalUrl.toLowerCase();
    const text = body.toLowerCase();
    return (
        url.includes('antispider') || text.includes('seccoderight') || text.includes('anti.min.css')
    );
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a Cookie header from the Set-Cookie headers of a response.
 * Sogou's /link redirect endpoint only works with the session cookies
 * (SNUID/SUID/ABTEST) issued alongside the search request — any other
 * cookie (or none) gets an anti-spider challenge instead.
 */
function extractSessionCookie(response: Response): string {
    return response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; ');
}

/**
 * The search result page renders publish time via inline JS like
 * `document.write(timeConvert('1783164489'))`. Extract the unix timestamp
 * and format it as ISO 8601; fall back to the raw text if the pattern
 * ever changes.
 */
function formatPublishTime(rawText: string): string {
    const match = rawText.match(/timeConvert\('(\d+)'\)/);
    if (!match) {
        return rawText;
    }
    return new Date(Number(match[1]) * 1000).toISOString();
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
        Referer: `https://weixin.sogou.com/weixin?query=${encodeURIComponent(query)}`,
        'User-Agent': BROWSER_UA,
    };

    const searchUrl = new URL('https://weixin.sogou.com/weixin');
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

        const $ = cheerio.load(body);
        const titleLinks = $('a[id*="sogou_vr_11002601_title_"]').toArray();
        const publishTimes = $(
            'li[id*="sogou_vr_11002601_box_"] > div.txt-box > div.s-p > span.s2',
        ).toArray();

        const results: WeixinSearchResult[] = [];
        const count = Math.min(titleLinks.length, publishTimes.length);
        for (let i = 0; i < count; i++) {
            const titleEl = $(titleLinks[i]);
            const title = titleEl.text().trim();
            let link = titleEl.attr('href') ?? '';
            if (link && !link.startsWith('http')) {
                link = `https://weixin.sogou.com${link}`;
            }

            let realUrl = '';
            try {
                realUrl = await getRealUrlFromSogou(link, {
                    cookie: sessionCookie,
                    referer: searchUrl.toString(),
                });
            } catch {
                // best-effort: keep the Sogou link even if resolution fails
            }

            results.push({
                title,
                link,
                real_url: realUrl,
                publish_time: formatPublishTime($(publishTimes[i]).text().trim()),
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
 * Resolve a Sogou redirect link to the real mp.weixin.qq.com article URL.
 *
 * The Sogou redirect page builds the destination with inline JS that
 * concatenates the URL from many small fragments:
 *
 *   url += 'weixin.qq.com/s?src=11&t';
 *   url += 'imestamp=...';
 *   ...
 *
 * so we extract every `url += '...'` string literal, join them, and strip
 * the `@` noise characters Sogou injects. Older page variants emit the
 * fragments without the scheme (`weixin.qq.com/s?...`) and add `https://mp.`
 * in separate JS, so we only prepend it when missing. Returns an empty
 * string on failure.
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

        const marker = "url += '";
        const urlParts: string[] = [];
        let searchIndex = 0;
        while (true) {
            const partStart = body.indexOf(marker, searchIndex);
            if (partStart === -1) {
                break;
            }
            const partEnd = body.indexOf("'", partStart + marker.length);
            if (partEnd === -1) {
                break;
            }
            urlParts.push(body.slice(partStart + marker.length, partEnd));
            searchIndex = partEnd + 1;
        }

        const fullUrl = urlParts.join('').replaceAll('@', '');
        if (!fullUrl) {
            return '';
        }
        return fullUrl.startsWith('http') ? fullUrl : `https://mp.${fullUrl}`;
    } catch {
        return '';
    }
}

/** Minimal structural type for cheerio/domhandler DOM nodes we traverse. */
interface DomNode {
    type: string;
    data?: string;
    children?: DomNode[];
}

/** Collect all descendant text nodes in document order (like XPath `//text()`). */
function collectTextNodes(node: DomNode, out: string[]): void {
    for (const child of node.children ?? []) {
        if (child.type === 'text') {
            const text = (child.data ?? '').trim();
            if (text) {
                out.push(text);
            }
        } else if (child.type === 'tag') {
            collectTextNodes(child, out);
        }
    }
}

/**
 * Fetch the main body text of a WeChat official account article.
 *
 * @param realUrl real mp.weixin.qq.com article URL
 * @param referer optional Referer header, typically the Sogou link the
 *   article was discovered from
 * @returns article text, or an error message string on failure (mirrors the
 *   original Python implementation which never throws from this function)
 */
export async function getArticleContent(realUrl: string, referer?: string): Promise<string> {
    const headers: Record<string, string> = {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        priority: 'u=0, i',
        'sec-ch-ua': '"Microsoft Edge";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'cross-site',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': BROWSER_UA,
    };
    if (referer) {
        headers.referer = referer;
    }

    try {
        // "https://mp." alone means URL resolution produced no fragments
        if (!realUrl || realUrl === 'https://mp.') {
            return 'Failed to get article content: no valid WeChat article URL provided';
        }

        const response = await fetch(realUrl, {
            headers,
            redirect: 'follow',
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const $ = cheerio.load(await response.text());
        const contentRoot = $('#js_content').get(0) as DomNode | undefined;
        if (!contentRoot) {
            return '';
        }
        const texts: string[] = [];
        collectTextNodes(contentRoot, texts);
        return texts.join('\n');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Failed to get article content: ${message}`;
    }
}
