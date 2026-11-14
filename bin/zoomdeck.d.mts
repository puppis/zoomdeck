/** Types of the command's module, for the tests and the desktop app. */
export function parseArgs(argv: string[]): Record<string, unknown>;
export function stripNotes(text: string): string;
export function resolveDeckPath(path: string): string;
export function deckKind(deckPath: string): 'json' | 'markdown' | 'pdf' | 'module' | null;
export const LIBRARY_KINDS: ReadonlyArray<{ key: string; folder: string | null; modules: boolean }>;
export function deckFolders(deckPath: string): { paths: string[]; artworks: string[]; fonts: string[]; effects: string[]; charts: string[]; languages: string[]; codeThemes: string[]; themes: string[]; slides: string[]; directives: string[]; snippets: string[]; transitions: string[]; all: string[] };
export function startPreview(options: Record<string, unknown>): Promise<{ server: unknown; url: string; port: number; deckPath: string; kind: string; watchRoots: string[] }>;
