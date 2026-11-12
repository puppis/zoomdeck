/**
 * The companion tablet page: a picture of the presenter's current slide (or a
 * blank whiteboard) with ink on top, and nothing else. It runs no part of the
 * engine: the presenter sends a new picture whenever a stop settles, and the
 * two pages exchange strokes through the preview server's socket. Every
 * gesture other than drawing is disabled, so a pencil touching the glass
 * never selects, scrolls or zooms.
 */
import { DEFAULT_PEN_STYLE, InkSurface, newStrokeId, type InkSample, type InkStroke, type InkTool } from '../player/ink';
import { PadLink, padLinkAvailable, type InkOp, type InkSurfaceName, type PadMessage } from '../player/pad';
import { Swatches } from '../player/swatches';
import padCss from './pad.css?inline';

const ERASE_REACH_PX = 12;

const SVG_NS = 'http://www.w3.org/2000/svg';
const HIGHLIGHTER_COLOR = '#ffdf00';
const BOARD_STEP = 0.25;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

class Pad {
  private readonly link: PadLink;
  private readonly frame: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly board: HTMLElement;
  private readonly waiting: HTMLElement;
  private readonly status: HTMLElement;
  private readonly slideSvg: SVGSVGElement;
  private readonly boardSvg: SVGSVGElement;
  private readonly slideInk: InkSurface;
  private readonly boardInk: InkSurface;
  private readonly boardButton: HTMLButtonElement;
  private readonly toolSelect: HTMLSelectElement;
  private readonly colors: Swatches;
  private readonly sizeSelect: HTMLSelectElement;
  private aspect = 16 / 9;
  private foreground = '#000000';
  private boardOn = false;
  private pan = { x: 0, y: 0 };
  private target = { x: 0, y: 0 };
  private panFrame: number | null = null;
  private syncFrame: number | null = null;
  private hoverFrame: number | null = null;
  private live: { id: string; surface: InkSurfaceName; pointerId: number; pending: InkSample[]; frame: number | null; pressure: boolean; announce: boolean } | null = null;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private penSeen = 0;
  private connected = false;

  constructor(room: string) {
    document.head.append(el('style', { text: padCss }));
    this.link = new PadLink(room);
    const style = () => DEFAULT_PEN_STYLE;
    this.image = el('img', { alt: 'The presenter\'s current slide', hidden: '' });
    this.board = el('div', { class: 'board', hidden: '' });
    this.slideSvg = document.createElementNS(SVG_NS, 'svg');
    this.slideSvg.setAttribute('class', 'slide');
    this.boardSvg = document.createElementNS(SVG_NS, 'svg');
    this.boardSvg.setAttribute('class', 'boardink');
    this.slideInk = new InkSurface(this.slideSvg, style, 'slide-ink');
    this.boardInk = new InkSurface(this.boardSvg, style, 'board-ink');
    this.waiting = el('div', { class: 'waiting', text: 'Waiting for the presenter… Open the deck on the computer, with the preview server started with --host.' });
    this.frame = el('div', { class: 'frame' }, this.image, this.board, this.waiting);
    this.frame.append(this.slideSvg, this.boardSvg);
    const view = el('div', { class: 'view' }, this.frame);

    this.toolSelect = el('select', { 'aria-label': 'Tool' });
    for (const [value, label] of [['pen', 'Pen'], ['highlighter', 'Highlighter']]) this.toolSelect.append(el('option', { value, text: label }));
    this.colors = new Swatches(this.foreground, () => this.finishStroke());
    this.sizeSelect = el('select', { 'aria-label': 'Tip size' });
    for (const size of ['1', '3', '6', '10']) {
      const option = el('option', { value: size, text: `${size} px` });
      if (size === '3') option.selected = true;
      this.sizeSelect.append(option);
    }
    const undo = el('button', { text: 'Undo' });
    const redo = el('button', { text: 'Redo' });
    const clear = el('button', { text: 'Clear' });
    this.boardButton = el('button', { text: 'Whiteboard', 'aria-pressed': 'false' });
    this.status = el('span', { class: 'status', text: padLinkAvailable() ? 'Connecting…' : 'Not served by the preview server' });
    const footer = el('footer', {},
      el('label', {}, 'Tool ', this.toolSelect), el('label', {}, 'Color ', this.colors.element), el('label', {}, 'Tip ', this.sizeSelect),
      undo, redo, clear, this.boardButton, this.status);
    document.body.append(el('div', { class: 'pad' }, view, footer));

    undo.addEventListener('click', () => this.undo());
    redo.addEventListener('click', () => this.redo());
    clear.addEventListener('click', () => this.clear());
    this.boardButton.addEventListener('click', () => {
      this.setBoard(!this.boardOn);
      this.link.send({ type: 'board', on: this.boardOn, pan: { ...this.target } });
    });
    for (const select of [this.toolSelect, this.sizeSelect]) select.addEventListener('change', () => this.finishStroke());

    this.installPointer();
    this.layout();
    window.addEventListener('resize', () => this.layout());
    this.link.on((message) => this.onMessage(message));
    this.link.send({ type: 'hello', role: 'pad' });
  }

  // --- geometry -------------------------------------------------------

  private units(): { width: number; height: number } {
    return { width: Math.round(1000 * this.aspect), height: 1000 };
  }

  private layout(): void {
    const view = this.frame.parentElement as HTMLElement;
    const maxWidth = view.clientWidth - 16;
    const maxHeight = view.clientHeight - 16;
    const width = Math.max(1, Math.min(maxWidth, maxHeight * this.aspect));
    const height = width / this.aspect;
    this.frame.style.width = `${width}px`;
    this.frame.style.height = `${height}px`;
    const units = this.units();
    for (const svg of [this.slideSvg, this.boardSvg]) svg.setAttribute('viewBox', `${-units.width / 2} ${-units.height / 2} ${units.width} ${units.height}`);
    this.layoutGrid();
  }

  private scale(): number {
    return this.frame.clientWidth / this.units().width || 1;
  }

  private layoutGrid(): void {
    const scale = this.scale();
    const cell = 50 * scale;
    this.board.style.backgroundSize = `${cell}px ${cell}px`;
    this.board.style.backgroundPosition = `calc(50% - ${(this.pan.x * scale) % cell}px) calc(50% - ${(this.pan.y * scale) % cell}px)`;
  }

  private surfacePoint(clientX: number, clientY: number, surface: InkSurfaceName): { x: number; y: number } {
    const rect = this.frame.getBoundingClientRect();
    const scale = this.scale();
    const x = (clientX - rect.left - rect.width / 2) / scale;
    const y = (clientY - rect.top - rect.height / 2) / scale;
    return surface === 'board' ? { x: x + this.pan.x, y: y + this.pan.y } : { x, y };
  }

  private activeSurface(): InkSurfaceName {
    return this.boardOn ? 'board' : 'slide';
  }

  private surface(name: InkSurfaceName): InkSurface {
    return name === 'board' ? this.boardInk : this.slideInk;
  }

  // --- messages -------------------------------------------------------

  private onMessage(message: PadMessage): void {
    switch (message.type) {
      case 'hello':
        if (message.role === 'presenter') this.link.send({ type: 'hello', role: 'pad' });
        break;
      case 'state':
        this.connected = true;
        this.status.textContent = 'Connected';
        this.waiting.hidden = true;
        if (Math.abs(message.aspect - this.aspect) > 1e-6) {
          this.aspect = message.aspect;
          this.layout();
        }
        document.documentElement.style.setProperty('--background', message.background);
        document.documentElement.style.setProperty('--foreground', message.foreground);
        this.foreground = message.foreground;
        this.colors.setForeground(message.foreground);
        this.applyBoard(message.board, message.pan);
        break;
      case 'frame':
        this.image.src = message.image;
        this.image.hidden = false;
        break;
      case 'board':
        this.applyBoard(message.on, message.pan);
        break;
      case 'ink':
        this.applyInk(message.surface, message);
        break;
      case 'hover':
        break;
    }
  }

  private applyInk(surface: InkSurfaceName, op: InkOp): void {
    const target = this.surface(surface);
    switch (op.op) {
      case 'begin': target.begin(op.stroke); break;
      case 'extend':
        target.extend(op.id, op.samples);
        if (op.pressure) target.setPressure(op.id, true);
        break;
      case 'end': target.end(op.id); break;
      case 'erase': target.erase(op.id); break;
      case 'undo': target.undo(); break;
      case 'redo': target.redo(); break;
      case 'clear': target.clear(); break;
      case 'replace': target.replace(op.strokes); break;
    }
  }

  private applyBoard(on: boolean, pan: { x: number; y: number }): void {
    if (on !== this.boardOn) this.setBoard(on);
    if (pan.x !== this.target.x || pan.y !== this.target.y) this.setPan(pan.x, pan.y, true);
  }

  private setBoard(on: boolean): void {
    this.finishStroke();
    this.boardOn = on;
    this.board.hidden = !on;
    this.frame.classList.toggle('board-on', on);
    this.boardButton.setAttribute('aria-pressed', String(on));
  }

  private setPan(x: number, y: number, animate: boolean): void {
    this.target = { x, y };
    if (!animate || document.hidden) {
      if (this.panFrame !== null) cancelAnimationFrame(this.panFrame);
      this.panFrame = null;
      this.applyPan(x, y);
      return;
    }
    if (this.panFrame !== null) return;
    const step = () => {
      const dx = this.target.x - this.pan.x;
      const dy = this.target.y - this.pan.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        this.panFrame = null;
        this.applyPan(this.target.x, this.target.y);
        return;
      }
      this.applyPan(this.pan.x + dx * 0.2, this.pan.y + dy * 0.2);
      this.panFrame = requestAnimationFrame(step);
    };
    this.panFrame = requestAnimationFrame(step);
  }

  private applyPan(x: number, y: number): void {
    this.pan = { x, y };
    this.boardInk.setPan(x, y);
    this.layoutGrid();
  }

  private queueBoardSync(): void {
    if (this.syncFrame !== null) return;
    this.syncFrame = requestAnimationFrame(() => {
      this.syncFrame = null;
      this.link.send({ type: 'board', on: this.boardOn, pan: { ...this.target } });
    });
  }

  // --- ink ------------------------------------------------------------

  private undo(): void {
    this.finishStroke();
    const surface = this.activeSurface();
    if (this.surface(surface).undo()) this.link.send({ type: 'ink', surface, op: 'undo' });
  }

  private redo(): void {
    const surface = this.activeSurface();
    if (this.surface(surface).redo()) this.link.send({ type: 'ink', surface, op: 'redo' });
  }

  private clear(): void {
    this.finishStroke();
    const surface = this.activeSurface();
    if (this.surface(surface).clear().length) this.link.send({ type: 'ink', surface, op: 'clear' });
  }

  private sample(event: { clientX: number; clientY: number; pressure?: number; pointerType?: string }, surface: InkSurfaceName): InkSample {
    const { x, y } = this.surfacePoint(event.clientX, event.clientY, surface);
    const p = event.pointerType === 'pen' && event.pressure ? event.pressure : 0.5;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, p: Math.round(p * 1000) / 1000 };
  }

  private beginStroke(event: PointerEvent): void {
    this.finishStroke();
    const surface = this.activeSurface();
    const tool = this.toolSelect.value as InkTool;
    const scale = this.scale();
    const stroke: InkStroke = {
      id: newStrokeId(this.link.id),
      tool,
      color: tool === 'pen' ? (this.colors.value === 'foreground' ? this.foreground : this.colors.value) : HIGHLIGHTER_COLOR,
      size: (tool === 'pen' ? Number(this.sizeSelect.value) : 36) / scale,
      pressure: event.pointerType === 'pen' && event.pressure > 0,
      samples: [this.sample(event, surface)],
    };
    this.surface(surface).begin(stroke);
    this.live = { id: stroke.id, surface, pointerId: event.pointerId, pending: [], frame: null, pressure: stroke.pressure, announce: false };
    try {
      this.frame.setPointerCapture(event.pointerId);
    } catch {
      /* capture unavailable */
    }
    this.link.send({ type: 'ink', surface, op: 'begin', stroke });
  }

  private extendStroke(event: PointerEvent): void {
    const live = this.live;
    if (!live || event.pointerId !== live.pointerId) return;
    const events = event.getCoalescedEvents?.() ?? [];
    const source = events.length ? events : [event];
    const samples = source.map((item) => this.sample(item, live.surface));
    const surface = this.surface(live.surface);
    surface.extend(live.id, samples);
    if (!live.pressure && source.some((item) => item.pointerType === 'pen' && item.pressure > 0)) {
      live.pressure = true;
      live.announce = true;
      surface.setPressure(live.id, true);
    }
    // Draw at once rather than at the next frame, with the browser's prediction of where the pen goes.
    const predicted = (event.getPredictedEvents?.() ?? []).slice(0, 4).map((item) => this.sample(item, live.surface));
    surface.drawLive(live.id, predicted);
    live.pending.push(...samples);
    if (live.frame === null) {
      live.frame = requestAnimationFrame(() => {
        live.frame = null;
        this.flushPending(live);
      });
    }
  }

  private flushPending(live: NonNullable<Pad['live']>): void {
    if (live.pending.length === 0 && !live.announce) return;
    this.link.send({ type: 'ink', surface: live.surface, op: 'extend', id: live.id, samples: live.pending, ...(live.announce ? { pressure: true as const } : {}) });
    live.pending = [];
    live.announce = false;
  }

  private finishStroke(): void {
    const live = this.live;
    if (!live) return;
    this.live = null;
    if (live.frame !== null) cancelAnimationFrame(live.frame);
    this.flushPending(live);
    this.surface(live.surface).end(live.id);
    this.link.send({ type: 'ink', surface: live.surface, op: 'end', id: live.id });
    try {
      this.frame.releasePointerCapture(live.pointerId);
    } catch {
      /* not captured */
    }
  }

  private sendHover(event: PointerEvent, visible: boolean): void {
    if (this.hoverFrame !== null) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = null;
      const point = visible ? this.surfacePoint(event.clientX, event.clientY, this.activeSurface()) : { x: 0, y: 0 };
      this.link.send({ type: 'hover', x: Math.round(point.x), y: Math.round(point.y), visible });
    });
  }

  // --- input ------------------------------------------------------------

  private installPointer(): void {
    const frame = this.frame;
    // Nothing but ink: no selection, callout, context menu, zoom or scroll from a touch or a pencil.
    for (const type of ['contextmenu', 'selectstart', 'dragstart', 'dblclick', 'gesturestart', 'gesturechange'] as const) {
      document.addEventListener(type, (event) => event.preventDefault());
    }
    // Cancelling the touch events on the surface (not the toolbar) ends Safari's gesture
    // arbitration at once: with a palm already resting, a pencil coming down otherwise looks
    // like the second finger of a pinch and its first events are held back for a moment,
    // which loses the start of quick strokes. Pointer events are unaffected by this.
    for (const type of ['touchstart', 'touchmove', 'touchend'] as const) {
      frame.addEventListener(type, (event) => event.preventDefault(), { passive: false });
    }
    const raw = 'onpointerrawupdate' in frame;
    if (raw) {
      frame.addEventListener('pointerrawupdate' as 'pointermove', (event: PointerEvent) => {
        if (event.pointerType !== 'touch' && event.buttons & 1) this.extendStroke(event);
      });
    }
    frame.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') {
        this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        this.fingerErase(event);
        return;
      }
      if (event.button !== 0) return;
      if (event.pointerType === 'pen') this.penSeen = performance.now();
      event.preventDefault();
      this.beginStroke(event);
    });
    frame.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') {
        this.touchMove(event);
        return;
      }
      if (event.pointerType === 'pen' && event.buttons & 1) this.penSeen = performance.now();
      if (this.live) {
        if (!(event.buttons & 1)) this.finishStroke();
        else if (!raw) this.extendStroke(event);
      } else if (event.pointerType === 'pen') this.sendHover(event, true);
    });
    const release = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        this.touches.delete(event.pointerId);
        return;
      }
      if (event.pointerType === 'pen') this.penSeen = performance.now();
      if (this.live && this.live.pointerId === event.pointerId) this.finishStroke();
    };
    document.addEventListener('pointerup', release);
    frame.addEventListener('pointercancel', release);
    frame.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'pen' && !this.live) this.sendHover(event, false);
    });
    frame.addEventListener('wheel', (event) => {
      if (!this.boardOn) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.clientHeight : 1;
      const scale = this.scale();
      this.setPan(this.target.x + (event.deltaX * unit) / scale, this.target.y + (event.deltaY * unit) / scale, false);
      this.queueBoardSync();
    }, { passive: false });
    document.addEventListener('keydown', (event) => {
      if (!this.boardOn) return;
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
      if (!arrow) return;
      event.preventDefault();
      const units = this.units();
      this.setPan(this.target.x + arrow[0] * units.width * BOARD_STEP, this.target.y - arrow[1] * units.height * BOARD_STEP, true);
      this.link.send({ type: 'board', on: this.boardOn, pan: { ...this.target } });
    });
    window.addEventListener('blur', () => this.finishStroke());
  }

  /**
   * A fingertip rubbed over a stroke erases it: not while the pencil is drawing or just
   * finished (that finger is the resting palm), and not for a wide contact, a palm as well.
   * Safari reports a fingertip as 40 to 60 px across and a palm as well over 100; a hovering
   * pencil does not count as working, or a finger could never erase on an iPad that reports hover.
   */
  private fingerErase(event: PointerEvent): void {
    if (this.touches.size !== 1 || this.live || performance.now() - this.penSeen < 300) return;
    if (event.width > 90 || event.height > 90) return;
    const surface = this.activeSurface();
    const point = this.surfacePoint(event.clientX, event.clientY, surface);
    const id = this.surface(surface).strokeAt(point.x, point.y, ERASE_REACH_PX / this.scale());
    if (!id) return;
    this.surface(surface).erase(id);
    this.link.send({ type: 'ink', surface, op: 'erase', id });
  }

  /** Two fingers scroll the whiteboard; one finger erases and never draws, so a resting palm leaves no mark. */
  private touchMove(event: PointerEvent): void {
    const previous = this.touches.get(event.pointerId);
    if (!previous) return;
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touches.size === 1) {
      this.fingerErase(event);
      return;
    }
    if (!this.boardOn || this.touches.size < 2) return;
    const scale = this.scale();
    const share = this.touches.size;
    this.setPan(this.target.x - (event.clientX - previous.x) / scale / share, this.target.y - (event.clientY - previous.y) / scale / share, false);
    this.queueBoardSync();
  }
}

const room = new URLSearchParams(location.search).get('room');
if (room) new Pad(room);
else {
  document.body.textContent = 'This page is opened from the pairing code in the player\'s settings (Tablet).';
}
