import { defineHexclaveConfig } from '@hexclave/react/config'

export const config = defineHexclaveConfig({
  apps: {
    installed: {
      authentication: { enabled: true },
      analytics: { enabled: true }
    }
  },
  auth: {
    allowSignUp: true,
    otp: { allowSignIn: true },
    password: { allowSignIn: true },
    oauth: {
      accountMergeStrategy: 'link_method',
      providers: {
        google: { type: 'google', allowSignIn: true, allowConnectedAccounts: true },
        github: { type: 'github', allowSignIn: true, allowConnectedAccounts: true }
      }
    }
  }
})
