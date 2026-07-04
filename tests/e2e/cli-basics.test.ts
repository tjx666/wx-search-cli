/**
 * CLI behaviors that don't hit the network: run the built binary as a real
 * child process and check argument handling and static outputs.
 */
import { describe, expect, it } from 'vitest';

import { runCli } from '../helpers/run-cli.js';

describe('cli basics', () => {
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

    it('content without a URL exits 1', async () => {
        const { code, stderr } = await runCli(['content']);
        expect(code).toBe(1);
        expect(stderr).toContain('requires a <real_url>');
    });
});
