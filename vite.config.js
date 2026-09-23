import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5199, host: 'localhost' },
  optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
});
