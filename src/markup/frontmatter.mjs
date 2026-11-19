/**
 * A deck's settings, written at the top of its Markdown as YAML front matter.
 *
 * The Markdown is the deck: its title, viewport, layout, presenter settings, macros, styles,
 * themes, slide classes and library folders sit between a first line `---` and the next `---`
 * (or `...`), and every way of opening the deck (the command line, the desktop app, a page that
 * mounts it, a notebook) reads them from there alike. `extends: path` builds on another file's
 * settings: a Markdown file's front matter, or a YAML file; settings shared by several talks live
 * there once. Plain JavaScript, so that the command line (Node) and the player share it.
 */
import { parse as parseYaml } from 'yaml';

/**
 * Every setting, and how it merges over the same setting of a file it extends: `value` replaces
 * it, `map` merges entry by entry (the file's own entries win), `folders` adds the file's own
 * folders before the extended ones', `path` replaces it and is resolved against the file naming it.
 */
export const SETTINGS = {
  title: 'value',
  root: 'value',
  background: 'value',
  viewport: 'value',
  showOutline: 'value',
  theme: 'value',
  layout: 'map',
  presenter: 'map',
  macros: 'map',
  styles: 'map',
  classes: 'path',
  extends: 'path',
  paths: 'folders',
  artworks: 'folders',
  fonts: 'folders',
  effects: 'folders',
  charts: 'folders',
  languages: 'folders',
  codeThemes: 'folders',
  themes: 'folders',
  slides: 'folders',
  directives: 'folders',
  snippets: 'folders',
  transitions: 'folders',
};

/** The keys of the folder settings, in the order the library lists them. */
export const FOLDER_SETTINGS = Object.keys(SETTINGS).filter((key) => SETTINGS[key] === 'folders');

/**
 * Split `text` into its front matter and the Markdown after it. The front matter is the YAML
 * between a first line `---` and the next line `---` or `...`; in the Markdown returned its lines
 * are left blank, so that every line keeps its number. `yaml` is null when there is none.
 */
export function splitFrontMatter(text) {
  const lines = text.split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0] ?? '')) return { yaml: null, body: text, lines: 0 };
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  if (end < 0) throw new Error('The front matter opened with --- on line 1 is never closed by --- or ...');
  const yaml = lines.slice(1, end).join('\n');
  const body = [...lines.slice(0, end + 1).map(() => ''), ...lines.slice(end + 1)].join('\n');
  return { yaml, body, lines: end + 1 };
}

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Parse and check front matter YAML (or a YAML file of settings): a map of known settings of the
 * right kinds. `where` names the file in errors.
 */
export function parseSettings(yaml, where) {
  let data;
  try {
    data = parseYaml(yaml, { prettyErrors: true });
  } catch (error) {
    throw new Error(`${where}: the front matter is not valid YAML (${error.message.split('\n')[0]})`);
  }
  if (data === null || data === undefined) return {};
  if (!isMap(data)) throw new Error(`${where}: the front matter must map settings to values, as title: My talk`);
  const known = Object.keys(SETTINGS);
  for (const [key, value] of Object.entries(data)) {
    const kind = SETTINGS[key];
    if (!kind) {
      throw new Error(`${where}: unknown setting ${JSON.stringify(key)}; the settings are ${known.join(', ')}`);
    }
    if (kind === 'map' && !isMap(value)) throw new Error(`${where}: ${key} maps names to values`);
    if (kind === 'path' && typeof value !== 'string') throw new Error(`${where}: ${key} is a path`);
    if (kind === 'folders' && !(typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string')))) {
      throw new Error(`${where}: ${key} is a folder or a list of folders`);
    }
    if (['title', 'root', 'background'].includes(key) && typeof value !== 'string') throw new Error(`${where}: ${key} is text`);
    if (key === 'showOutline' && typeof value !== 'boolean') throw new Error(`${where}: showOutline is true or false`);
    if (key === 'theme' && !(typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string')))) {
      throw new Error(`${where}: theme is a theme's name or a list of names`);
    }
    if (key === 'viewport') data.viewport = parseViewport(value, where);
  }
  return data;
}

/** A viewport as `16x9` (or `16:9`, `16 9`) or `{ width, height }`: positive proportions. */
export function parseViewport(value, where) {
  let width;
  let height;
  if (typeof value === 'string') [width, height] = value.split(/\s*[x×:\s]\s*/).map(Number);
  else if (isMap(value)) ({ width, height } = value);
  if (!(Number(width) > 0) || !(Number(height) > 0)) throw new Error(`${where}: viewport is written as 16x9, not ${JSON.stringify(value)}`);
  return { width: Number(width), height: Number(height) };
}

/** `own` settings over `base` ones, setting by setting as `SETTINGS` says. */
export function mergeSettings(base, own) {
  const result = { ...base };
  for (const [key, value] of Object.entries(own)) {
    const kind = SETTINGS[key];
    if (kind === 'map') result[key] = { ...(base[key] ?? {}), ...value };
    else if (kind === 'folders') result[key] = [...new Set([...[value].flat(), ...[base[key] ?? []].flat()])];
    else result[key] = value;
  }
  delete result.extends;
  return result;
}

/**
 * The settings of the file at `location` whose text is `text`: its own front matter (a YAML file
 * is all settings) over those of the files it extends, with its paths (`classes`, `extends`, the
 * folders) resolved against it. `io.read(location)` gives a file's text, `io.join(location, path)`
 * resolves a path against a file. Returns the settings, the Markdown with its front matter left
 * blank, and the files extended, nearest first.
 */
export async function resolveSettings(text, location, io, seen = []) {
  if (seen.includes(location)) throw new Error(`${location}: extends itself, through ${seen.join(' → ')}`);
  const yamlFile = /\.ya?ml$/i.test(location);
  const { yaml, body } = yamlFile ? { yaml: text, body: '' } : splitFrontMatter(text);
  const own = yaml === null ? {} : parseSettings(yaml, location);
  for (const [key, kind] of Object.entries(SETTINGS)) {
    if (!(key in own)) continue;
    if (kind === 'path') own[key] = io.join(location, own[key]);
    else if (kind === 'folders') own[key] = [own[key]].flat().map((folder) => io.join(location, folder));
  }
  let base = {};
  const extended = [];
  if (own.extends) {
    const target = own.extends;
    if (!/\.(?:zd|md|markdown|ya?ml)$/i.test(target)) throw new Error(`${location}: extends names a ZoomDown, Markdown or YAML file, not ${target}`);
    let other;
    try {
      other = await io.read(target);
    } catch (error) {
      throw new Error(`${location}: cannot read ${target}, which it extends (${error.message})`);
    }
    const parent = await resolveSettings(other, target, io, [...seen, location]);
    base = parent.settings;
    extended.push(target, ...parent.extended);
  }
  return { settings: mergeSettings(base, own), body, extended };
}
