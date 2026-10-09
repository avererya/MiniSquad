import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:single` produces dist-single/index.html with everything inlined.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
}));
