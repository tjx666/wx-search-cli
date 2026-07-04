export const REQUEST_TIMEOUT_MS = 15_000;

export const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0';

/**
 * Sogou WeChat search origin. Overridable via env so e2e tests can point the
 * whole search flow (search page + /link redirect resolution) at a local mock
 * server instead of live Sogou, which rate-limits aggressively.
 */
export const SOGOU_BASE_URL = process.env.WX_SOGOU_BASE_URL ?? 'https://weixin.sogou.com';
