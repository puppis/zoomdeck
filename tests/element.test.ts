import { describe, expect, it } from 'vitest';
import { featuresWithout, ZoomDeckElement } from '../src/element';

describe('the <zoom-deck> element', () => {
  it('turns a without= list into feature flags and ignores names it does not know', () => {
    expect(featuresWithout(null)).toEqual({});
    expect(featuresWithout('camera record')).toEqual({ camera: false, record: false });
    expect(featuresWithout('camera, screen')).toEqual({ camera: false, screen: false });
    expect(featuresWithout('teleport')).toEqual({});
  });

  it('reads its Markdown from a text/markdown script, verbatim, or from its text', () => {
    const element = document.createElement('zoom-deck') as ZoomDeckElement;
    element.innerHTML = '<script type="text/markdown">\n::: slide {#a}\n# A &lt;b&gt; [[include: #x]]\n:::\n</script>';
    expect(element.source).toBe('::: slide {#a}\n# A &lt;b&gt; [[include: #x]]\n:::\n');
    const plain = document.createElement('zoom-deck') as ZoomDeckElement;
    plain.textContent = '\n::: slide {#b}\nx\n:::\n';
    expect(plain.source).toBe('::: slide {#b}\nx\n:::\n');
    const empty = document.createElement('zoom-deck') as ZoomDeckElement;
    expect(empty.source).toBeNull();
    expect(customElements.get('zoom-deck')).toBe(ZoomDeckElement);
  });
});
