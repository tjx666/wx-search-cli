import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Rebuild dist/ so e2e tests always run against the current source. */
export default function setup(): void {
    const root = fileURLToPath(new URL('..', import.meta.url));
    execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], {
        cwd: root,
        stdio: 'inherit',
    });
}
