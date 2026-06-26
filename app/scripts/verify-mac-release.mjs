#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

function run(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit' })
}

function output(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  return execFileSync(command, args, { encoding: 'utf8' })
}

async function findBuiltApp() {
  const dist = resolve('dist')
  const entries = await readdir(dist, { withFileTypes: true })
  const macDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
    .map((entry) => join(dist, entry.name, 'y.app'))

  const appPath = macDirs.find((candidate) => existsSync(candidate))
  if (!appPath) throw new Error('Could not find built y.app under dist/mac*.')
  return appPath
}

async function defaultDmgPath() {
  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
  const expected = join(resolve('dist'), `${packageJson.name}-${packageJson.version}.dmg`)
  if (existsSync(expected)) return expected

  const dist = resolve('dist')
  const dmg = (await readdir(dist)).find((name) => /^y-\d+\.\d+\.\d+\.dmg$/u.test(name))
  if (!dmg) throw new Error('Could not find y versioned DMG under dist/.')
  return join(dist, dmg)
}

const appPath = resolve(process.argv[2] || (await findBuiltApp()))
const dmgPath = resolve(process.argv[3] || (await defaultDmgPath()))

run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
run('codesign', ['--verify', '--verbose=2', dmgPath])
run('xcrun', ['stapler', 'validate', dmgPath])

const mountOutput = output('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly'])
const mountPoint = mountOutput
  .split('\n')
  .map((line) => line.match(/(\/Volumes\/.+)$/u)?.[1])
  .find(Boolean)

if (!mountPoint) {
  throw new Error(`Could not find mounted DMG volume in hdiutil output:\n${mountOutput}`)
}

try {
  const mountedAppPath = join(mountPoint, 'y.app')
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', mountedAppPath])
  run('spctl', ['--assess', '--type', 'execute', '--verbose=4', mountedAppPath])
} finally {
  run('hdiutil', ['detach', mountPoint])
}

console.log('macOS release artifact verification passed.')
