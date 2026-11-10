declare module 'gifuct-js' {
  export interface ParsedGif {
    lsd: { width: number; height: number };
    frames: unknown[];
  }
  export interface ParsedFrame {
    dims: { top: number; left: number; width: number; height: number };
    delay: number;
    disposalType: number;
    patch: Uint8ClampedArray;
  }
  export function parseGIF(buffer: ArrayBuffer): ParsedGif;
  export function decompressFrames(gif: ParsedGif, buildPatch: boolean): ParsedFrame[];
}
