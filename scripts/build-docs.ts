/**
 * Build the documentation site: every `docs/site/*.md` page and `docs/site/*.ipynb` notebook
 * becomes `docs/html/<name>.html` with a shared layout, navigation, previous/next links and
 * code listings highlighted by the same tokenizer the slides use. A ```zoomdeck fence in a
 * page is a live deck, played in the page by the self-contained player (`npm run
 * build:standalone`, copied to docs/html/zoomdeck/), next to its markup; a notebook's cells
 * keep the decks their outputs hold, and open live in JupyterLite (`npm run docs:lite`).
 *
 *   npm run docs
 */
import MarkdownIt from 'markdown-it';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { languageFor, tokenizeCode } from '../src/markup/tokens';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const sourceDir = join(root, 'docs', 'site');
const outDir = join(root, 'docs', 'html');
const standaloneDir = join(root, 'dist', 'standalone');

/**
 * Navigation: sections and their pages in reading order, from the overview of what Zoomdeck
 * does to the reference. The sidebar, the pager and the map on the index page all follow it; a
 * page's `##` headings are its subsections.
 */
const NAV: Array<{ title: string; blurb: string; pages: string[] }> = [
  { title: 'Features overview', blurb: 'What Zoomdeck does, shown live: a PDF, plain slides, a tree of slides, the spotlight and the pen, the camera and recording, formulas, diagrams and animations.', pages: ['index', 'features'] },
  { title: 'Getting started', blurb: 'Install, open and export a deck, set up your editor, the desktop app, and what a slide, a viewport and a stop are.', pages: ['getting-started', 'editors', 'desktop', 'concepts'] },
  { title: 'Presenting', blurb: 'The player and its tools: keys, spotlight and laser, the pen and the whiteboard, the camera, recording a talk, printing the deck, exporting it to a folder or a single file.', pages: ['player', 'exporting'] },
  { title: 'Writing slides', blurb: 'A first deck built stage by stage in a notebook, a PDF shown as it is and a file of plain slides, the forest of slides, then the content of a slide: prose, formulas, images, listings, tables and charts.', pages: ['first-deck', 'documents', 'slides', 'text', 'math', 'images', 'code', 'tables-charts'] },
  { title: 'Diagrams', blurb: 'Shapes, arrows, icons and enclosures, crisp or hand-drawn.', pages: ['shapes', 'icons', 'enclosures', 'sketch'] },
  { title: 'Layout and style', blurb: 'Where things go and how they look: flow, anchors, constraints, groups, style sheets, and the deck.json configuration of a deck.', pages: ['positioning', 'groups', 'styles', 'configuration'] },
  { title: 'Motion and interaction', blurb: 'What happens on each click: fragments, animations, focus-only decorations and live web pages.', pages: ['fragments', 'animations', 'focus', 'live-pages'] },
  { title: 'Advanced', blurb: 'Slides written in TypeScript, a deck inside a page of your own, and the complete reference of the dialect.', pages: ['code-slides', 'embedding', 'reference'] },
];

/** Features a deck in the documentation has no use for unless a fence asks for them. */
const DOCS_WITHOUT = 'camera record screen';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlight(code: string, language: string): string {
  const lines = tokenizeCode(code.replace(/\n$/, ''), language);
  return lines
    .map((tokens) => tokens.map((token) => {
      const text = escapeHtml(token.text);
      if (token.cls === 'plain' && !token.bold) return text;
      const classes = [token.cls !== 'plain' ? `tk-${token.cls}` : '', token.bold ? 'tk-bold' : ''].filter(Boolean).join(' ');
      return `<span class="${classes}">${text}</span>`;
    }).join(''))
    .join('\n');
}

interface Page {
  name: string;
  title: string;
  description: string;
  html: string;
  headings: Array<{ id: string; text: string }>;
  /** The tour chapter the page's first "Open in the tour" badge points at, if any. */
  tour: string | null;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** The attributes of a ```zoomdeck fence: `key=value`, `key="a value"` or a bare flag. */
function fenceAttributes(info: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-z-]+)(?:=(?:"([^"]*)"|(\S+)))?/g;
  for (const match of info.matchAll(pattern)) attributes[match[1]] = match[2] ?? match[3] ?? 'true';
  return attributes;
}

/**
 * A live deck for a ```zoomdeck fence: the player in the page, its markup beside it. The fence
 * takes `src=path` (a PDF, a Markdown file or a deck.json instead of the fence's own text),
 * `without="…"` (features to leave out; the camera, the recorder and the screen unless said
 * otherwise, `without=none` keeps them all), `height=…`, `start=…`, `title=…`, `code=hidden`
 * and `caption="…"`.
 */
function liveDeck(info: string, source: string): string {
  const attrs = fenceAttributes(info.replace(/^zoomdeck\s*/, ''));
  const without = attrs.without === 'none' ? '' : attrs.without ?? DOCS_WITHOUT;
  const element: string[] = [];
  if (attrs.src) element.push(`src="${escapeHtml(attrs.src)}"`);
  if (without) element.push(`without="${escapeHtml(without)}"`);
  if (attrs.start) element.push(`start="${escapeHtml(attrs.start)}"`);
  if (attrs.title) element.push(`title="${escapeHtml(attrs.title)}"`);
  if (attrs.outline) element.push('outline');
  if (attrs.height) element.push(`style="height: ${escapeHtml(attrs.height)}; aspect-ratio: auto"`);
  const markup = source.replace(/\n$/, '');
  const inline = attrs.src ? '' : `<script type="text/markdown">\n${markup.replace(/<\/script/gi, '<\\/script')}\n</script>`;
  const showCode = !attrs.src && attrs.code !== 'hidden';
  const code = showCode ? `<pre class="markup"><code>${highlight(markup, 'markdown')}</code></pre>` : '';
  const caption = attrs.caption ? `<figcaption>${escapeHtml(attrs.caption)}</figcaption>` : '';
  return `<figure class="live${showCode ? '' : ' no-code'}">\n<zoom-deck ${element.join(' ')}>${inline}</zoom-deck>\n${code}${caption}\n</figure>\n`;
}

/** A Markdown renderer with heading anchors (collected into `headings`), admonitions and live decks. */
function makeMarkdown(headings: Page['headings']): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false, highlight: (code, lang) => highlight(code, languageFor(lang)) });
  md.renderer.rules.heading_open = (tokens, index) => {
    const token = tokens[index];
    const inline = tokens[index + 1];
    const text = inline.children?.map((child) => child.content).join('') ?? '';
    const id = slug(text);
    if (token.tag === 'h2') headings.push({ id, text });
    return `<${token.tag} id="${id}">`;
  };
  md.renderer.rules.heading_close = (tokens, index) => {
    const token = tokens[index];
    const inline = tokens[index - 1];
    const text = inline.children?.map((child) => child.content).join('') ?? '';
    return token.tag === 'h2' || token.tag === 'h3' ? `<a class="anchor" href="#${slug(text)}" aria-label="Link to this section">#</a></${token.tag}>` : `</${token.tag}>`;
  };
  // Admonitions: a blockquote starting with **Note**, **Tip** or **Warning**.
  const defaultBlockquote = md.renderer.rules.blockquote_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.blockquote_open = (tokens, index, options, env, self) => {
    const inline = tokens[index + 2];
    const first = inline?.children?.[1];
    const label = inline?.children?.[0]?.type === 'strong_open' && first ? first.content : '';
    if (['Note', 'Tip', 'Warning'].includes(label)) return `<blockquote class="admonition ${label.toLowerCase()}">`;
    return defaultBlockquote(tokens, index, options, env, self);
  };
  // ```zoomdeck fences become live decks.
  md.core.ruler.push('zoomdeck', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'fence' || !/^zoomdeck(\s|$)/.test(token.info.trim())) continue;
      token.type = 'html_block';
      token.content = liveDeck(token.info.trim(), token.content);
    }
  });
  return md;
}

function parsePage(name: string, source: string): Page {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const meta: Record<string, string> = {};
  if (front) {
    for (const line of front[1].split('\n')) {
      const index = line.indexOf(':');
      if (index > 0) meta[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    source = source.slice(front[0].length);
  }
  const headings: Page['headings'] = [];
  const html = makeMarkdown(headings).render(source);
  const tour = /class="try" href="(tour\.html#slide=[^"]+)"/.exec(source)?.[1] ?? null;
  return { name, title: meta.title ?? name, description: meta.description ?? '', html, headings, tour };
}

interface NotebookCell {
  cell_type: 'markdown' | 'code' | 'raw';
  source: string | string[];
  outputs?: Array<{
    output_type: 'stream' | 'display_data' | 'execute_result' | 'error';
    text?: string | string[];
    data?: Record<string, string | string[]>;
    ename?: string;
    evalue?: string;
  }>;
}

interface Notebook {
  cells: NotebookCell[];
  metadata?: { zoomdeck?: { title?: string; description?: string } };
}

const text = (value: string | string[] | undefined): string => (Array.isArray(value) ? value.join('') : value ?? '');

/**
 * A notebook as a page: Markdown cells as prose, code cells as listings followed by their
 * outputs (HTML outputs verbatim, so the decks they hold play in the page), and a badge that
 * opens the notebook live in JupyterLite. The title comes from the notebook's `zoomdeck`
 * metadata or from a leading `#` heading, which the layout prints itself.
 */
function parseNotebook(name: string, json: string): Page {
  const notebook = JSON.parse(json) as Notebook;
  const meta = notebook.metadata?.zoomdeck ?? {};
  const headings: Page['headings'] = [];
  const md = makeMarkdown(headings);
  let title = meta.title;
  const parts: string[] = [`<a class="try" href="lite/lab/index.html?path=${name}.ipynb">Open in JupyterLite ↗</a>`];
  notebook.cells.forEach((cell, index) => {
    let source = text(cell.source);
    if (cell.cell_type === 'markdown') {
      if (index === 0) {
        const heading = /^#\s+(.+)\n?/.exec(source);
        if (heading) {
          title ??= heading[1].trim();
          source = source.slice(heading[0].length);
        }
      }
      parts.push(md.render(source));
      return;
    }
    if (cell.cell_type !== 'code') return;
    const outputs = (cell.outputs ?? []).map((output) => {
      if (output.output_type === 'stream') return `<pre class="cell-stream">${escapeHtml(text(output.text))}</pre>`;
      if (output.output_type === 'error') return `<pre class="cell-error">${escapeHtml(`${output.ename ?? 'Error'}: ${output.evalue ?? ''}`)}</pre>`;
      const data = output.data ?? {};
      if (data['text/html']) return `<div class="cell-output">${text(data['text/html'])}</div>`;
      if (data['image/png']) return `<div class="cell-output"><img alt="" src="data:image/png;base64,${text(data['image/png']).replace(/\n/g, '')}"></div>`;
      if (data['text/plain']) return `<pre class="cell-output">${escapeHtml(text(data['text/plain']))}</pre>`;
      return '';
    }).join('');
    // A %%deck cell is the Markdown of a deck: shown as such, with the magic line kept as is.
    const magic = /^(%%deck[^\n]*\n)([\s\S]*)$/.exec(source);
    const input = magic
      ? `<span class="cell-magic">${escapeHtml(magic[1])}</span>${highlight(magic[2], 'markdown')}`
      : highlight(source, source.startsWith('%') ? 'bash' : 'python');
    parts.push(`<div class="cell"><pre class="cell-input"><code>${input}</code></pre>${outputs}</div>`);
  });
  return { name, title: title ?? name, description: meta.description ?? '', html: parts.join('\n'), headings, tour: null };
}

/** The documentation map for the index page: every section with its pages and their tour chapters. */
function navMap(pages: Map<string, Page>): string {
  return NAV.map((section) => {
    const items = section.pages.filter((name) => name !== 'index').map((name) => {
      const target = pages.get(name) as Page;
      const tour = target.tour ? ` <a class="tour-link" href="${target.tour}" title="This topic in the tour deck">tour ↗</a>` : '';
      return `<li><a href="${name}.html">${escapeHtml(target.title)}</a>${tour}<span>${escapeHtml(target.description)}</span></li>`;
    }).join('');
    return `<section class="map-section"><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.blurb)}</p><ul>${items}</ul></section>`;
  }).join('\n');
}

function layout(page: Page, pages: Map<string, Page>, order: string[]): string {
  const position = order.indexOf(page.name);
  const previous = position > 0 ? pages.get(order[position - 1]) : null;
  const next = position < order.length - 1 ? pages.get(order[position + 1]) : null;
  const nav = NAV.map((section) => `
      <section>
        <h4>${escapeHtml(section.title)}</h4>
        <ul>${section.pages.map((name) => {
          const target = pages.get(name);
          if (!target) return '';
          const current = name === page.name;
          // The current page unfolds its subsections in place.
          const subsections = current && target.headings.length
            ? `<ul class="subsections">${target.headings.map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('')}</ul>`
            : '';
          return `<li><a href="${name}.html"${current ? ' aria-current="page"' : ''}>${escapeHtml(target.title)}</a>${subsections}</li>`;
        }).join('')}</ul>
      </section>`).join('');
  const body = page.html.replace('<!-- nav-map -->', navMap(pages));
  const outline = page.headings.length
    ? `<nav class="outline" aria-label="On this page"><h4>On this page</h4><ul>${page.headings.map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('')}</ul></nav>`
    : '';
  // Pages with live decks load the self-contained player; the chunks it needs follow on demand.
  const player = body.includes('<zoom-deck') ? '\n<script type="module" src="zoomdeck/zoomdeck.js"></script>' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.name === 'index' ? 'Zoomdeck' : `${escapeHtml(page.title)} · Zoomdeck`}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<link rel="stylesheet" href="docs.css">${player}
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="top">
  <button class="menu" aria-label="Toggle navigation" onclick="document.body.classList.toggle('nav-open')">☰</button>
  <a class="brand" href="index.html">Zoomdeck</a>
  <span class="tagline">zooming presentations in the browser</span>
</header>
<div class="shell">
  <nav class="sidebar" aria-label="Documentation">${nav}
  </nav>
  <main id="content">
    <article>
      <h1>${escapeHtml(page.title)}</h1>
      ${page.description ? `<p class="lead">${escapeHtml(page.description)}</p>` : ''}
      ${body}
    </article>
    <footer class="pager">
      ${previous ? `<a class="prev" href="${previous.name}.html">← ${escapeHtml(previous.title)}</a>` : '<span></span>'}
      ${next ? `<a class="next" href="${next.name}.html">${escapeHtml(next.title)} →</a>` : '<span></span>'}
    </footer>
  </main>
  ${outline}
</div>
</body>
</html>
`;
}

async function copyDir(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) await copyDir(source, target);
    else await fs.copyFile(source, target);
  }
}

async function exists(path: string): Promise<boolean> {
  return fs.stat(path).then(() => true, () => false);
}

async function main(): Promise<void> {
  const files = await fs.readdir(sourceDir);
  const sources = new Map<string, 'md' | 'ipynb'>();
  for (const file of files) {
    const match = /^(.+)\.(md|ipynb)$/.exec(file);
    if (!match) continue;
    if (sources.has(match[1])) throw new Error(`docs/site/${match[1]} exists both as a page and as a notebook`);
    sources.set(match[1], match[2] as 'md' | 'ipynb');
  }
  const order = NAV.flatMap((section) => section.pages);
  for (const name of sources.keys()) if (!order.includes(name)) throw new Error(`docs/site/${name}.${sources.get(name)} is not listed in NAV`);
  for (const name of order) if (!sources.has(name)) throw new Error(`NAV lists ${name} but docs/site/${name}.md (or .ipynb) is missing`);
  const pages = new Map<string, Page>();
  for (const name of order) {
    const kind = sources.get(name) as 'md' | 'ipynb';
    const source = await fs.readFile(join(sourceDir, `${name}.${kind}`), 'utf8');
    pages.set(name, kind === 'md' ? parsePage(name, source) : parseNotebook(name, source));
  }
  await fs.mkdir(outDir, { recursive: true });
  for (const page of pages.values()) await fs.writeFile(join(outDir, `${page.name}.html`), layout(page, pages, order));
  await fs.copyFile(join(sourceDir, 'docs.css'), join(outDir, 'docs.css'));
  // The files live decks load (a sample PDF, images) and the self-contained player they run in.
  if (await exists(join(sourceDir, 'live'))) await copyDir(join(sourceDir, 'live'), join(outDir, 'live'));
  if (await exists(standaloneDir)) await copyDir(standaloneDir, join(outDir, 'zoomdeck'));
  else console.warn('dist/standalone/ is missing: run `npm run build:standalone` first, or the live decks of the pages will not play');
  console.log(`Built ${pages.size} pages into docs/html/`);
  if (!process.argv.includes('--no-tour')) {
    // The tour deck as one self-contained page, so the documentation can open it anywhere.
    const stage = await fs.mkdtemp(join(tmpdir(), 'zoomdeck-tour-'));
    execFileSync(process.execPath, [join(root, 'bin', 'zoomdeck.mjs'), 'build', join(root, 'examples', 'tour', 'deck.json'), '-o', stage, '--one-file'], { stdio: 'inherit' });
    await fs.copyFile(join(stage, 'offline.html'), join(outDir, 'tour.html'));
    await fs.rm(stage, { recursive: true, force: true });
    console.log('Exported the tour deck to docs/html/tour.html');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
