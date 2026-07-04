import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
    extractArticleText,
    extractRealUrlFromLinkPage,
    extractSessionCookie,
    formatPublishTime,
    isAntispiderResponse,
    parseSearchPage,
} from '../../src/parsers.js';

function fixture(name: string): string {
    return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

describe('isAntispiderResponse', () => {
    it('detects antispider redirect URLs', () => {
        expect(
            isAntispiderResponse('https://weixin.sogou.com/antispider/?from=xxx', '<html></html>'),
        ).toBe(true);
    });

    it('detects the captcha widget and stylesheet in the body', () => {
        expect(isAntispiderResponse('https://weixin.sogou.com/weixin', fixture('antispider.html'))).toBe(
            true,
        );
        expect(isAntispiderResponse('https://x.com', '<div class="SecCodeRight">')).toBe(true);
        expect(isAntispiderResponse('https://x.com', '<link href="/Anti.min.CSS">')).toBe(true);
    });

    it('passes normal pages through', () => {
        expect(
            isAntispiderResponse('https://weixin.sogou.com/weixin', fixture('search-page.html')),
        ).toBe(false);
    });
});

describe('extractSessionCookie', () => {
    it('joins the name=value part of every Set-Cookie header', () => {
        const headers = new Headers();
        headers.append('set-cookie', 'SNUID=ABC123; expires=Mon, 01-Jan-2029 00:00:00 GMT; path=/');
        headers.append('set-cookie', 'SUID=DEF456; path=/; domain=.sogou.com');
        headers.append('set-cookie', 'ABTEST=8|1735689600|crown; Path=/');
        const response = new Response('', { headers });

        expect(extractSessionCookie(response)).toBe(
            'SNUID=ABC123; SUID=DEF456; ABTEST=8|1735689600|crown',
        );
    });

    it('returns an empty string when no cookies are set', () => {
        expect(extractSessionCookie(new Response(''))).toBe('');
    });
});

describe('formatPublishTime', () => {
    it('converts the timeConvert timestamp to ISO 8601', () => {
        expect(formatPublishTime("document.write(timeConvert('1735689600'))")).toBe(
            '2025-01-01T00:00:00.000Z',
        );
    });

    it('falls back to the raw text when the pattern is absent', () => {
        expect(formatPublishTime('昨天')).toBe('昨天');
        expect(formatPublishTime('')).toBe('');
    });
});

describe('parseSearchPage', () => {
    it('extracts title, link and publish time for every result', () => {
        const items = parseSearchPage(fixture('search-page.html'), 'https://weixin.sogou.com');

        expect(items).toHaveLength(2);
        expect(items[0]).toEqual({
            title: 'AI 周报：人工智能新进展',
            link: 'https://weixin.sogou.com/link?url=dn9a_first',
            publishTime: '2025-01-01T00:00:00.000Z',
        });
        // absolute hrefs pass through untouched; non-timeConvert time kept raw
        expect(items[1]).toEqual({
            title: '大模型落地实践',
            link: 'https://weixin.sogou.com/link?url=dn9a_second',
            publishTime: '昨天',
        });
    });

    it('resolves relative links against the given base URL', () => {
        const items = parseSearchPage(fixture('search-page.html'), 'http://127.0.0.1:8080');
        expect(items[0].link).toBe('http://127.0.0.1:8080/link?url=dn9a_first');
    });

    it('returns an empty array for pages without results', () => {
        expect(parseSearchPage('<html><body>no results</body></html>', 'https://x.com')).toEqual([]);
    });
});

describe('extractRealUrlFromLinkPage', () => {
    it('joins url += fragments, strips @ noise, and prepends the missing scheme', () => {
        expect(extractRealUrlFromLinkPage(fixture('link-page.html'))).toBe(
            'https://mp.weixin.qq.com/s?src=11&timestamp=1735689600&ver=1&signature=abcDEF*123&new=1',
        );
    });

    it('keeps the scheme when fragments already include it', () => {
        const body = `<script>url += 'https://mp.weixin.qq.com/s';\nurl += '?src=11';</script>`;
        expect(extractRealUrlFromLinkPage(body)).toBe('https://mp.weixin.qq.com/s?src=11');
    });

    it('returns an empty string when no fragments exist', () => {
        expect(extractRealUrlFromLinkPage('<html><body>nothing here</body></html>')).toBe('');
    });
});

describe('extractArticleText', () => {
    it('collects #js_content text nodes in document order, skipping scripts and whitespace', () => {
        expect(extractArticleText(fixture('article.html'))).toBe(
            '第一段内容。\n第二段\n紧跟着的文字\n引用的\n重点\n内容',
        );
    });

    it('returns null when the page has no #js_content', () => {
        expect(extractArticleText('<html><body><p>deleted</p></body></html>')).toBeNull();
    });
});
