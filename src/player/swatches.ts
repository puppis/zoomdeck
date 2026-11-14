/**
 * Pen colors as a row of round swatches. The first swatch stands for the deck's own text color
 * ("Default") and shows that color, with an inner ring to tell it from a plain black or white.
 */
export const PEN_COLORS: ReadonlyArray<readonly [string, string]> = [
  ['foreground', 'Default'], ['#EF4444', 'Red'], ['#3B82F6', 'Blue'], ['#22C55E', 'Green'],
];

export interface SwatchesOptions {
  /**
   * In `toggle` mode the swatches are toggle buttons for drawing: the one in use is pressed
   * while drawing is on, and none while it is off, as the player shows them. Clicks are left to
   * the owner, which calls `select` and `setActive`. Otherwise they form a radio group that
   * always has a checked color, as on the pad, and a click selects the color before the owner
   * hears of it.
   */
  toggle?: boolean;
}

export class Swatches {
  readonly element: HTMLElement;
  private _value = 'foreground';
  private _active = false;
  private readonly _toggle: boolean;
  private readonly _buttons = new Map<string, HTMLButtonElement>();

  constructor(private _foreground: string, private readonly onPick: (value: string) => void, { toggle = false }: SwatchesOptions = {}) {
    this._toggle = toggle;
    this.element = document.createElement('div');
    this.element.className = 'swatches';
    this.element.setAttribute('role', toggle ? 'group' : 'radiogroup');
    this.element.setAttribute('aria-label', 'Pen color');
    for (const [value, label] of PEN_COLORS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      if (!toggle) button.setAttribute('role', 'radio');
      button.dataset.value = value;
      button.dataset.label = label;
      button.addEventListener('click', () => {
        if (!this._toggle) this.select(value);
        this.onPick(value);
      });
      this._buttons.set(value, button);
      this.element.append(button);
    }
    this._paint();
    this.select('foreground');
  }

  /** `foreground` or a hex color: the color in use, whether or not drawing is on. */
  get value(): string {
    return this._value;
  }

  /** Make `value` the color in use. */
  select(value: string): void {
    if (!this._buttons.has(value)) return;
    this._value = value;
    this._mark();
  }

  /** Toggle mode: whether drawing is on, which presses the color in use. */
  setActive(on: boolean): void {
    this._active = on;
    this._mark();
  }

  /** The deck's text color, shown by the Default swatch. */
  setForeground(color: string): void {
    this._foreground = color;
    this._paint();
  }

  private _mark(): void {
    for (const [candidate, button] of this._buttons) {
      const current = candidate === this._value;
      if (this._toggle) {
        button.setAttribute('aria-pressed', String(current && this._active));
        button.title = this._title(candidate, current);
      } else {
        button.setAttribute('aria-checked', String(current));
        button.title = this._title(candidate, false);
      }
      button.setAttribute('aria-label', button.title);
    }
  }

  private _title(value: string, current: boolean): string {
    const name = value === 'foreground' ? "Default (the deck's text color)" : this._buttons.get(value)?.dataset.label ?? value;
    if (!this._toggle) return name;
    const index = PEN_COLORS.findIndex(([candidate]) => candidate === value) + 1;
    return current && this._active ? `${name}: drawing is on, click to turn it off (${index})` : `${name}: draw in this color (${index})`;
  }

  private _paint(): void {
    for (const [value, button] of this._buttons) {
      const color = value === 'foreground' ? this._foreground : value;
      button.style.background = color;
      button.style.setProperty('--swatch', color);
    }
  }
}
