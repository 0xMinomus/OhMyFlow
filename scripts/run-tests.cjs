const { spawnSync } = require('child_process')
const { resolve } = require('path')

const manifest = resolve(__dirname, '..', 'src-tauri', 'Cargo.toml')
const res = spawnSync('cargo', ['test', '--manifest-path', manifest, '--test', 'engine_tests'], {
  stdio: 'inherit',
  env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` },
})

process.exitCode = res.status ?? 1
