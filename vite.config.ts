import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages project sites
// (served from https://<org>.github.io/<repo>/) without hardcoding the repo name.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
});
