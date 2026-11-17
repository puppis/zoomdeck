/** Types of `frontmatter.mjs`, the deck settings read from a Markdown file's front matter. */

/** How a setting merges over an extended file's. */
export type SettingKind = 'value' | 'map' | 'path' | 'folders';

/** Every setting a deck's front matter may hold. */
export declare const SETTINGS: Record<string, SettingKind>;
/** The folder settings. */
export declare const FOLDER_SETTINGS: string[];

/** The settings of a deck as its front matter gives them, paths resolved. */
export interface DeckSettings {
  title?: string;
  root?: string;
  background?: string;
  viewport?: { width: number; height: number };
  showOutline?: boolean;
  theme?: string | string[];
  layout?: Record<string, unknown>;
  presenter?: Record<string, unknown>;
  macros?: Record<string, unknown>;
  styles?: Record<string, string | Record<string, unknown>>;
  classes?: string;
  paths?: string[];
  artworks?: string[];
  fonts?: string[];
  effects?: string[];
  charts?: string[];
  languages?: string[];
  codeThemes?: string[];
  themes?: string[];
  slides?: string[];
  directives?: string[];
  snippets?: string[];
  transitions?: string[];
}

/** How front matter reaches the files it names. */
export interface SettingsIO {
  read(location: string): Promise<string>;
  join(location: string, path: string): string;
}

export declare function splitFrontMatter(text: string): { yaml: string | null; body: string; lines: number };
export declare function parseSettings(yaml: string, where: string): DeckSettings & { extends?: string };
export declare function parseViewport(value: unknown, where: string): { width: number; height: number };
export declare function mergeSettings(base: DeckSettings, own: DeckSettings): DeckSettings;
export declare function resolveSettings(
  text: string,
  location: string,
  io: SettingsIO,
  seen?: string[],
): Promise<{ settings: DeckSettings; body: string; extended: string[] }>;
