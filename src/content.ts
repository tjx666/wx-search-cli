/**
 * Fetching WeChat article body text. HTML parsing lives in parsers.ts.
 */
import { BROWSER_UA, REQUEST_TIMEOUT_MS } from './constants.js';
import { extractArticleText } from './parsers.js';

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

        const text = extractArticleText(await response.text());
        return text ?? '';
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Failed to get article content: ${message}`;
    }
}
