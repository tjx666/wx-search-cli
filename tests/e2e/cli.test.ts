/**
 * E2E tests: run the built CLI (dist/index.js, compiled by globalSetup) as a
 * real child process against a local mock of the Sogou endpoints, selected
 * via the WX_SOGOU_BASE_URL env override.
 *
 * The mock reproduces the behaviors the scraper depends on:
 * - the search response issues session cookies via Set-Cookie
 * - /link returns the redirect page ONLY when those cookies come back,
 *   otherwise it serves an anti-spider page (like live Sogou does)
 * - the redirect page builds the article URL via `url += '...'` fragments
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

interface CliResult {
    code: number;
    stdout: string;
    stderr: string;
}

function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
    return new Promise((resolve) => {
        execFile(
            process.execPath,
            [CLI_PATH, ...args],
            { env: { ...process.env, ...env } },
            (error, stdout, stderr) => {
                resolve({ code: error ? (error.code as number) ?? 1 : 0, stdout, stderr });
            },
        );
    });
}

/** Mock Sogou/WeChat server; returns its base URL. */
function startMockServer(): Promise<{ server: Server; base: string }> {
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (url.pathname === '/weixin') {
            // page 2 has no results so search-all stops there
            if (url.searchParams.get('page') !== '1') {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                res.end('<html><body><div class="no-result">empty</div></body></html>');
                return;
            }
            res.writeHead(200, {
                'content-type': 'text/html; charset=utf-8',
                // session cookies the /link endpoint will demand back
                'set-cookie': [
                    'SNUID=E2ETESTSNUID; path=/',
                    'SUID=E2ETESTSUID; path=/; domain=.sogou.com',
                ],
            });
            res.end(`<!DOCTYPE html><html><body><ul class="news-list">
                <li id="sogou_vr_11002601_box_0"><div class="txt-box">
                    <h3><a href="/link?url=e2e_first" id="sogou_vr_11002601_title_0">E2E 测试文章</a></h3>
                    <div class="s-p"><span class="s2"><script>document.write(timeConvert('1735689600'))</script></span></div>
                </div></li>
            </ul></body></html>`);
            return;
        }

        if (url.pathname === '/link') {
            // live Sogou serves a captcha instead of the redirect page when
            // the session cookies from the search response are missing —
            // this is what makes the happy-path test prove cookie forwarding
            if (!req.headers.cookie?.includes('SNUID=E2ETESTSNUID')) {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                res.end('<html><head><link href="/anti.min.css"></head><body>captcha</body></html>');
                return;
            }
            const articleUrl = `${base}/article`;
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(`<html><body><script>var url = '';
                url += '${articleUrl.slice(0, 10)}';
                url += '${articleUrl.slice(10)}';
                window.location.replace(url)</script></body></html>`);
            return;
        }

        if (url.pathname === '/article') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(readFileSync(new URL('../fixtures/article.html', import.meta.url), 'utf8'));
            return;
        }

        if (url.pathname === '/no-content') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end('<html><body><p>not an article page</p></body></html>');
            return;
        }

        if (url.pathname === '/antispider-search') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(readFileSync(new URL('../fixtures/antispider.html', import.meta.url), 'utf8'));
            return;
        }

        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('<html><body>404</body></html>');
    });

    let base = '';
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (address === null || typeof address === 'string') {
                throw new Error('unexpected server address');
            }
            base = `http://127.0.0.1:${address.port}`;
            resolve({ server, base });
        });
    });
}

let server: Server;
let base: string;

beforeAll(async () => {
    ({ server, base } = await startMockServer());
});

afterAll(() => {
    server.close();
});

describe('search', () => {
    it('prints resolved results as JSON (session cookies forwarded to /link)', async () => {
        const { code, stdout } = await runCli(['search', '测试'], { WX_SOGOU_BASE_URL: base });

        expect(code).toBe(0);
        const results = JSON.parse(stdout);
        expect(results).toEqual([
            {
                title: 'E2E 测试文章',
                link: `${base}/link?url=e2e_first`,
                real_url: `${base}/article`,
                publish_time: '2025-01-01T00:00:00.000Z',
                page: '1',
            },
        ]);
    });

    it('exits 1 with a rate-limit message on anti-spider pages (strict mode)', async () => {
        // point the whole flow at a path whose search endpoint serves captcha
        const { code, stderr } = await runCli(['search', '测试'], {
            WX_SOGOU_BASE_URL: `${base}/antispider-search?x=`,
        });

        expect(code).toBe(1);
        expect(stderr).toContain('anti-spider');
    });

    it('exits 1 when the search endpoint errors', async () => {
        const { code, stderr } = await runCli(['search', '测试'], {
            WX_SOGOU_BASE_URL: `${base}/missing`,
        });

        expect(code).toBe(1);
        expect(stderr).toContain('unexpected status: 404');
    });
});

describe('search-all', () => {
    it('paginates until an empty page and aggregates results', async () => {
        const { code, stdout } = await runCli(['search-all', '测试', '--max-pages', '3'], {
            WX_SOGOU_BASE_URL: base,
        });

        expect(code).toBe(0);
        const results = JSON.parse(stdout);
        expect(results).toHaveLength(1);
        expect(results[0].page).toBe('1');
    }, 15_000);
});

describe('content', () => {
    it('prints the article body text', async () => {
        const { code, stdout } = await runCli(['content', `${base}/article`]);

        expect(code).toBe(0);
        expect(stdout.trimEnd()).toBe('第一段内容。\n第二段\n紧跟着的文字\n引用的\n重点\n内容');
    });

    it('prints nothing (exit 0) for pages without #js_content', async () => {
        const { code, stdout } = await runCli(['content', `${base}/no-content`]);

        expect(code).toBe(0);
        expect(stdout.trim()).toBe('');
    });

    it('exits 1 when the article request fails', async () => {
        const { code, stderr } = await runCli(['content', `${base}/missing-article`]);

        expect(code).toBe(1);
        expect(stderr).toContain('Failed to get article content');
    });
});

describe('cli basics (no network)', () => {
    it('--version prints the version', async () => {
        const { code, stdout } = await runCli(['--version']);
        expect(code).toBe(0);
        expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('--help prints usage', async () => {
        const { code, stdout } = await runCli(['--help']);
        expect(code).toBe(0);
        expect(stdout).toContain('Usage:');
        expect(stdout).toContain('search-all');
    });

    it('skill prints the bundled SKILL.md', async () => {
        const { code, stdout } = await runCli(['skill']);
        expect(code).toBe(0);
        expect(stdout).toContain('name: wx-search');
        expect(stdout).toContain('## Typical workflow');
    });

    it('unknown commands exit 1', async () => {
        const { code, stderr } = await runCli(['frobnicate']);
        expect(code).toBe(1);
        expect(stderr).toContain('unknown command');
    });

    it('search without a query exits 1', async () => {
        const { code, stderr } = await runCli(['search']);
        expect(code).toBe(1);
        expect(stderr).toContain('requires a <query>');
    });
});
