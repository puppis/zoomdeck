import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MarkupParser } from '../src/markup/parser';
import { SlideBuilder } from '../src/markup/slide';

const site = join(__dirname, '..', 'docs', 'site');

/** The decks written in the documentation: the %%deck cells of the notebooks and the ```zoomdeck fences of the pages. */
function decks(): Array<{ where: string; source: string }> {
  const found: Array<{ where: string; source: string }> = [];
  for (const file of readdirSync(site)) {
    if (file.endsWith('.ipynb')) {
      const notebook = JSON.parse(readFileSync(join(site, file), 'utf8')) as { cells: Array<{ cell_type: string; source: string | string[] }> };
      notebook.cells.forEach((cell, index) => {
        const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
        const magic = /^%%deck[^\n]*\n([\s\S]*)$/.exec(source);
        if (cell.cell_type === 'code' && magic) found.push({ where: `${file} cell ${index + 1}`, source: magic[1] });
      });
    } else if (file.endsWith('.md')) {
      const text = readFileSync(join(site, file), 'utf8');
      for (const match of text.matchAll(/```zoomdeck([^\n]*)\n([\s\S]*?)```/g)) {
        if (!/\bsrc=/.test(match[1])) found.push({ where: `${file} fence at ${text.slice(0, match.index).split('\n').length}`, source: match[2] });
      }
    }
  }
  return found;
}

describe('the decks of the documentation', () => {
  const all = decks();
  it('exist', () => {
    expect(all.length).toBeGreaterThan(20);
  });
  for (const { where, source } of all) {
    it(`${where} parses and builds`, () => {
      const document = new MarkupParser().parse(source);
      const root = new SlideBuilder().build(document);
      expect(root).toBeTruthy();
    });
  }
});
