import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANCHORS, ANIMATE_PROPS, BARE_FLAGS, CHART_ATTRS, EFFECT_NAMES, ELEMENT_ATTRS, ENTER_STYLES, EXIT_STYLES, FILL_STYLE_NAMES, GROUP_ATTRS,
  LABEL_SIDES, POSITION_REFERENCES, RATE_NAMES, SHAPES, SKETCH_ATTRS, TABLE_ATTRS, TABLE_RULE_NAMES, TREMBLE_ATTRS, CHART_TYPE_NAMES, ICON_KINDS,
} from '../src/markup/ast';
import { LayoutConfig } from '../src/markup/renderer';
import { PresenterConfig } from '../src/runtime';

const manual = readFileSync(join(__dirname, '..', 'docs', 'site', 'manual-markup.md'), 'utf8');
/** Every name written in backticks anywhere in the manual. */
const names = new Set([...manual.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]));

function expectAll(set: Iterable<string>, what: string): void {
  const missing = [...set].filter((name) => !names.has(name));
  expect(missing, `${what} missing from the manual`).toEqual([]);
}

describe('the markup manual', () => {
  it('names every attribute the parser accepts', () => {
    expectAll(ELEMENT_ATTRS, 'element attributes');
    expectAll(GROUP_ATTRS, 'group attributes');
    expectAll(CHART_ATTRS, 'chart attributes');
    expectAll(TABLE_ATTRS, 'table attributes');
    expectAll(SKETCH_ATTRS, 'sketch attributes');
    expectAll(TREMBLE_ATTRS, 'tremble attributes');
    expectAll(ANIMATE_PROPS, 'animate properties');
    expectAll(POSITION_REFERENCES, 'position references');
    expectAll(BARE_FLAGS, 'bare flags');
    expectAll(['size', 'label', 'label_side', 'side', 'smoothness', 'corner_radius', 'radius', 'points', 'start_angle', 'angle', 'play', 'muted', 'lang', 'url', 'title', 'poster', 'path', 'rotate', 'to', 'from', 'name', 'scale', 'rate', 'target', 'only_this', 'transition', 'title'], 'other attributes');
  });

  it('names every value the parser recognizes', () => {
    expectAll(SHAPES, 'shapes');
    expectAll(ANCHORS, 'anchors');
    expectAll(['origin'], 'the group anchor');
    expectAll(EFFECT_NAMES, 'effects');
    expectAll(ENTER_STYLES, 'enter styles');
    expectAll(EXIT_STYLES, 'exit styles');
    expectAll(RATE_NAMES, 'rates');
    expectAll(FILL_STYLE_NAMES, 'fill styles');
    expectAll(TABLE_RULE_NAMES, 'table rules');
    expectAll(CHART_TYPE_NAMES, 'chart types');
    expectAll(LABEL_SIDES, 'label sides');
    expectAll(ICON_KINDS, 'icon names');
    expectAll(['zoom', 'cut', 'once', 'loop', 'left', 'center', 'right'], 'other values');
  });

  it('names every directive and container', () => {
    for (const kind of ['include', 'subslide', 'import', 'pdf', 'arrow', 'line', 'icon', 'artwork', 'brace', 'box', 'blob', 'iframe', 'show', 'hide', 'animate', 'effect', 'transform', 'move_along', 'next', 'skip_next', 'snippet']) {
      expect(manual, `[[${kind}]]`).toMatch(new RegExp(`\\[\\[${kind}[:\\]]`));
    }
    for (const container of ['::: slide', '::: styles', '::: snippet', '::: notes', '::: {.element', '::: {.group']) expect(manual).toContain(container);
  });

  it('names every layout and presenter key', () => {
    const layoutKeys = Object.keys(new LayoutConfig({})).filter((key) => !key.startsWith('_') && key !== 'codeFontFamily' && key !== 'fontFamily');
    expectAll(layoutKeys, 'layout keys');
    const presenterKeys = Object.keys(new PresenterConfig({})).filter((key) => key !== 'transitions');
    expectAll(presenterKeys, 'presenter keys');
  });

  it('is organized for the index: one ### entry per construct', () => {
    const entries = [...manual.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
    expect(entries.length).toBeGreaterThan(50);
    expect(new Set(entries).size).toBe(entries.length);
  });
});
