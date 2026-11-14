import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { dropEngineMuxers } from './vite.config';

// Self-contained build: dist/zoomdeck.standalone.js, one ES module with the engine, the fonts,
// the player stylesheet and the <zoom-deck> element inside, for pages without a bundler and for
// notebook cells. Nothing is external; dynamic imports are folded in, so one file is all a page
// needs (the documentation site serves it as zoomdeck.js).
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
    outDir: 'dist/standalone',
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    lib: { entry: resolve(__dirname, 'src/element.ts'), formats: ['es'], fileName: () => 'zoomdeck.js' },
    rollupOptions: { output: { chunkFileNames: '[name]-[hash].js' } },
  },
});
