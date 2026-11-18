import { describe, expect, it } from 'vitest';
import { MarkupParser } from '../src/markup/parser';
import { ElementSpec } from '../src/markup/ast';
import { sanitizePads } from '../src/player/settings';
import { stripNotes } from '../bin/zoomdown.mjs';

const DECK = [
  '::: slide {#a width=20}',
  '## Title',
  '',
  '::: notes',
  'Thank the **team** first.',
  ':::',
  '',
  '[Shown at one]{#one x=0 y=0 step=1}',
  '',
  '::: notes {step=1}',
  'Say *twelve*.',
  ':::',
  '',
  '```markdown',
  '::: notes',
  'not notes: inside a fence',
  ':::',
  '```',
  '[Last]{#last x=0 y=-2}',
  ':::',
].join('\n');

describe('presenter notes', () => {
  it('are taken out of a slide, for the slide and for its steps, without moving the other lines', () => {
    const [slide] = new MarkupParser().parse(DECK).slides;
    expect(slide.notes.map((block) => [block.step, block.markdown, block.line])).toEqual([[null, 'Thank the **team** first.', 4], [1, 'Say *twelve*.', 10]]);
    expect(slide.notesFor(null)).toBe('Thank the **team** first.');
    expect(slide.notesFor(1)).toBe('Thank the **team** first.\n\nSay *twelve*.');
    expect(slide.notesFor(2)).toBe('Thank the **team** first.');
    const last = slide.items.find((item): item is ElementSpec => item instanceof ElementSpec && item.id === 'last');
    expect(last?.line).toBe(19);
    // The fenced listing keeps its text.
    const code = slide.items.find((item): item is ElementSpec => item instanceof ElementSpec && item.kind === 'code');
    expect(code?.source).toContain('not notes');
    expect(slide.items.some((item) => item instanceof ElementSpec && item.spans.some((span) => span.content.includes('Thank')))).toBe(false);
  });

  it('take step=N and nothing else', () => {
    expect(() => new MarkupParser().parse('::: slide {#a}\n::: notes {color=RED}\nx\n:::\nx\n:::')).toThrow(/step=N and nothing else/);
    expect(() => new MarkupParser().parse('::: slide {#a}\n::: notes {step=no}\nx\n:::\nx\n:::')).toThrow(/step/);
  });

  it('are left out of an export made without them, fenced code untouched', () => {
    const stripped = stripNotes(DECK);
    expect(stripped).not.toContain('Thank the');
    expect(stripped).not.toContain('Say *twelve*');
    expect(stripped).toContain('not notes: inside a fence');
    expect(stripped.split('\n').length).toBe(DECK.split('\n').length);
    expect(new MarkupParser().parse(stripped).slides[0].notes).toEqual([]);
  });

  it('go to the tablet unless the presenter turns them off', () => {
    expect(sanitizePads(undefined).notes).toBe(true);
    expect(sanitizePads({ trusted: [], notes: false }).notes).toBe(false);
    expect(sanitizePads({ trusted: [] }).notes).toBe(true);
  });
});
