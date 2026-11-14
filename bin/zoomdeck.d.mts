/** Types of the command's module, for the tests and the desktop app. */
export function parseArgs(argv: string[]): Record<string, unknown>;
export function resolveDeckPath(path: string): string;
export function deckKind(deckPath: string): 'json' | 'markdown' | 'pdf' | 'module' | null;
export function deckFolders(configPath: string): { paths: string[]; artworks: string[]; all: string[] };
export function startPreview(options: Record<string, unknown>): Promise<{ server: unknown; url: string; port: number; deckPath: string; kind: string; watchRoots: string[] }>;
