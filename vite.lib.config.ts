import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { dropEngineMuxers } from './vite.config';

// Library build: dist/zoomdeck.js (ES module) for npm consumers. The rendering
// engine and the other runtime dependencies stay external; fonts and the
// player stylesheet are inlined.
const stub = resolve(__dirname, 'src/stubs/empty.ts');
const optionalStubs = Object.fromEntries(
  ['pptxgenjs', '@myriaddreamin/typst.ts', '@myriaddreamin/typst-ts-web-compiler', '@myriaddreamin/typst-ts-renderer'].map((name) => [name, stub]),
);

export default defineConfig({
  root: resolve(__dirname),
  plugins: [dropEngineMuxers(stub)],
  resolve: { alias: optionalStubs },
  esbuild: { keepNames: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    lib: { entry: resolve(__dirname, 'src/index.ts'), formats: ['es'], fileName: 'zoomdeck' },
    rollupOptions: { external: ['manim-web', 'three', 'markdown-it', 'gifuct-js', 'roughjs', /^three\//] },
  },
});
