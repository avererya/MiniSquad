// Keyboard, mouse and touch input -> one squad movement vector + targeting taps.
import type { Vec } from './util';
import { VIEW_W, VIEW_H } from './view';

export interface InputHandler {
  isTargeting(): boolean;
  /** Ground tap/click while targeting (screen coords, logical px). */
  onTargetConfirm(screen: Vec): void;
  onTargetCancel(): void;
  onKey(code: string, e: KeyboardEvent): void;
  onAnyInput(): void;
}

const JOY_RADIUS = 64;
const JOY_DEADZONE = 0.15;

export class Input {
  keys = new Set<string>();
  pointer: Vec = { x: VIEW_W / 2, y: VIEW_H / 2 }; // last known pointer pos (logical screen px)
  pointerSeen = false;
  joy: { id: number; origin: Vec; cur: Vec } | null = null;
  private pendingTap: { id: number; start: Vec; left: boolean } | null = null;

  constructor(private stage: HTMLElement, canvas: HTMLCanvasElement, h: InputHandler) {
    window.addEventListener('keydown', (e) => {
      h.onAnyInput();
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) h.onKey(e.code, e);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e) => {
      h.onAnyInput();
      const p = this.toLogical(e);
      this.pointer = p; this.pointerSeen = true;
      if (e.pointerType === 'mouse') {
        if (e.button === 2) h.onTargetCancel();
        else if (e.button === 0 && h.isTargeting()) h.onTargetConfirm(p);
        return;
      }
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const left = p.x < VIEW_W * 0.45;
      if (h.isTargeting() && !this.pendingTap) {
        this.pendingTap = { id: e.pointerId, start: p, left };
      } else if (left && !this.joy) {
        this.joy = { id: e.pointerId, origin: p, cur: p };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.toLogical(e);
      if (e.pointerType === 'mouse') { this.pointer = p; this.pointerSeen = true; return; }
      if (this.joy && e.pointerId === this.joy.id) { this.joy.cur = p; return; }
      const t = this.pendingTap;
      if (t && e.pointerId === t.id) {
        if (t.left && !this.joy && Math.hypot(p.x - t.start.x, p.y - t.start.y) > 18) {
          // dragging on the left half while targeting: it's the joystick after all
          this.joy = { id: e.pointerId, origin: t.start, cur: p };
          this.pendingTap = null;
        } else {
          this.pointer = p; this.pointerSeen = true;
        }
      }
    });
    const end = (e: PointerEvent) => {
      if (this.joy && e.pointerId === this.joy.id) this.joy = null;
      const t = this.pendingTap;
      if (t && e.pointerId === t.id) {
        this.pendingTap = null;
        if (e.type === 'pointerup' && h.isTargeting()) h.onTargetConfirm(this.toLogical(e));
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  toLogical(e: { clientX: number; clientY: number }): Vec {
    const r = this.stage.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * VIEW_W, y: ((e.clientY - r.top) / r.height) * VIEW_H };
  }

  /** Squad movement vector, length 0..1. */
  move(): Vec {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (x || y) { const l = Math.hypot(x, y); return { x: x / l, y: y / l }; }
    if (this.joy) {
      const dx = (this.joy.cur.x - this.joy.origin.x) / JOY_RADIUS;
      const dy = (this.joy.cur.y - this.joy.origin.y) / JOY_RADIUS;
      const l = Math.hypot(dx, dy);
      if (l < JOY_DEADZONE) return { x: 0, y: 0 };
      const m = Math.min(1, (l - JOY_DEADZONE) / (1 - JOY_DEADZONE));
      return { x: (dx / l) * m, y: (dy / l) * m };
    }
    return { x: 0, y: 0 };
  }

  drawJoystick(ctx: CanvasRenderingContext2D) {
    if (!this.joy) return;
    const { origin, cur } = this.joy;
    let dx = cur.x - origin.x, dy = cur.y - origin.y;
    const l = Math.hypot(dx, dy);
    if (l > JOY_RADIUS) { dx = (dx / l) * JOY_RADIUS; dy = (dy / l) * JOY_RADIUS; }
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(origin.x, origin.y, JOY_RADIUS, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(origin.x + dx, origin.y + dy, 26, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
