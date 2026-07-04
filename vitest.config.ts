import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // live tests (real Sogou requests) are opt-in via `bun run test:live`
        include: ['tests/unit/**/*.test.ts', 'tests/e2e/**/*.test.ts'],
        // e2e runs the compiled CLI, so make sure dist/ is fresh
        globalSetup: ['tests/global-setup.ts'],
    },
});
