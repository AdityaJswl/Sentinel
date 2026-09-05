import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('framer-motion') || id.includes('gsap') || id.includes('lenis')) {
            return 'motion';
          }
          if (id.includes('@radix-ui') || id.includes('cmdk')) return 'primitives';
          if (id.includes('react')) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3002',
    },
  },
  preview: {
    port: 4174,
  },
});
