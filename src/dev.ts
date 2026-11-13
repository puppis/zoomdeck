/**
 * Development entry: `?deck=examples/tree-deck&scene=Demo` loads a deck module
 * (or `?deck=path/deck.json`, `?deck=path/slides.md`) from this checkout and starts the player. Without `?deck=` it opens the guide.
 */
import { runDeck, loadDeckConfig, markupDeck } from './index';
import type { DeckDefinition } from './deck';

const params = new URLSearchParams(location.search);
const deckPath = params.get('deck') ?? 'examples/guide/deck.json';
const scene = params.get('scene');

async function main(): Promise<void> {
  let definition: DeckDefinition | undefined;
  const base = deckPath.startsWith('/') ? deckPath : `/${deckPath}`;
  if (deckPath.endsWith('.json')) {
    definition = await loadDeckConfig(base, async (url) => (await import(/* @vite-ignore */ url)) as Record<string, unknown>);
  } else if (deckPath.endsWith('.md')) {
    definition = markupDeck({ url: base });
  } else {
    const modulePath = /\.[cm]?[jt]sx?$/.test(base) ? base : `${base}.ts`;
    const module = (await import(/* @vite-ignore */ modulePath)) as Record<string, DeckDefinition>;
    definition = scene ? module[scene] : module.default;
  }
  if (!definition) throw new Error(`Deck module ${deckPath} has no export ${scene ?? 'default'}`);
  const running = await runDeck(definition);
  // A handle for measuring from the console on the development page (draw calls, frame times).
  (window as Window & { zoomdeck?: unknown }).zoomdeck = running;
}

main().catch((error) => {
  console.error(error);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:auto 0 0 0;max-height:40vh;overflow:auto;margin:0;padding:1rem;background:#381e24;color:#fff;white-space:pre-wrap;z-index:99';
  pre.textContent = String(error?.stack ?? error);
  document.body.append(pre);
});
