import { defineConfig, type Plugin } from 'vite';
import { resolve, sep } from 'node:path';

// Development server: serves the player page and the example decks from this checkout.
const optionalStubs = Object.fromEntries(
  ['pptxgenjs', '@myriaddreamin/typst.ts', '@myriaddreamin/typst-ts-web-compiler', '@myriaddreamin/typst-ts-renderer'].map(
    (name) => [name, resolve(__dirname, 'src/stubs/empty.ts')],
  ),
);

/**
 * The engine lazily loads chunks for features this project never uses: video
 * export (mp4-muxer and webm-muxer, both deprecated upstream), PDF and PPTX
 * export, Lottie, html2canvas, 3D model loaders, post-processing passes and
 * the Typst compiler. Those chunks resolve to the empty stub, which keeps
 * them out of every build; the MathJax bundle is kept.
 */
export const UNUSED_ENGINE_CHUNKS = /(?:^|[\\/])(?:(?:mp4|webm)-muxer|jspdf\.es\.min|lottie|html2canvas|GLTFLoader|OBJLoader|MTLLoader|BokehPass|UnrealBloomPass|FontLoader|TextGeometry|wasm-pack-shim)-[\w-]+\.js$/;

export function dropEngineMuxers(stub: string): Plugin {
  return {
    name: 'zoomdeck-drop-unused-engine-chunks',
    enforce: 'pre',
    resolveId(id, importer) {
      if (UNUSED_ENGINE_CHUNKS.test(id) && importer && /manim-web/.test(importer)) return stub;
      return null;
    },
  };
}

/** Reload the page when a deck file that is not a module changes (Markdown, deck.json, assets). */
function deckReload(): Plugin {
  const dir = resolve(__dirname, 'examples');
  return {
    name: 'zoomdeck-deck-reload',
    configureServer(server) {
      server.watcher.add(dir);
      const onChange = (file: string) => {
        if (!file.startsWith(dir + sep) || /\.(ts|js|mjs|tsx)$/.test(file)) return;
        server.ws.send({ type: 'full-reload' });
      };
      for (const event of ['change', 'add', 'unlink'] as const) server.watcher.on(event, onChange);
    },
  };
}

export default defineConfig({
  root: resolve(__dirname),
  plugins: [dropEngineMuxers(resolve(__dirname, 'src/stubs/empty.ts')), deckReload()],
  resolve: { alias: optionalStubs },
  optimizeDeps: { entries: ['index.html'] },
  server: { fs: { allow: [resolve(__dirname), resolve(__dirname, '..')] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'index.html') },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
