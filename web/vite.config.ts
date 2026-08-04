import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * base береться зі змінної, бо GitHub Pages віддає сайт за адресою
 * /<назва-репозиторію>/, а не з кореня. Без цього всі шляхи до ассетів
 * після деплою ведуть у нікуди — класична пастка Pages.
 *
 * Локально base = '/', у CI підставляється назва репозиторію.
 */
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
  build: {
    outDir: 'dist',
    // Один бандл замість десятків чанків: застосунок маленький, а Pages
    // без HTTP/2 push віддає багато файлів повільніше, ніж один.
    chunkSizeWarningLimit: 1500,
  },
});
