/**
 * Build the documentation site: every `docs/site/*.md` page becomes
 * `docs/html/<name>.html` with a shared layout, navigation, previous/next
 * links and code listings highlighted by the same tokenizer the slides use.
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

/** Navigation: sections and their pages, in reading order. */
const NAV: Array<{ title: string; pages: string[] }> = [
  { title: 'Start', pages: ['index', 'getting-started', 'concepts'] },
  { title: 'Writing slides', pages: ['slides', 'text', 'math', 'images', 'shapes', 'sketch', 'icons', 'enclosures', 'code', 'positioning', 'styles', 'groups', 'live-pages'] },
  { title: 'Motion', pages: ['fragments', 'animations', 'focus'] },
  { title: 'Beyond markup', pages: ['code-slides', 'player', 'exporting', 'configuration', 'reference'] },
];

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
}

function slug(text: string): string {
  return text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false, highlight: (code, lang) => highlight(code, languageFor(lang)) });
  // Heading anchors and a collected outline.
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
  const html = md.render(source);
  return { name, title: meta.title ?? name, description: meta.description ?? '', html, headings };
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
          const current = name === page.name ? ' aria-current="page"' : '';
          return `<li><a href="${name}.html"${current}>${escapeHtml(target.title)}</a></li>`;
        }).join('')}</ul>
      </section>`).join('');
  const outline = page.headings.length
    ? `<nav class="outline" aria-label="On this page"><h4>On this page</h4><ul>${page.headings.map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('')}</ul></nav>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.name === 'index' ? 'Zoomdeck' : `${escapeHtml(page.title)} · Zoomdeck`}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<link rel="stylesheet" href="docs.css">
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
      ${page.html}
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

async function main(): Promise<void> {
  const names = (await fs.readdir(sourceDir)).filter((file) => file.endsWith('.md')).map((file) => file.replace(/\.md$/, ''));
  const order = NAV.flatMap((section) => section.pages);
  for (const name of names) if (!order.includes(name)) throw new Error(`docs/site/${name}.md is not listed in NAV`);
  for (const name of order) if (!names.includes(name)) throw new Error(`NAV lists ${name} but docs/site/${name}.md is missing`);
  const pages = new Map<string, Page>();
  for (const name of order) pages.set(name, parsePage(name, await fs.readFile(join(sourceDir, `${name}.md`), 'utf8')));
  await fs.mkdir(outDir, { recursive: true });
  for (const page of pages.values()) await fs.writeFile(join(outDir, `${page.name}.html`), layout(page, pages, order));
  await fs.copyFile(join(sourceDir, 'docs.css'), join(outDir, 'docs.css'));
  console.log(`Built ${pages.size} pages into docs/html/`);
  if (!process.argv.includes('--no-guide')) {
    // The guide deck as one self-contained page, so the documentation can open it anywhere.
    const stage = await fs.mkdtemp(join(tmpdir(), 'zoomdeck-guide-'));
    execFileSync(process.execPath, [join(root, 'bin', 'zoomdeck.mjs'), 'build', join(root, 'examples', 'guide', 'deck.json'), '-o', stage, '--one-file'], { stdio: 'inherit' });
    await fs.copyFile(join(stage, 'offline.html'), join(outDir, 'guide.html'));
    await fs.rm(stage, { recursive: true, force: true });
    console.log('Exported the guide deck to docs/html/guide.html');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
