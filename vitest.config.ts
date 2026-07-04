import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // e2e runs the compiled CLI, so make sure dist/ is fresh
        globalSetup: ['tests/global-setup.ts'],
    },
});
