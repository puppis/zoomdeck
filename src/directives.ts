/**
 * Directives of a deck's own: `[[name: #id …]]` with a name the dialect does not know draws
 * with the module `directives/name.ts` next to the Markdown. The module exports a function
 * (default, or `directive`) that receives the directive's attributes, the deck's typography and
 * colors, and helpers that make text, icons and artworks in the deck's style, and returns a
 * mobject or several; the result is placed and animated like any element.
 */
import { Group, type Mobject } from 'manim-web';
import type { IconOptions } from './icons';
import type { LayoutConfig, sketchOptions } from './markup/renderer';

export interface DirectiveOptions {
  /** The directive's name, so one module can serve several names. */
  name: string;
  /** Every attribute of the directive, as written (`x`, `y`, positions included; `id` and `class` too). */
  attributes: Record<string, string>;
  /** `color=`, else the deck's text color. */
  color: string;
  /** `font_size=`, else the layout's body size. */
  fontSize: number;
  /** `width=`, else the width available where the directive sits. */
  width: number;
  /** The deck's text color. */
  foreground: string;
  layout: LayoutConfig;
  /** The hand-drawn options of the directive (`sketch=true` and its tuning), null when it is drawn clean. */
  sketch: ReturnType<typeof sketchOptions>;
  /** Lay out inline markup (emphasis, code, formulas) in the deck's font, in `color`. */
  text: (markup: string, fontSize?: number, maxWidth?: number) => Promise<Mobject>;
  /** A built-in icon in the deck's style. */
  icon: (name: string, options?: IconOptions) => Mobject;
  /** An artwork of the deck's own, with the attributes it reads. */
  artwork: (name: string, attributes?: Record<string, string>) => Promise<Mobject>;
}

export type DirectiveFactory = (options: DirectiveOptions) => Mobject | Mobject[] | Promise<Mobject | Mobject[]>;

/** A module in a directives folder: `export default` the function, or a named `directive`. */
export interface DirectiveModule {
  default?: DirectiveFactory;
  directive?: DirectiveFactory;
}

/** What a directive module draws for `options`: one mobject, or a group of the several it returns. */
export async function directiveFromModule(module: DirectiveModule, options: DirectiveOptions): Promise<Mobject> {
  const factory = module.directive ?? (typeof module.default === 'function' ? module.default : null);
  if (!factory) throw new Error(`A directive module exports a function (default or \`directive\`) that draws [[${options.name}: …]]`);
  const result = await factory(options);
  if (!Array.isArray(result)) return result;
  if (!result.length) throw new Error(`[[${options.name}: …]] drew nothing`);
  return result.length === 1 ? result[0] : new Group(...result);
}
