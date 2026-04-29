import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url'

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    server: {
        port: 5274,
        // Enable polling for WSL (Windows filesystem doesn't support inotify)
        watch: {
            usePolling: true,
            interval: 1000,
        },
    },
    css: {
        preprocessorOptions: {
            scss: {
                // Silence Dart Sass deprecation warnings for @import and slash-div
                // These are expected during migration from LESS and will be addressed
                // when moving to @use/@forward module system
                silenceDeprecations: ['import', 'slash-div', 'legacy-js-api', 'global-builtin', 'color-functions', 'strict-unary'],
            },
        },
    },
    build: {
        sourcemap: false,
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                    'vendor-charts': ['recharts'],
                    'vendor-flow': ['@xyflow/react'],
                    'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
                    'vendor-icons': ['lucide-react'],
                },
            },
        },
    },
})
