import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('shared') }
    },
    build: {
      rollupOptions: { input: { index: resolve('electron/main.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('shared') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('preload/index.ts'),
          mic: resolve('preload/mic.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src',
    resolve: {
      alias: {
        '@': resolve('src'),
        '@shared': resolve('shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/index.html'),
          panel: resolve('src/panel.html'),
          mic: resolve('src/mic.html')
        }
      }
    }
  }
})
