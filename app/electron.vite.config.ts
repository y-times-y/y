import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { build as esbuildBundle } from 'esbuild'
import type { Plugin } from 'vite'

function userlandFrameBundlePlugin(): Plugin {
  const entryPoint = resolve('src/renderer/src/userland-frame/main.tsx')

  async function bundleFrame(): Promise<string> {
    const result = await esbuildBundle({
      entryPoints: [entryPoint],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'chrome120',
      jsx: 'automatic',
      write: false,
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production')
      }
    })
    return result.outputFiles[0]?.text ?? ''
  }

  return {
    name: 'y-userland-frame-bundle',
    configureServer(server): void {
      server.middlewares.use('/userland-frame-inline.js', async (_req, res) => {
        try {
          res.statusCode = 200
          res.setHeader('content-type', 'text/javascript; charset=utf-8')
          res.end(await bundleFrame())
        } catch (error) {
          res.statusCode = 500
          res.end(error instanceof Error ? error.stack || error.message : String(error))
        }
      })
    },
    async generateBundle(): Promise<void> {
      this.emitFile({
        type: 'asset',
        fileName: 'userland-frame-inline.js',
        source: await bundleFrame()
      })
    }
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // Native modules must resolve from node_modules at runtime.
        external: ['better-sqlite3', 'esbuild']
      },
      copyPublicDir: false
    },
    publicDir: resolve('src/main/assets')
  },
  preload: {},
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          preview: resolve('src/renderer/preview.html'),
          'userland-frame': resolve('src/renderer/userland-frame.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@userland-seed': resolve('userland-seed')
      }
    },
    optimizeDeps: {
      include: ['@xterm/xterm', '@xterm/addon-fit']
    },
    plugins: [react(), userlandFrameBundlePlugin()]
  }
})
