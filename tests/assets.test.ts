import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { collectAssets, pageReferences } from '../bin/zoomdown.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A course folder with shared animations, and a deck that links them instead of copying them. */
function course(): { deck: string; shared: string } {
  const root = mkdtempSync(join(tmpdir(), 'zoomdown-assets-'));
  roots.push(root);
  const shared = join(root, 'animations');
  mkdirSync(join(shared, 'dist'), { recursive: true });
  mkdirSync(join(shared, 'echo'));
  writeFileSync(join(shared, 'dist', 'renderer.js'), '// the renderer');
  writeFileSync(join(shared, 'echo', 'events.yaml'), '- at: p');
  writeFileSync(join(shared, 'echo', 'style.css'), 'body {}');
  writeFileSync(
    join(shared, 'echo', 'index.html'),
    `<link rel="stylesheet" href="style.css?v=1"><script>
const LIBRARY = ['../../dist/renderer.js?v=1', '../dist/renderer.js?v=1'];
</script><a href="https://example.org/x.js">elsewhere</a><img src="/absolute.png">`,
  );
  const deck = join(root, 'slides', 'deck');
  mkdirSync(deck, { recursive: true });
  writeFileSync(join(deck, 'slides.zd'), '# Deck');
  symlinkSync('../../animations', join(deck, 'animations'));
  // A link back up the tree must not make the walk loop.
  symlinkSync('..', join(shared, 'echo', 'up'));
  symlinkSync('missing', join(deck, 'dangling'));
  return { deck, shared };
}

describe('the files an export takes from a deck folder', () => {
  it('follows links to folders, walks each folder once and leaves dangling links and dist folders behind', async () => {
    const { deck } = course();
    const files = (await collectAssets(deck)).map((file: string) => relative(deck, file)).sort();
    expect(files).toEqual(['animations/echo/events.yaml', 'animations/echo/index.html', 'animations/echo/style.css', 'slides.zd']);
  });

  it('finds the files a page loads, also the paths its scripts try, inside the deck only', async () => {
    const { deck } = course();
    const page = join(deck, 'animations', 'echo', 'index.html');
    const files = (await pageReferences(page, deck)).map((file: string) => relative(deck, file)).sort();
    // ../../dist/renderer.js would be slides/dist: it does not exist, so only the other place counts.
    expect(files).toEqual(['animations/dist/renderer.js', 'animations/echo/style.css']);
    // Seen from a root that does not contain the library, nothing outside it is taken.
    const narrow = (await pageReferences(page, join(deck, 'animations', 'echo'))).map((file: string) => relative(deck, file));
    expect(narrow).toEqual(['animations/echo/style.css']);
  });
});
