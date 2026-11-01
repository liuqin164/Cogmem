// Deprecated alias (#112): `cogmem-explain-recall` is `cogmem explain-recall`. Removed with this directory
// in the next breaking release; `cogmem-mcp` is not here because host configurations
// name it as a server command and are not rewritten on upgrade.
//
// The subcommand runs as a child process rather than through a dynamic import: a bin
// guarded by `import.meta.main` does nothing when imported, so the alias would exit 0
// having done no work (init was exactly that). The extension comes from this file, so
// the same entry works from src/ and from dist/.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { warnDeprecatedAlias } from '../CliArgs.js';

warnDeprecatedAlias('explain-recall');
const target = fileURLToPath(new URL('../explain-recall.ts', import.meta.url)).replace(/\.ts$/, import.meta.url.endsWith('.ts') ? '.ts' : '.js');
const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
