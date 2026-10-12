import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/DataSim/',
  server: { port: 5174, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4100', '/socket.io': { target: 'http://127.0.0.1:4100', ws: true } } },
});
