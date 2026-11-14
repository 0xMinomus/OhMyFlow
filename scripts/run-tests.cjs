const { buildSync } = require('esbuild')
const { spawnSync } = require('child_process')
const { mkdtempSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')

const tmp = mkdtempSync(join(tmpdir(), 'ohmyflow-test-'))
const outFile = join(tmp, 'unit.test.cjs')

try {
  buildSync({
    entryPoints: [resolve(__dirname, '..', 'tests', 'unit.test.ts')],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    alias: { '@': resolve(__dirname, '..', 'src') },
    external: ['sharp'],
  })
  const res = spawnSync(process.execPath, ['--test', outFile], {
    stdio: 'inherit',
    env: { ...process.env, NODE_PATH: resolve(__dirname, '..', 'node_modules') },
  })
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch {}
}
