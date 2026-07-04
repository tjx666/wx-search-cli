#!/usr/bin/env node
import { parseArgs } from 'node:util';

import {
    getArticleContent,
    sogouWeixinSearch,
    sogouWeixinSearchAll,
} from './weixin-search.js';

export const CLI_NAME = 'wx-search-cli';
export const CLI_VERSION = '0.1.0';

const HELP = `${CLI_NAME} v${CLI_VERSION}
Search and read WeChat official account (公众号) articles via Sogou WeChat search.

Usage:
  ${CLI_NAME} search <query> [--page <n>]            Search articles, one page (JSON to stdout)
  ${CLI_NAME} search-all <query> [--max-pages <n>]   Search with auto pagination (JSON to stdout)
  ${CLI_NAME} content <real_url> [--referer <url>]   Fetch article body text (plain text to stdout)

Options:
  --page <n>        Page number for search (default: 1)
  --max-pages <n>   Max pages for search-all (default: 10)
  --referer <url>   Referer header for content, typically the "link" field from search results
  -h, --help        Show this help
  -v, --version     Show version

Examples:
  ${CLI_NAME} search "人工智能"
  ${CLI_NAME} search "人工智能" --page 2
  ${CLI_NAME} search-all "人工智能" --max-pages 3
  ${CLI_NAME} content "https://mp.weixin.qq.com/s?src=11&..." --referer "https://weixin.sogou.com/link?..."
`;

function fail(message: string): never {
    console.error(`Error: ${message}`);
    console.error(`Run "${CLI_NAME} --help" for usage.`);
    process.exit(1);
}

function parsePositiveInt(raw: string, flag: string): number {
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value) || value < 1) {
        fail(`${flag} expects a positive integer, got "${raw}"`);
    }
    return value;
}

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            page: { type: 'string' },
            'max-pages': { type: 'string' },
            referer: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
            version: { type: 'boolean', short: 'v' },
        },
    });

    if (values.version) {
        console.log(CLI_VERSION);
        return;
    }

    const [command, arg] = positionals;
    if (values.help || !command) {
        console.log(HELP);
        return;
    }

    switch (command) {
        case 'search': {
            if (!arg) fail('search requires a <query> argument');
            const page = values.page ? parsePositiveInt(values.page, '--page') : 1;
            // strict mode so failures (anti-spider, network) surface as errors
            // instead of silently printing an empty array
            const results = await sogouWeixinSearch(arg, page, true);
            console.log(JSON.stringify(results, null, 2));
            break;
        }
        case 'search-all': {
            if (!arg) fail('search-all requires a <query> argument');
            const maxPages = values['max-pages']
                ? parsePositiveInt(values['max-pages'], '--max-pages')
                : 10;
            const results = await sogouWeixinSearchAll(arg, maxPages);
            console.log(JSON.stringify(results, null, 2));
            break;
        }
        case 'content': {
            if (!arg) fail('content requires a <real_url> argument');
            const content = await getArticleContent(arg, values.referer);
            // getArticleContent reports failures as strings rather than
            // throwing (kept for API parity with the original Python project),
            // so map that sentinel prefix to a proper CLI error here
            if (content.startsWith('Failed to get article content:')) {
                fail(content);
            }
            console.log(content);
            break;
        }
        default:
            fail(`unknown command "${command}"`);
    }
}

main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
});
