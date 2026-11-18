import { defineConfig, type Plugin } from 'vite';
import { resolve, sep } from 'node:path';
import { allowedHosts, padRelay } from './bin/relay.mjs';
import { editorSync } from './bin/sync.mjs';
import { isRecordingFile, recordingStore } from './bin/recordings.mjs';
import { renderStore } from './bin/render.mjs';
import { exportStore, exportWriting } from './bin/export.mjs';
import { buildDeck } from './bin/zoomdown.mjs';

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
    name: 'zoomdown-drop-unused-engine-chunks',
    enforce: 'pre',
    resolveId(id, importer) {
      if (UNUSED_ENGINE_CHUNKS.test(id) && importer && /manim-web/.test(importer)) return stub;
      return null;
    },
  };
}

/** Reload the page when a deck file that is not a module changes (Markdown, shared YAML settings, assets). */
function deckReload(): Plugin {
  const dir = resolve(__dirname, 'examples');
  return {
    name: 'zoomdown-deck-reload',
    configureServer(server) {
      server.watcher.add(dir);
      const onChange = (file: string) => {
        // An export written by the player (into build/, or a folder of the presenter's that may lie in a deck's) is no reason to reload.
        if (!file.startsWith(dir + sep) || /\.(ts|js|mjs|tsx)$/.test(file) || isRecordingFile(file) || /[\\/](build|dist)[\\/]/.test(file) || exportWriting()) return;
        server.ws.send({ type: 'full-reload' });
      };
      for (const event of ['change', 'add', 'unlink'] as const) server.watcher.on(event, onChange);
    },
  };
}

export default defineConfig({
  root: resolve(__dirname),
  plugins: [
    dropEngineMuxers(resolve(__dirname, 'src/stubs/empty.ts')), deckReload(), padRelay(),
    // Editor jumps for the example decks; ZOOMDOWN_EDITOR names the editor the player opens.
    editorSync({ editor: process.env.ZOOMDOWN_EDITOR ?? null, roots: [resolve(__dirname, 'examples')] }),
    recordingStore({ roots: [resolve(__dirname, 'examples')] }),
    renderStore({ roots: [resolve(__dirname, 'examples')] }),
    exportStore({ roots: [resolve(__dirname, 'examples')], build: buildDeck }),
  ],
  // A deck's own modules import the package by name, as they do under the command and the app.
  resolve: { alias: { ...optionalStubs, zoomdown: resolve(__dirname, 'src/index.ts') } },
  optimizeDeps: { entries: ['index.html'] },
  // With --host, a tablet reaches the server by the computer's name (Name.local) as well as by its address.
  server: { fs: { allow: [resolve(__dirname), resolve(__dirname, '..')] }, allowedHosts: allowedHosts() },
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
