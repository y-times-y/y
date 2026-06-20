import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // esbuild ships a native binary and must resolve from node_modules at runtime.
        external: ['esbuild']
      },
      copyPublicDir: false
    },
    publicDir: resolve('src/main/assets')
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@userland-seed': resolve('userland-seed')
      }
    },
    optimizeDeps: {
      include: ['@xterm/xterm', '@xterm/addon-fit']
    },
    plugins: [react()]
  }
})
