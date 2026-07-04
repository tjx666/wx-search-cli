import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI_PATH = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

export interface CliResult {
    code: number;
    stdout: string;
    stderr: string;
}

/** Run the built CLI (dist/index.js) as a child process; never throws. */
export function runCli(args: string[]): Promise<CliResult> {
    return new Promise((resolve) => {
        execFile(process.execPath, [CLI_PATH, ...args], (error, stdout, stderr) => {
            resolve({ code: error ? ((error.code as number) ?? 1) : 0, stdout, stderr });
        });
    });
}
