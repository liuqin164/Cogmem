// Compile into a staging directory and swap it in only after tsc exits clean.
// `dist` is tracked in git, so a build that deletes it up front loses 1314
// files whenever the compile is interrupted or fails.
import { rmSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const staging = 'dist.next'

rmSync(staging, { recursive: true, force: true })

const tsc = spawnSync(
  process.execPath,
  [
    'node_modules/typescript/bin/tsc',
    '-p',
    'tsconfig.json',
    '--outDir',
    staging,
    '--tsBuildInfoFile',
    `${staging}/.tsbuildinfo`,
  ],
  { stdio: 'inherit' },
)

if (tsc.status !== 0) {
  rmSync(staging, { recursive: true, force: true })
  console.error('build failed; the previous dist/ was left untouched')
  process.exit(tsc.status ?? 1)
}

rmSync('dist', { recursive: true, force: true })
renameSync(staging, 'dist')
