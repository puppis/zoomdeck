/**
 * Default typefaces. Prose uses Latin Modern Roman and code Latin Modern
 * Mono, the OpenType versions of the Computer Modern family that LaTeX uses,
 * so text, code and formulas share one design by default; `layout.font` and
 * `layout.codeFont` replace them. The faces are bundled (GUST
 * Font License, see fonts/GUST-FONT-LICENSE.txt) and registered through the
 * FontFace API before any text is measured.
 */
import regular from './fonts/lmroman10-regular.otf?url';
import bold from './fonts/lmroman10-bold.otf?url';
import italic from './fonts/lmroman10-italic.otf?url';
import boldItalic from './fonts/lmroman10-bolditalic.otf?url';
import monoRegular from './fonts/lmmono10-regular.otf?url';
import monoItalic from './fonts/lmmono10-italic.otf?url';
import monoBold from './fonts/lmmonolt10-bold.otf?url';

/** CSS family name of the bundled text face. */
export const DEFAULT_TEXT_FONT = 'Latin Modern Roman';
/** CSS family name of the bundled monospace face, designed to pair with the text face at the same size. */
export const DEFAULT_CODE_FONT = 'Latin Modern Mono';

const FACES: Array<{ family: string; url: string; weight: string; style: string }> = [
  { family: DEFAULT_TEXT_FONT, url: regular, weight: '400', style: 'normal' },
  { family: DEFAULT_TEXT_FONT, url: bold, weight: '700', style: 'normal' },
  { family: DEFAULT_TEXT_FONT, url: italic, weight: '400', style: 'italic' },
  { family: DEFAULT_TEXT_FONT, url: boldItalic, weight: '700', style: 'italic' },
  { family: DEFAULT_CODE_FONT, url: monoRegular, weight: '400', style: 'normal' },
  { family: DEFAULT_CODE_FONT, url: monoItalic, weight: '400', style: 'italic' },
  { family: DEFAULT_CODE_FONT, url: monoBold, weight: '700', style: 'normal' },
];

let pending: Promise<void> | null = null;

/** Register and load the bundled faces once; resolves even when a face fails to load. */
export function loadDefaultFonts(): Promise<void> {
  if (pending) return pending;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return (pending = Promise.resolve());
  pending = Promise.all(
    FACES.map(async ({ family, url, weight, style }) => {
      try {
        const face = new FontFace(family, `url(${JSON.stringify(url)})`, { weight, style });
        await face.load();
        document.fonts.add(face);
      } catch (error) {
        console.warn(`[zoomdeck] could not load ${family} (${style} ${weight}):`, error);
      }
    }),
  ).then(() => undefined);
  return pending;
}
