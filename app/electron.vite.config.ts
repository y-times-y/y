import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // Keep these external — required from node_modules at runtime, not bundled:
        //  - esbuild: ships a native binary.
        //  - isomorphic-git: CJS with dynamic require()s (safe-buffer/sha.js) that
        //    don't survive bundling; diff rides along with it.
        external: ['esbuild', 'isomorphic-git', 'diff']
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@userland-seed': resolve('userland-seed')
      }
    },
    plugins: [react()]
  }
})
