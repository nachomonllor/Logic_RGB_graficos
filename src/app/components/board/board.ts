import { Component, ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import * as E from '../../core/engine';
import { cellTints, fixedGroups, rayGeometry } from '../../core/render';
import { GameService } from '../../services/game.service';
import { PieceComponent } from '../piece/piece';
import { ShieldComponent } from '../shield/shield';

export interface CellDown { ev: PointerEvent; k: string; }

/** Tablero en SVG: celdas, rayos de luz, emisores, sensores y escudos. */
@Component({
  selector: 'app-board',
  imports: [ShieldComponent, PieceComponent],
  templateUrl: './board.html',
  styleUrl: './board.scss',
  host: { '(window:resize)': 'onResize()' }
})
export class BoardComponent {
  readonly game = inject(GameService);
  readonly cellDown = output<CellDown>();
  private svgRef = viewChild<ElementRef<SVGSVGElement>>('svg');
  private viewport = signal({ w: window.innerWidth, h: window.innerHeight });

  onResize(): void {
    if (!this.game.drag()) this.viewport.set({ w: window.innerWidth, h: window.innerHeight });
  }

  /** Tamaño de celda (s) y margen (m) según la pantalla. */
  readonly geo = computed(() => {
    const L = this.game.level();
    if (!L) return { s: 56, m: 50 };
    const { w, h } = this.viewport();
    const availW = Math.min(w - 20, 640), availH = Math.max(320, h - 400);
    let s = Math.floor(Math.min(availW / (L.cols + 1.9), availH / (L.rows + 1.9)));
    s = Math.max(36, Math.min(70, s));
    return { s, m: Math.round(s * .95) };
  });

  private cx = (c: number) => this.geo().m + c * this.geo().s + this.geo().s / 2;
  private cy = (r: number) => this.geo().m + r * this.geo().s + this.geo().s / 2;

  readonly vm = computed(() => {
    const L = this.game.level(), I = this.game.info();
    if (!L || !I) return null;
    const { s, m } = this.geo(), cx = this.cx, cy = this.cy;
    const W = L.cols * s + 2 * m, H = L.rows * s + 2 * m;

    const tints = cellTints(this.game.sim());
    const cells: { k: string; x: number; y: number; cx: number; cy: number; blocked: boolean; fill: string; cross: boolean; tint: string | null }[] = [];
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
      const k = E.key(r, c), on = I.onRays.has(k), bl = I.blocked.has(k);
      cells.push({
        k, x: m + c * s + 3, y: m + r * s + 3, cx: cx(c), cy: cy(r), blocked: bl,
        fill: bl ? 'url(#hatch)' : on ? 'rgba(35,43,92,.72)' : 'rgba(26,32,71,.78)',
        cross: on && I.isCross(k) && !bl, tint: bl ? null : tints.get(k) ?? null
      });
    }

    const { lines, emitters, sensors } = rayGeometry(L, this.game.sim(), s, m, this.game.pings());

    // vidrios fijos: los del mismo grupo se dibujan unidos
    const fg = fixedGroups(L);
    const fixedSingles = fg.singles.map(f => ({ t: f.t, transform: `translate(${cx(f.c)} ${cy(f.r)})` }));
    const fixedPieces = fg.groups.map(g => ({ cells: g.cells, links: g.links, transform: `translate(${cx(g.c0)} ${cy(g.r0)})` }));

    const lp = this.game.liftedPiece(), ls = this.game.liftedSingle();
    const pieces = this.game.pp().map((p, pi) => p && pi !== lp
      ? { pi, cells: E.pieceCells(this.game.pieces()[pi], p.k), links: this.game.pieces()[pi].links, transform: `translate(${cx(p.c)} ${cy(p.r)})` } : null).filter(x => !!x);
    const singles = [...this.game.placed()].filter(([k]) => k !== ls).map(([k, t]) => {
      const [r, c] = E.toRC(k);
      return { k, t, transform: `translate(${cx(c)} ${cy(r)})` };
    });
    const marks = (keys: string[]) => keys.map(k => { const [r, c] = E.toRC(k); return { x: cx(c) - s * .42, y: cy(r) - s * .42 }; });

    return {
      s, m, W, H, boardX: m - 10, boardY: m - 10, boardW: L.cols * s + 20, boardH: L.rows * s + 20,
      cells, lines, emitters, sensors, fixedSingles, fixedPieces, pieces, singles,
      flash: marks(this.game.flashKeys()), wrong: marks(this.game.wrongKeys())
    };
  });

  /** Celdas resaltadas: las válidas para un escudo suelto, o la huella de la pieza bajo el dedo. */
  readonly highlights = computed(() => {
    const L = this.game.level(), I = this.game.info();
    if (!L || !I) return [];
    const { s, m } = this.geo();
    const d = this.game.drag(), sel = this.game.selection();
    const box = (r: number, c: number, fill: string, stroke: string, w: number, pulse: boolean) =>
      ({ x: m + c * s + 4, y: m + r * s + 4, fill, stroke, w, pulse });
    const pieceDrag = d && d.moved && d.kind === 'piece';
    if (pieceDrag || typeof sel === 'number') {
      const hover = d?.hover;
      if (!hover) return [];
      const pi = pieceDrag ? d!.pi! : (sel as number);
      const k = pieceDrag ? d!.k! : this.game.pRot()[pi];
      const grab = pieceDrag ? d!.grab! : 0;
      const cells = E.pieceCells(this.game.pieces()[pi], k);
      const [hr, hc] = E.toRC(hover);
      const r0 = hr - cells[grab].dr, c0 = hc - cells[grab].dc;
      const ok = this.game.pieceFits(pi, k, r0, c0);
      return cells.map(x => ({ r: x.dr + r0, c: x.dc + c0 }))
        .filter(p => p.r >= 0 && p.c >= 0 && p.r < L.rows && p.c < L.cols)
        .map(p => box(p.r, p.c, ok ? 'rgba(61,220,132,.3)' : 'rgba(255,77,94,.3)', ok ? '#3ddc84' : '#ff4d5e', 3, false));
    }
    if (!sel && !(d && d.moved)) return [];
    const pm = this.game.pieceMap(), hover = d?.hover;
    return [...I.placeable].filter(k => !pm.has(k)).map(k => {
      const [r, c] = E.toRC(k), isH = k === hover;
      return box(r, c, isH ? 'rgba(255,210,94,.35)' : 'rgba(255,210,94,.08)', '#ffd25e', isH ? 3 : 1.5, !isH);
    });
  });

  /** Celda bajo un punto de la pantalla, o null si cae afuera de la grilla. */
  cellFromPoint(x: number, y: number): string | null {
    const L = this.game.level();
    if (!L) return null;
    const svg = this.svgRef()?.nativeElement, ctm = svg?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(x, y).matrixTransform(ctm.inverse());
    const { s, m } = this.geo();
    const c = Math.floor((p.x - m) / s), r = Math.floor((p.y - m) / s);
    if (r < 0 || c < 0 || r >= L.rows || c >= L.cols) return null;
    return E.key(r, c);
  }

  onPointerDown(ev: PointerEvent): void {
    const k = this.cellFromPoint(ev.clientX, ev.clientY);
    if (k) this.cellDown.emit({ ev, k });
  }
}
