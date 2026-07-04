/**
 * Pure parsing/extraction logic for Sogou WeChat search pages. No network
 * calls here — everything takes strings (or a Response for cookie
 * harvesting) so it can be unit-tested against HTML fixtures.
 */
import * as cheerio from 'cheerio';

/**
 * Detect Sogou anti-spider pages that otherwise look like empty results:
 * either the request got redirected to an antispider URL, or the page
 * contains the captcha widget (seccoderight) / its stylesheet (anti.min.css).
 */
export function isAntispiderResponse(finalUrl: string, body: string): boolean {
    const url = finalUrl.toLowerCase();
    const text = body.toLowerCase();
    return (
        url.includes('antispider') || text.includes('seccoderight') || text.includes('anti.min.css')
    );
}

/**
 * Build a Cookie header from the Set-Cookie headers of a response.
 * Sogou's /link redirect endpoint only works with the session cookies
 * (SNUID/SUID/ABTEST) issued alongside the search request — any other
 * cookie (or none) gets an anti-spider challenge instead.
 */
export function extractSessionCookie(response: Response): string {
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
export function formatPublishTime(rawText: string): string {
    const match = rawText.match(/timeConvert\('(\d+)'\)/);
    if (!match) {
        return rawText;
    }
    return new Date(Number(match[1]) * 1000).toISOString();
}

/** One search result as parsed from the page, before real_url resolution. */
export interface ParsedSearchItem {
    title: string;
    /** Absolute Sogou redirect URL */
    link: string;
    /** Publish time, already normalized by {@link formatPublishTime} */
    publishTime: string;
}

/**
 * Parse the Sogou WeChat search result page into title/link/time triples.
 * Relative hrefs (`/link?url=...`) are resolved against `baseUrl`.
 */
export function parseSearchPage(body: string, baseUrl: string): ParsedSearchItem[] {
    const $ = cheerio.load(body);
    const titleLinks = $('a[id*="sogou_vr_11002601_title_"]').toArray();
    const publishTimes = $(
        'li[id*="sogou_vr_11002601_box_"] > div.txt-box > div.s-p > span.s2',
    ).toArray();

    const items: ParsedSearchItem[] = [];
    const count = Math.min(titleLinks.length, publishTimes.length);
    for (let i = 0; i < count; i++) {
        const titleEl = $(titleLinks[i]);
        let link = titleEl.attr('href') ?? '';
        if (link && !link.startsWith('http')) {
            link = `${baseUrl}${link}`;
        }
        items.push({
            title: titleEl.text().trim(),
            link,
            publishTime: formatPublishTime($(publishTimes[i]).text().trim()),
        });
    }
    return items;
}

/**
 * Extract the real article URL from a Sogou /link redirect page.
 *
 * The page builds the destination with inline JS that concatenates the URL
 * from many small fragments:
 *
 *   url += 'weixin.qq.com/s?src=11&t';
 *   url += 'imestamp=...';
 *   ...
 *
 * so we extract every `url += '...'` string literal, join them, and strip
 * the `@` noise characters Sogou injects. Older page variants emit the
 * fragments without the scheme (`weixin.qq.com/s?...`) and add `https://mp.`
 * in separate JS, so we only prepend it when missing. Returns an empty
 * string when no fragments are found.
 */
export function extractRealUrlFromLinkPage(body: string): string {
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
 * Extract the article body text (`div#js_content` text nodes, one per line)
 * from a WeChat article page. Returns null when the page has no #js_content
 * element (e.g. deleted article or a non-article page).
 */
export function extractArticleText(html: string): string | null {
    const $ = cheerio.load(html);
    const contentRoot = $('#js_content').get(0) as DomNode | undefined;
    if (!contentRoot) {
        return null;
    }
    const texts: string[] = [];
    collectTextNodes(contentRoot, texts);
    return texts.join('\n');
}
