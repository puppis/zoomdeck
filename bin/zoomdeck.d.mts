/** Types of the command's module, for the tests and the desktop app. */
export function parseArgs(argv: string[]): Record<string, unknown>;
export function stripNotes(text: string): string;
export function resolveDeckPath(path: string): string;
export function deckKind(deckPath: string): 'markdown' | 'pdf' | 'module' | null;
export const LIBRARY_KINDS: ReadonlyArray<{ key: string; folder: string | null; modules: boolean }>;
export function deckFolders(deckPath: string): Promise<{ paths: string[]; artworks: string[]; fonts: string[]; effects: string[]; charts: string[]; languages: string[]; codeThemes: string[]; themes: string[]; slides: string[]; directives: string[]; snippets: string[]; transitions: string[]; all: string[]; extended: string[] }>;
/** The settings of a Markdown deck on disk: its front matter over the files it extends, paths absolute; the Markdown with its front matter blank; the files extended. */
export function deckSettings(deckPath: string): Promise<{ settings: import('../src/markup/frontmatter.mjs').DeckSettings; body: string; extended: string[] }>;
export function startPreview(options: Record<string, unknown>): Promise<{ server: unknown; url: string; port: number; deckPath: string; kind: string; watchRoots: string[] }>;
/** Build a deck into a static folder, or with `oneFile` into one `offline.html`; resolves with the page written. Throws on errors. */
export function buildDeck(options: Record<string, unknown>): Promise<{ target: string }>;
