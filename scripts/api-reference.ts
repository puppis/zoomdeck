/**
 * The API manual, generated from the sources: every export of `src/index.ts`, with its
 * signature and documentation comment, grouped by the module it comes from. Run by the
 * documentation build, so the page never lags behind the code.
 */
import ts from 'typescript';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The modules in reading order, with the title and the sentence of each section. */
const SECTIONS: Array<{ title: string; blurb: string; modules: string[] }> = [
  { title: 'Decks', blurb: 'What a deck is to the player: a definition with a factory of slides, made from Markdown, from a PDF or from code.', modules: ['src/deck.ts', 'src/markup/deck.ts', 'src/pdfdeck.ts'] },
  { title: 'Running a deck', blurb: 'The player in a page: mounting a deck into an element, running one as the page, the custom element and its events.', modules: ['src/player/boot.ts', 'src/element.ts'] },
  { title: 'Slides and the runtime', blurb: 'The slide tree, the context a slide builds and plays in, the presenter that drives the camera, and the recorded clips.', modules: ['src/slides.ts', 'src/runtime.ts', 'src/display.ts'] },
  { title: 'The dialect', blurb: 'Parsing Markdown into a document, validating it, building slides from it and laying out their elements.', modules: ['src/markup/ast.ts', 'src/markup/parser.ts', 'src/markup/imports.ts', 'src/markup/slide.ts', 'src/markup/renderer.ts', 'src/markup/text.ts', 'src/markup/code.ts', 'src/markup/tokens.ts', 'src/markup/table.ts', 'src/markup/iframe.ts'] },
  { title: 'Drawing', blurb: 'Icons and artworks, charts, enclosures, paths, hand-drawn rendering, SVG import, effects and the module contracts of a deck\'s own extensions.', modules: ['src/icons.ts', 'src/charts.ts', 'src/blob.ts', 'src/paths.ts', 'src/sketch.ts', 'src/svg.ts', 'src/animations.ts', 'src/directives.ts'] },
  { title: 'Media', blurb: 'Raster images and movies, video clips, and the fonts the player bundles.', modules: ['src/raster.ts', 'src/video.ts', 'src/fonts.ts'] },
  { title: 'The player', blurb: 'Navigation over clips, the stage, the interface, the layers for links and live pages, and the feature flags.', modules: ['src/player/player.ts', 'src/player/stage.ts', 'src/player/ui.ts', 'src/player/links.ts', 'src/player/iframes.ts', 'src/player/settings.ts'] },
  { title: 'Geometry and helpers', blurb: 'Transforms, points, bookmarks of positions, the design grid, and the engine itself.', modules: ['src/geometry.ts', 'src/position.ts', 'src/guides.ts'] },
];

export interface ApiEntry {
  name: string;
  kind: string;
  module: string;
  signature: string;
  doc: string;
  members: Array<{ name: string; signature: string; doc: string }>;
}

function docOf(symbol: ts.Symbol, checker: ts.TypeChecker): string {
  return ts.displayPartsToString(symbol.getDocumentationComment(checker)).replace(/\s+/g, ' ').trim();
}

/** The declaration's text without its body or initializer, on one line of reasonable length. */
function declarationText(node: ts.Node, source: ts.SourceFile): string {
  let text = node.getText(source);
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node)) {
    const body = (node as ts.FunctionLikeDeclaration).body;
    if (body) text = source.text.slice(node.getStart(source), body.getStart(source)).trim();
  } else if (ts.isVariableDeclaration(node)) {
    text = node.initializer ? source.text.slice(node.getStart(source), node.initializer.getStart(source)).replace(/=\s*$/, '').trim() : text;
  } else if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
    text = source.text.slice(node.getStart(source), node.members.pos).replace(/\{\s*$/, '').trim();
  } else if (ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
    text = text.length > 400 ? `${text.slice(0, 400)} …` : text;
  }
  // Strip modifiers and JSDoc that came with the text.
  text = text.replace(/\/\*\*[\s\S]*?\*\/\s*/g, '').replace(/^(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?/, '');
  return text.replace(/\s+/g, ' ').trim();
}

function kindOf(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isVariableDeclaration(node)) return 'const';
  if (ts.isNamespaceExport(node) || ts.isModuleDeclaration(node)) return 'namespace';
  return 'value';
}

function isPublicMember(member: ts.ClassElement | ts.TypeElement): boolean {
  const name = member.name?.getText() ?? '';
  if (!name || name.startsWith('_') || name.startsWith('#')) return false;
  const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) ?? [] : [];
  return !modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword);
}

/** Every export of the package entry, resolved to its declaration. */
export function apiEntries(entry = join(root, 'src', 'index.ts')): ApiEntry[] {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error('tsconfig.json not found');
  const config = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, dirname(configPath));
  const program = ts.createProgram([entry], { ...config.options, noEmit: true, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  if (!source) throw new Error(`${entry} is not in the program`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error('No module symbol for the entry');
  const entries: ApiEntry[] = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const name = exported.getName();
    if (name === 'engine') {
      entries.push({ name, kind: 'namespace', module: 'manim-web', signature: "import { engine } from 'zoomdown'", doc: 'The whole animation engine, re-exported: every mobject, animation, color and rate function a slide class or a module of the deck may need, under one name, so that a deck shares the player\'s copy of it.', members: [] });
      continue;
    }
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const declarations = symbol.getDeclarations() ?? [];
    const declaration = declarations.find((node) => !ts.isExportSpecifier(node)) ?? declarations[0];
    if (!declaration) continue;
    const file = declaration.getSourceFile();
    const module = relative(root, file.fileName).split('\\').join('/');
    const members: ApiEntry['members'] = [];
    if (ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) {
      for (const member of declaration.members) {
        if (!isPublicMember(member)) continue;
        const memberSymbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
        members.push({
          name: member.name?.getText(file) ?? 'constructor',
          signature: declarationText(member, file),
          doc: memberSymbol ? docOf(memberSymbol, checker) : '',
        });
      }
      const constructor = ts.isClassDeclaration(declaration) ? declaration.members.find(ts.isConstructorDeclaration) : undefined;
      if (constructor) members.unshift({ name: 'constructor', signature: declarationText(constructor, file), doc: '' });
    }
    // A function with overloads: every signature.
    const signature = declarations
      .filter((node) => !ts.isExportSpecifier(node))
      .map((node) => declarationText(node, file))
      .filter((text, index, all) => text && all.indexOf(text) === index)
      .join('\n');
    entries.push({ name, kind: kindOf(declaration), module, signature, doc: docOf(symbol, checker), members });
  }
  return entries;
}

function escapeCode(text: string): string {
  return text.replace(/`/g, '\\`');
}

/** The manual as Markdown: a section per module group, an entry per export, members as a table. */
export function apiMarkdown(entries = apiEntries()): string {
  const byModule = new Map<string, ApiEntry[]>();
  for (const entry of entries) {
    if (!byModule.has(entry.module)) byModule.set(entry.module, []);
    (byModule.get(entry.module) as ApiEntry[]).push(entry);
  }
  const listed = new Set(SECTIONS.flatMap((section) => section.modules));
  const sections = [...SECTIONS];
  const rest = [...byModule.keys()].filter((module) => !listed.has(module) && module !== 'manim-web');
  if (rest.length) sections.push({ title: 'Other exports', blurb: '', modules: rest });
  const parts: string[] = [];
  for (const section of sections) {
    const modules = section.modules.filter((module) => byModule.has(module));
    if (!modules.length) continue;
    parts.push(`## ${section.title}\n`);
    if (section.blurb) parts.push(`${section.blurb}\n`);
    for (const module of modules) {
      const items = (byModule.get(module) as ApiEntry[]).sort((a, b) => a.name.localeCompare(b.name));
      parts.push(`<p class="api-module">from <code>${module}</code></p>\n`);
      for (const item of items) {
        parts.push(`### ${item.name}\n`);
        parts.push(`<p class="api-kind">${item.kind}</p>\n`);
        if (item.doc) parts.push(`${item.doc}\n`);
        parts.push('```typescript\n' + item.signature + '\n```\n');
        if (item.members.length) {
          parts.push('| Member | Signature | Meaning |\n| --- | --- | --- |');
          for (const member of item.members) {
            parts.push(`| \`${escapeCode(member.name)}\` | \`${escapeCode(member.signature).replace(/\|/g, '\\|')}\` | ${member.doc.replace(/\|/g, '\\|')} |`);
          }
          parts.push('');
        }
      }
    }
  }
  const engine = entries.find((entry) => entry.name === 'engine');
  if (engine) {
    parts.push('## The engine\n');
    parts.push(`### engine\n\n<p class="api-kind">namespace</p>\n\n${engine.doc}\n\n\`\`\`typescript\n${engine.signature}\n\`\`\`\n`);
  }
  return parts.join('\n');
}
