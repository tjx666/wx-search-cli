import { defineConfig } from 'vitest/config';

/** Live tests hitting real Sogou — run via `bun run test:live`. */
export default defineConfig({
    test: {
        include: ['tests/live/**/*.test.ts'],
        globalSetup: ['tests/global-setup.ts'],
        // real network calls: generous timeout, no parallelism
        testTimeout: 120_000,
        fileParallelism: false,
    },
});
