import { Injectable, computed, inject, signal } from '@angular/core';
import * as E from '../core/engine';
import { LEVELS } from '../core/levels';
import { Level, Piece, PiecePlacement, ShieldType } from '../core/models';
import { ConfettiService } from './confetti.service';
import { ProgressService } from './progress.service';
import { SoundService } from './sound.service';

export type StatusKind = '' | 'ok' | 'bad' | 'hint';
/** Lo que el jugador tiene elegido en la bandeja: un tipo de escudo o el índice de una pieza. */
export type Selection = ShieldType | number | null;

/** Arrastre en curso (de la bandeja o del tablero). */
export interface DragState {
  kind: 'single' | 'piece';
  src: 'tray' | 'board';
  t?: ShieldType;
  from?: string;
  pi?: number;
  k?: number;
  grab?: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  moved: boolean;
  hover: string | null;
}

interface Snapshot { placed: Map<string, ShieldType>; pp: (PiecePlacement | null)[]; }

/** Estado y reglas de una partida. Los componentes solo leen señales y llaman acciones. */
@Injectable({ providedIn: 'root' })
export class GameService {
  private sound = inject(SoundService);
  private progress = inject(ProgressService);
  private confetti = inject(ConfettiService);

  readonly level = signal<Level | null>(null);
  readonly levelIndex = signal(-1);
  readonly band = signal<string | null>(null);
  /** true cuando se está probando un nivel del diseñador. */
  readonly custom = signal(false);
  readonly title = signal('');
  readonly subtitle = signal('');
  readonly placed = signal(new Map<string, ShieldType>());
  readonly pp = signal<(PiecePlacement | null)[]>([]);
  readonly pRot = signal<number[]>([]);
  readonly hints = signal(0);
  readonly won = signal(false);
  readonly showVictory = signal(false);
  readonly lastResult = signal<{ stars: number; timeMs: number; hints: number } | null>(null);
  readonly status = signal<{ text: string; kind: StatusKind }>({ text: '', kind: '' });
  readonly selection = signal<Selection>(null);
  readonly drag = signal<DragState | null>(null);
  readonly flashKeys = signal<string[]>([]);
  readonly wrongKeys = signal<string[]>([]);
  readonly pings = signal<number[]>([]);
  readonly generating = signal(false);

  private order = new Map<string, number>();
  private porder: number[] = [];
  private stamp = 0;
  private undoStack: Snapshot[] = [];
  readonly canUndo = signal(false);
  private startTime = 0;
  private okPrev: boolean[] = [];
  private winTimer: ReturnType<typeof setTimeout> | undefined;

  readonly levels = LEVELS;
  readonly pieces = computed<Piece[]>(() => this.level()?.pieces || []);
  readonly info = computed(() => { const L = this.level(); return L ? E.info(L) : null; });

  /** Celdas ocupadas por piezas puestas: celda -> pieza y escudo. */
  readonly pieceMap = computed(() => {
    const m = new Map<string, { pi: number; t: ShieldType }>();
    this.pp().forEach((p, pi) => {
      if (p) E.placedCells(this.pieces()[pi], p).forEach(a => m.set(E.key(a.r, a.c), { pi, t: a.t }));
    });
    return m;
  });

  /** Lo que se dibuja como "levantado" mientras se arrastra desde el tablero. */
  readonly liftedPiece = computed(() => { const d = this.drag(); return d && d.moved && d.kind === 'piece' && d.src === 'board' ? d.pi! : -1; });
  readonly liftedSingle = computed(() => { const d = this.drag(); return d && d.moved && d.kind === 'single' && d.src === 'board' ? d.from! : null; });

  /** Todos los escudos que afectan a la luz (sin contar lo que se está arrastrando). */
  readonly cellsMap = computed(() => {
    const m = new Map(this.placed());
    for (const [k, v] of this.pieceMap()) m.set(k, v.t);
    const lp = this.liftedPiece(), ls = this.liftedSingle();
    if (lp >= 0) E.placedCells(this.pieces()[lp], this.pp()[lp]!).forEach(a => m.delete(E.key(a.r, a.c)));
    if (ls) m.delete(ls);
    return m;
  });

  readonly sim = computed(() => { const L = this.level(); return L ? E.simulate(L, this.cellsMap()) : []; });
  readonly okCount = computed(() => this.sim().filter(x => x.ok).length);

  remaining(t: ShieldType): number {
    let n = this.level()?.inv[t] || 0;
    for (const v of this.placed().values()) if (v === t) n--;
    return n;
  }
  freeForSingle(k: string): boolean {
    return !!this.info()?.placeable.has(k) && !this.pieceMap().has(k);
  }
  /** ¿Entra la pieza pi con giro k y origen (r,c)? (ignora su propia posición actual) */
  pieceFits(pi: number, k: number, r: number, c: number): boolean {
    const L = this.level()!, I = this.info()!, pm = this.pieceMap(), placed = this.placed();
    return E.pieceCells(this.pieces()[pi], k).every(x => {
      const rr = x.dr + r, cc = x.dc + c, kk = E.key(rr, cc);
      if (rr < 0 || cc < 0 || rr >= L.rows || cc >= L.cols) return false;
      if (I.blocked.has(kk) || I.fixed.has(kk) || I.projectors.has(kk) || placed.has(kk)) return false;
      const o = pm.get(kk);
      return !o || o.pi === pi;
    });
  }

  // ================= CARGA =================
  startLevel(i: number): void {
    const lv = LEVELS[i];
    if (!lv) return;
    this.levelIndex.set(i);
    this.band.set(null);
    this.custom.set(false);
    const nP = (lv.pieces || []).length, nS = Object.values(lv.inv || {}).reduce((a, b) => a + b, 0);
    this.load(lv, `Nivel ${i + 1}`, lv.name || `${lv.rays.length} rayos · ${nS + nP} ${nP ? 'piezas y escudos' : 'escudos'}`);
  }

  /** Juega un nivel armado en el diseñador (o importado). */
  startCustom(lv: Level): void {
    this.levelIndex.set(-1);
    this.band.set(null);
    this.custom.set(true);
    this.load(lv, lv.name || 'Nivel propio', 'Probando el diseño');
  }

  startRandom(band: string): void {
    this.levelIndex.set(-1);
    this.band.set(band);
    this.custom.set(false);
    this.level.set(null);
    this.generating.set(true);
    this.setStatus('Generando nivel…');
    setTimeout(() => {
      let lv: Level | null = null;
      const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
      for (let k = 0; k < 8 && !lv; k++) {
        lv = band === 'combo'
          ? E.generateCombo({ ...E.BANDS['combo'], attempts: 300 }, seed + k * 7919)
          : E.generate({ ...E.BANDS[band], attempts: 400, maxNodes: 80000 }, seed + k * 7919);
      }
      this.generating.set(false);
      if (!lv) { this.setStatus('No pude generar el nivel, probá de nuevo.', 'bad'); return; }
      lv.group = 'Aleatorio';
      const names: Record<string, string> = { easy: 'Fácil', mid: 'Media', hard: 'Difícil', combo: 'Con piezas' };
      this.load(lv, 'Aleatorio', `${names[band]} · ${lv.rays.length} rayos`);
    }, 30);
  }

  private load(lv: Level, title: string, subtitle: string): void {
    clearTimeout(this.winTimer);
    this.level.set(lv);
    this.title.set(title);
    this.subtitle.set(subtitle);
    this.placed.set(new Map());
    const n = (lv.pieces || []).length;
    this.pp.set(new Array(n).fill(null));
    this.pRot.set(new Array(n).fill(0));
    this.porder = new Array(n).fill(0);
    this.order.clear();
    this.undoStack = [];
    this.canUndo.set(false);
    this.hints.set(0);
    this.won.set(false);
    this.showVictory.set(false);
    this.selection.set(null);
    this.drag.set(null);
    this.startTime = Date.now();
    this.okPrev = this.sim().map(x => x.ok);
    this.setStatus(n ? 'Arrastrá las piezas a los rayos. Con ↻ las girás antes de ponerlas.' : 'Arrastrá un escudo de la bandeja a un rayo.');
  }

  setStatus(text: string, kind: StatusKind = ''): void { this.status.set({ text, kind }); }

  // ================= ACCIONES =================
  private snapshot(): void {
    this.undoStack.push({ placed: new Map(this.placed()), pp: this.pp().map(p => p && { ...p }) });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.canUndo.set(true);
  }

  placeSingle(k: string, t: ShieldType, fromK: string | null = null): boolean {
    if (this.won()) return false;
    const I = this.info()!;
    if (!this.freeForSingle(k)) {
      this.sound.bad();
      this.setStatus(I.blocked.has(k) ? 'Esa celda no acepta escudos.' : I.fixed.has(k) ? 'Ahí ya hay un escudo fijo.'
        : this.pieceMap().has(k) ? 'Ahí hay una pieza.' : 'Los escudos sueltos van solo sobre los rayos.', 'bad');
      return false;
    }
    if (fromK === null && this.remaining(t) <= 0 && this.placed().get(k) !== t) { this.sound.bad(); return false; }
    this.snapshot();
    const m = new Map(this.placed());
    if (fromK !== null) m.delete(fromK);
    m.set(k, t);
    this.placed.set(m);
    this.order.set(k, ++this.stamp);
    this.sound.place(t);
    this.afterChange(I.isCross(k));
    return true;
  }

  placePiece(pi: number, k: number, r: number, c: number): boolean {
    if (this.won()) return false;
    if (!this.pieceFits(pi, k, r, c)) {
      this.sound.bad();
      this.setStatus('La pieza no entra ahí: choca con algo o se sale del tablero.', 'bad');
      return false;
    }
    this.snapshot();
    this.pp.update(a => a.map((p, i) => (i === pi ? { k, r, c } : p)));
    this.pRot.update(a => a.map((x, i) => (i === pi ? k : x)));
    this.porder[pi] = ++this.stamp;
    this.sound.place('-');
    const I = this.info()!;
    this.afterChange(E.placedCells(this.pieces()[pi], { k, r, c }).some(a => I.isCross(E.key(a.r, a.c))));
    return true;
  }

  removeSingle(k: string): void {
    if (this.won() || !this.placed().has(k)) return;
    this.snapshot();
    const m = new Map(this.placed()); m.delete(k);
    this.placed.set(m);
    this.sound.remove();
    this.afterChange(false);
    this.setStatus('Escudo devuelto a la bandeja.');
  }

  removePiece(pi: number): void {
    if (this.won() || !this.pp()[pi]) return;
    this.snapshot();
    this.pp.update(a => a.map((p, i) => (i === pi ? null : p)));
    this.sound.remove();
    this.afterChange(false);
    this.setStatus('Pieza devuelta a la bandeja.');
  }

  rotateTray(pi: number): void {
    if (this.won() || this.pieces()[pi]?.norotate) return;
    this.pRot.update(a => a.map((x, i) => (i === pi ? (x + 1) % 4 : x)));
    this.sound.rotate();
  }

  undo(): void {
    if (this.won() || !this.undoStack.length) return;
    const u = this.undoStack.pop()!;
    this.placed.set(u.placed);
    this.pp.set(u.pp);
    this.canUndo.set(this.undoStack.length > 0);
    this.sound.remove();
    this.afterChange(false);
    this.setStatus('Deshecho.');
  }

  reset(): void {
    if (this.won() || (!this.placed().size && !this.pp().some(Boolean))) return;
    this.snapshot();
    this.placed.set(new Map());
    this.pp.update(a => a.map(() => null));
    this.selection.set(null);
    this.sound.remove();
    this.afterChange(false);
    this.setStatus('Todo de vuelta en la bandeja.');
  }

  /** Después de cada cambio: sonidos de sensores que se encienden o apagan, mensaje y victoria. */
  private afterChange(crossing: boolean): void {
    const sim = this.sim();
    const newly: number[] = [];
    sim.forEach((rs, i) => {
      if (rs.ok && !this.okPrev[i]) { newly.push(i); setTimeout(() => this.sound.sensorOn(i), 80); }
      else if (!rs.ok && this.okPrev[i]) this.sound.sensorOff();
    });
    this.okPrev = sim.map(x => x.ok);
    if (newly.length) { this.pings.set(newly); setTimeout(() => this.pings.set([]), 900); }
    const okN = this.okCount();
    if (crossing) this.setStatus(`Hay un escudo en un cruce: afecta a dos rayos. Sensores listos: ${okN}/${sim.length}.`);
    else this.setStatus(`Sensores listos: ${okN}/${sim.length}.`, okN === sim.length ? 'ok' : '');
    this.checkWin();
  }

  private checkWin(): void {
    if (this.won() || !this.sim().length || !this.sim().every(x => x.ok)) return;
    this.won.set(true);
    this.selection.set(null);
    const timeMs = Date.now() - this.startTime, hints = this.hints();
    const stars = hints === 0 ? 3 : hints <= 2 ? 2 : 1;
    this.lastResult.set({ stars, timeMs, hints });
    if (this.levelIndex() >= 0) void this.progress.record('n' + this.levelIndex(), { stars, timeMs, hints });
    this.setStatus('¡Todos los sensores encendidos!', 'ok');
    setTimeout(() => { this.sound.win(); this.confetti.burst(); }, 350);
    this.winTimer = setTimeout(() => this.showVictory.set(true), 1400);
  }

  // ================= PISTA =================
  /** Busca una solución que respete lo que el jugador ya puso. */
  private solveKeeping(keepSingles: Map<string, ShieldType>, keepPieces: number[]) {
    const L = this.level()!;
    const extra = [];
    for (const [k, t] of keepSingles) { const [r, c] = E.toRC(k); extra.push({ r, c, t }); }
    keepPieces.forEach(pi => extra.push(...E.placedCells(this.pieces()[pi], this.pp()[pi]!)));
    const L2: Level = { ...L, fixed: [...(L.fixed || []), ...extra] };
    const inv2: Record<string, number> = { ...L.inv };
    for (const t of keepSingles.values()) inv2[t] = (inv2[t] || 0) - 1;
    const rest = this.pieces().map((_, i) => i).filter(i => !keepPieces.includes(i));
    const res = E.solveFull(L2, inv2, rest.map(i => this.pieces()[i]), { maxLeaves: 3000, maxNodes: 50000 });
    return res.found ? { found: res.found, rest } : null;
  }

  private label(t: ShieldType): string {
    const n: Record<string, string> = { R: 'rojo', G: 'verde', B: 'azul' };
    return t[0] === '-' ? `el escudo que quita ${n[t[1]]} (−${t[1]})` : `el escudo que suma ${n[t[1]]} (+${t[1]})`;
  }

  hint(): void {
    if (this.won() || !this.level()) return;
    this.hints.update(h => h + 1);
    const I = this.info()!;
    const placedPieces = this.pp().map((p, i) => (p ? i : -1)).filter(i => i >= 0);
    const all = this.solveKeeping(this.placed(), placedPieces);
    if (all) {
      const { found, rest } = all;
      const j = found.pieces.findIndex(p => p);
      if (j >= 0) {
        const pi = rest[j], p = found.pieces[j]!;
        this.snapshot();
        this.pp.update(a => a.map((x, i) => (i === pi ? { ...p } : x)));
        this.pRot.update(a => a.map((x, i) => (i === pi ? p.k : x)));
        this.porder[pi] = ++this.stamp;
        this.flash(E.placedCells(this.pieces()[pi], p).map(a => E.key(a.r, a.c)), false);
        this.sound.hint();
        this.afterChange(false);
        if (!this.won()) this.setStatus('Pista: esa pieza va ahí.', 'hint');
        return;
      }
      const singles = E.concreteSingles(found.L2, found.single).filter(x => !this.placed().has(E.key(x.r, x.c)));
      singles.sort((a, b) => Number(I.isCross(E.key(b.r, b.c))) - Number(I.isCross(E.key(a.r, a.c))));
      if (singles.length) {
        const x = singles[0], k = E.key(x.r, x.c);
        this.snapshot();
        const m = new Map(this.placed()); m.set(k, x.t);
        this.placed.set(m);
        this.order.set(k, ++this.stamp);
        this.flash([k], false);
        this.sound.hint();
        this.afterChange(false);
        if (!this.won()) this.setStatus(`Pista: ${this.label(x.t)} va ${I.isCross(k) ? 'en ese cruce' : 'ahí'}.`, 'hint');
        return;
      }
      this.setStatus('Ya está casi: revisá los sensores.', 'hint');
      this.checkWin();
      return;
    }
    // algo de lo puesto sobra: probar sacando una cosa por vez, de la más reciente a la más vieja
    type Item = { kind: 's'; k: string; stamp: number } | { kind: 'p'; pi: number; stamp: number };
    const items: Item[] = [
      ...[...this.placed().keys()].map(k => ({ kind: 's' as const, k, stamp: this.order.get(k) || 0 })),
      ...placedPieces.map(pi => ({ kind: 'p' as const, pi, stamp: this.porder[pi] || 0 }))
    ].sort((a, b) => b.stamp - a.stamp);
    const bad = items.find(it => {
      const ks = new Map(this.placed()), kp = placedPieces.slice();
      if (it.kind === 's') ks.delete(it.k); else kp.splice(kp.indexOf(it.pi), 1);
      return !!this.solveKeeping(ks, kp);
    }) || items[0];
    if (!bad) return;
    this.snapshot();
    if (bad.kind === 's') {
      this.flash([bad.k], true);
      const m = new Map(this.placed()); m.delete(bad.k); this.placed.set(m);
    } else {
      this.flash(E.placedCells(this.pieces()[bad.pi], this.pp()[bad.pi]!).map(a => E.key(a.r, a.c)), true);
      this.pp.update(a => a.map((x, i) => (i === bad.pi ? null : x)));
    }
    this.sound.bad();
    this.afterChange(false);
    this.setStatus(`Pista: ${bad.kind === 's' ? 'ese escudo' : 'esa pieza'} no iba ahí. Lo devolví a la bandeja.`, 'hint');
  }

  private flash(keys: string[], wrong: boolean): void {
    (wrong ? this.wrongKeys : this.flashKeys).set(keys);
    setTimeout(() => (wrong ? this.wrongKeys : this.flashKeys).set([]), 900);
  }

  /** Para pruebas: aplica la solución guardada del nivel. */
  applyStoredSolution(): void {
    const L = this.level();
    if (!L) return;
    const m = new Map<string, ShieldType>();
    (L.sol || []).forEach(s => m.set(E.key(s.r, s.c), s.t));
    this.placed.set(m);
    this.pp.set((L.solP || []).map(p => p && { ...p }));
    this.afterChange(false);
  }
}
