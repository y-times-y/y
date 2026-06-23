#!/usr/bin/env node
import { notarize } from '@electron/notarize'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

function run(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit' })
}

function signingIdentity() {
  if (process.env.CSC_NAME) return process.env.CSC_NAME
  if (process.env.MAC_SIGN_IDENTITY) return process.env.MAC_SIGN_IDENTITY

  const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8'
  })
  const match = identities.match(/"((?:Developer ID Application|Apple Distribution):[^"]+)"/u)
  if (!match) {
    throw new Error('No Developer ID Application signing identity found. Set CSC_NAME or install the certificate.')
  }
  return match[1]
}

function notarizeCredentials() {
  const {
    APPLE_API_KEY,
    APPLE_API_KEY_ID,
    APPLE_API_ISSUER,
    APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_TEAM_ID,
    APPLE_KEYCHAIN,
    APPLE_KEYCHAIN_PROFILE
  } = process.env

  if (APPLE_KEYCHAIN_PROFILE) {
    return {
      keychainProfile: APPLE_KEYCHAIN_PROFILE,
      ...(APPLE_KEYCHAIN ? { keychain: APPLE_KEYCHAIN } : {})
    }
  }

  if (APPLE_API_KEY || APPLE_API_KEY_ID || APPLE_API_ISSUER) {
    if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) {
      throw new Error('Set all three App Store Connect API env vars: APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER.')
    }
    return {
      appleApiKey: APPLE_API_KEY,
      appleApiKeyId: APPLE_API_KEY_ID,
      appleApiIssuer: APPLE_API_ISSUER
    }
  }

  if (APPLE_ID || APPLE_APP_SPECIFIC_PASSWORD || APPLE_TEAM_ID) {
    if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
      throw new Error('Set all three Apple ID env vars: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.')
    }
    return {
      appleId: APPLE_ID,
      appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
      teamId: APPLE_TEAM_ID
    }
  }

  throw new Error(
    'No Apple notarization credentials found. Use APPLE_KEYCHAIN_PROFILE, App Store Connect API env vars, or Apple ID app-specific password env vars.'
  )
}

async function defaultDmgPath() {
  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
  return join(resolve('dist'), `${packageJson.name}-${packageJson.version}.dmg`)
}

const dmgPath = resolve(process.argv[2] || (await defaultDmgPath()))
if (!existsSync(dmgPath)) {
  throw new Error(`DMG not found: ${dmgPath}`)
}

run('codesign', ['--force', '--timestamp', '--sign', signingIdentity(), dmgPath])
console.log(`Notarizing DMG: ${dmgPath}`)
await notarize({
  appPath: dmgPath,
  ...notarizeCredentials()
})
console.log('DMG notarization complete.')
