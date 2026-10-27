import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import * as E from '../../core/engine';
import { Dir } from '../../core/models';
import { cellTints, rayGeometry } from '../../core/render';
import { DesignerService } from '../../services/designer.service';
import { ShieldComponent } from '../shield/shield';

interface Pos { r: number; c: number; fx: number; fy: number; }

/** Tablero del diseñador: muestra el diseño con la luz en vivo y traduce los toques en acciones. */
@Component({
  selector: 'app-design-board',
  imports: [ShieldComponent],
  templateUrl: './design-board.html',
  styleUrl: './design-board.scss',
  host: { '(window:resize)': 'onResize()' }
})
export class DesignBoardComponent {
  readonly d = inject(DesignerService);
  private svgRef = viewChild<ElementRef<SVGSVGElement>>('svg');
  private viewport = signal({ w: window.innerWidth, h: window.innerHeight });
  readonly hover = signal<string | null>(null);
  private gesture: { last: string; paint?: boolean; linkFrom?: string } | null = null;

  onResize(): void { this.viewport.set({ w: window.innerWidth, h: window.innerHeight }); }

  /** Tamaño de celda: entra en el espacio que dejan los paneles laterales. */
  readonly geo = computed(() => {
    const st = this.d.state(), { w, h } = this.viewport();
    const wide = w >= 1100;
    const availW = wide ? w - 600 : w - 24, availH = wide ? h - 120 : 2000;
    const s = Math.max(20, Math.min(56, Math.floor(Math.min(availW / (st.cols + 2), availH / (st.rows + 2)))));
    return { s, m: s };
  });

  readonly vm = computed(() => {
    const st = this.d.state(), L = this.d.preview(), I = this.d.info(), disp = this.d.display();
    const { s, m } = this.geo();
    const cx = (c: number) => m + c * s + s / 2, cy = (r: number) => m + r * s + s / 2;
    const W = st.cols * s + 2 * m, H = st.rows * s + 2 * m;
    const blocked = new Set(st.blocked);
    const tints = cellTints(this.d.sim());
    const cells = [];
    for (let r = 0; r < st.rows; r++) for (let c = 0; c < st.cols; c++) {
      const k = E.key(r, c), on = I.onRays.has(k), bl = blocked.has(k);
      cells.push({ k, x: m + c * s + 2, y: m + r * s + 2, cx: cx(c), cy: cy(r), fill: bl ? 'url(#dhatch)' : on ? 'rgba(35,43,92,.72)' : 'rgba(26,32,71,.78)', blocked: bl, cross: on && I.isCross(k) && !bl, tint: bl ? null : tints.get(k) ?? null });
    }
    const { lines, emitters, sensors } = rayGeometry(L, this.d.sim(), s, m);
    const locked = new Set(st.locked);
    const glass = Object.entries(disp.glass).map(([k, t]) => {
      const [r, c] = E.toRC(k);
      return { k, t, locked: locked.has(k), transform: `translate(${cx(c)} ${cy(r)})` };
    });
    const links = disp.links.map(l => {
      const [a, b] = l.split('|').map(E.toRC);
      const lk = locked.has(E.key(a[0], a[1]));
      return { x1: cx(a[1]), y1: cy(a[0]), x2: cx(b[1]), y2: cy(b[0]), col: lk ? '#c9cdf5' : '#ffd25e' };
    });
    // en modo conector: posibles conexiones entre vidrios vecinos todavía sueltos
    const maybe: { x1: number; y1: number; x2: number; y2: number }[] = [];
    if (this.d.tool() === 'link' && !disp.alt) {
      const set = new Set(disp.links);
      for (const k of Object.keys(disp.glass)) {
        const [r, c] = E.toRC(k);
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const k2 = E.key(r + dr, c + dc);
          if (!(k2 in disp.glass)) continue;
          const lk = k < k2 ? `${k}|${k2}` : `${k2}|${k}`;
          if (!set.has(lk)) maybe.push({ x1: cx(c), y1: cy(r), x2: cx(c + dc), y2: cy(r + dr) });
        }
      }
    }
    // en modo proyector: lugares libres del borde
    const slots: { x: number; y: number }[] = [];
    if (this.d.tool() === 'projector') {
      const used = new Set(st.emitters.map(e => E.key(e.r, e.c)));
      const add = (r: number, c: number) => { if (!used.has(E.key(r, c))) slots.push({ x: cx(c), y: cy(r) }); };
      for (let r = 0; r < st.rows; r++) { add(r, -1); add(r, st.cols); }
      for (let c = 0; c < st.cols; c++) { add(-1, c); add(st.rows, c); }
    }
    const hv = this.hover();
    let hoverBox = null;
    if (hv) { const [r, c] = E.toRC(hv); hoverBox = { x: m + c * s + 1, y: m + r * s + 1 }; }
    return { s, m, W, H, cells, lines, emitters, sensors, glass, links, maybe, slots, hoverBox, tile: s * .66 };
  });

  private posFrom(ev: PointerEvent): Pos | null {
    const svg = this.svgRef()?.nativeElement, ctm = svg?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    const { s, m } = this.geo();
    const x = (p.x - m) / s, y = (p.y - m) / s;
    const c = Math.floor(x), r = Math.floor(y);
    const st = this.d.state();
    if (r < -1 || c < -1 || r > st.rows || c > st.cols) return null;
    return { r, c, fx: x - c, fy: y - r };
  }
  private sideOf(p: Pos): Dir | null {
    const dists: [Dir, number][] = [['N', p.fy], ['S', 1 - p.fy], ['W', p.fx], ['E', 1 - p.fx]];
    dists.sort((a, b) => a[1] - b[1]);
    return dists[0][1] < .3 ? dists[0][0] : null;
  }

  onDown(ev: PointerEvent): void {
    const p = this.posFrom(ev);
    if (!p) return;
    ev.preventDefault();
    this.d.altView.set(null);
    try { this.svgRef()!.nativeElement.setPointerCapture(ev.pointerId); } catch { /* sin captura */ }
    this.d.beginGesture();
    const k = E.key(p.r, p.c);
    const res = this.d.apply(p.r, p.c, this.sideOf(p));
    this.gesture = { last: k, paint: typeof res === 'boolean' ? res : undefined, linkFrom: k in this.d.state().glass ? k : undefined };
  }

  onMove(ev: PointerEvent): void {
    const p = this.posFrom(ev);
    const st = this.d.state();
    const k = p && p.r >= 0 && p.c >= 0 && p.r < st.rows && p.c < st.cols ? E.key(p.r, p.c) : null;
    if (k !== this.hover()) this.hover.set(k);
    const g = this.gesture;
    if (!g || !p || !k || k === g.last) return;
    const tool = this.d.tool();
    if (tool === 'glass' || tool === 'erase' || tool === 'block') {
      this.d.apply(p.r, p.c, null, g.paint);
    } else if (tool === 'link' && g.linkFrom) {
      // arrastrar de un vidrio al vecino los conecta
      const [r0, c0] = E.toRC(g.linkFrom);
      const dr = p.r - r0, dc = p.c - c0;
      if (Math.abs(dr) + Math.abs(dc) === 1) {
        const side: Dir = dr === -1 ? 'N' : dr === 1 ? 'S' : dc === 1 ? 'E' : 'W';
        this.d.apply(r0, c0, side);
      }
      g.linkFrom = k in this.d.state().glass ? k : undefined;
    }
    g.last = k;
  }

  onUp(ev: PointerEvent): void {
    this.gesture = null;
    try { this.svgRef()!.nativeElement.releasePointerCapture(ev.pointerId); } catch { /* sin captura */ }
  }
}
