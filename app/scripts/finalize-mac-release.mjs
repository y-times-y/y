#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

function run(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit' })
}

function output(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  return execFileSync(command, args, { encoding: 'utf8' })
}

function sha512(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

function fileMeta(file) {
  return {
    size: readFileSync(file).byteLength,
    sha512: sha512(file)
  }
}

function packageInfo() {
  return JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
}

function verifyAutoUpdateZip(zipPath) {
  const root = mkdtempSync(join(tmpdir(), 'y-zip-verify-'))
  try {
    run('ditto', ['-x', '-k', zipPath, root])
    const appPath = join(root, 'y.app')
    if (!existsSync(appPath)) throw new Error(`Auto-update zip did not contain y.app: ${zipPath}`)
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const info = packageInfo()
const version = info.version
const appPath = resolve('dist/mac-arm64/y.app')
const zipPath = resolve(`dist/${info.name}-${version}-arm64-mac.zip`)
const dmgPath = resolve(`dist/${info.name}-${version}.dmg`)
const latestPath = resolve('dist/latest-mac.yml')

if (!existsSync(appPath)) throw new Error(`Built app not found: ${appPath}`)
if (!existsSync(dmgPath)) throw new Error(`DMG not found: ${dmgPath}`)

// electron-builder's generated zip can flatten framework symlinks on macOS,
// which makes Squirrel reject the update as a code-signature failure. Repack
// with ditto so framework symlinks survive extraction exactly as Gatekeeper
// expects.
rmSync(zipPath, { force: true })
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath])
verifyAutoUpdateZip(zipPath)

const zip = fileMeta(zipPath)
const dmg = fileMeta(dmgPath)
const releaseDate = new Date().toISOString()
const latest = `version: ${version}
files:
  - url: ${basename(zipPath)}
    sha512: ${zip.sha512}
    size: ${zip.size}
  - url: ${basename(dmgPath)}
    sha512: ${dmg.sha512}
    size: ${dmg.size}
path: ${basename(zipPath)}
sha512: ${zip.sha512}
releaseDate: '${releaseDate}'
`

writeFileSync(latestPath, latest)
console.log(`Wrote ${latestPath}`)
console.log(output('sed', ['-n', '1,14p', latestPath]))
