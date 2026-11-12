/**
 * Pen colors as a row of swatches. The first swatch stands for the deck's own
 * text color ("Default") and shows that color, with an inner ring to tell it
 * from a plain black or white.
 */
export const PEN_COLORS: ReadonlyArray<readonly [string, string]> = [
  ['foreground', 'Default'], ['#000000', 'Black'], ['#FFFFFF', 'White'], ['#EF4444', 'Red'],
  ['#FACC15', 'Yellow'], ['#22C55E', 'Green'], ['#3B82F6', 'Blue'],
];

export class Swatches {
  readonly element: HTMLElement;
  private _value = 'foreground';
  private readonly _buttons = new Map<string, HTMLButtonElement>();

  constructor(private _foreground: string, private readonly onChange: () => void) {
    this.element = document.createElement('div');
    this.element.className = 'swatches';
    this.element.setAttribute('role', 'radiogroup');
    this.element.setAttribute('aria-label', 'Pen color');
    for (const [value, label] of PEN_COLORS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.setAttribute('role', 'radio');
      button.dataset.value = value;
      button.title = value === 'foreground' ? "Default (the deck's text color)" : label;
      button.setAttribute('aria-label', button.title);
      button.addEventListener('click', () => this.select(value));
      this._buttons.set(value, button);
      this.element.append(button);
    }
    this._paint();
    this.select('foreground', false);
  }

  /** `foreground` or a hex color. */
  get value(): string {
    return this._value;
  }

  select(value: string, notify = true): void {
    if (!this._buttons.has(value)) return;
    this._value = value;
    for (const [candidate, button] of this._buttons) button.setAttribute('aria-checked', String(candidate === value));
    if (notify) this.onChange();
  }

  /** The deck's text color, shown by the Default swatch. */
  setForeground(color: string): void {
    this._foreground = color;
    this._paint();
  }

  private _paint(): void {
    for (const [value, button] of this._buttons) button.style.background = value === 'foreground' ? this._foreground : value;
  }
}
