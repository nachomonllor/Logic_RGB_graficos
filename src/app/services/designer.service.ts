import { Injectable, computed, effect, inject, signal } from '@angular/core';
import * as E from '../core/engine';
import { LEVELS } from '../core/levels';
import { Dir, FixedShield, Level, Piece, PiecePlacement, Ray } from '../core/models';
import { SoundService } from './sound.service';

export type Tool = 'glass' | 'link' | 'lock' | 'block' | 'projector' | 'erase';

/** Proyector de luz blanca: posición (dentro del tablero o en el borde) y dirección. */
export interface Emitter { r: number; c: number; dir: Dir; target?: number; }

/** Estado del diseño. Es un objeto simple para poder guardarlo, deshacer y exportarlo fácil. */
export interface DesignState {
  name: string;
  rows: number;
  cols: number;
  /** Vidrios puestos: celda "r,c" -> tipo ('' = transparente, '-R', '+G', ...). */
  glass: Record<string, string>;
  /** Conectores entre vidrios vecinos: "r1,c1|r2,c2" (ordenados). */
  links: string[];
  /** Vidrios con candado (el jugador no los puede sacar). */
  locked: string[];
  /** Casilleros donde no se puede apoyar nada. */
  blocked: string[];
  emitters: Emitter[];
  /** Si las piezas del jugador se pueden girar. */
  rotatable: boolean;
  /** Entregar las piezas giradas al azar en la bandeja. */
  shuffle: boolean;
}

export interface VerifyResult {
  kind: 'unique' | 'multiple' | 'none' | 'partial' | 'mismatch';
  text: string;
  extra: string[];
}

const DRAFT_KEY = 'espectro-designer-draft';
const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const NEIGHBORS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function blank(rows = 7, cols = 7): DesignState {
  return { name: 'Mi nivel', rows, cols, glass: {}, links: [], locked: [], blocked: [], emitters: [], rotatable: true, shuffle: true };
}

/** Diseñador de niveles: herramientas, vista en vivo, verificación con el solver y exportación a JSON. */
@Injectable({ providedIn: 'root' })
export class DesignerService {
  private sound = inject(SoundService);

  readonly state = signal<DesignState>(this.loadDraft());
  readonly tool = signal<Tool>('glass');
  readonly glassType = signal('');
  readonly projectorDir = signal<Dir>('E');
  readonly status = signal('Elegí una herramienta y tocá el tablero.');
  readonly verifying = signal(false);
  readonly verifyResult = signal<VerifyResult | null>(null);
  /** Solución alternativa encontrada por el solver, para mostrarla sobre el tablero. */
  readonly altView = signal<{ glass: Record<string, string>; links: string[] } | null>(null);
  readonly canUndo = signal(false);
  /** Último nivel exportado para probar en el juego. */
  testLevel: Level | null = null;
  private undoStack: DesignState[] = [];
  private pendingAlt: { glass: Record<string, string>; links: string[] } | null = null;

  constructor() {
    effect(() => {
      const st = this.state();
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(st)); } catch { /* sin almacenamiento */ }
    });
  }

  private loadDraft(): DesignState {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) return { ...blank(), ...JSON.parse(raw) };
    } catch { /* borrador inválido */ }
    return blank();
  }

  // ================= DERIVADOS =================

  /** Piezas = grupos de vidrios unidos por conectores. */
  readonly components = computed(() => {
    const st = this.state();
    const keys = Object.keys(st.glass);
    const parent = new Map(keys.map(k => [k, k]));
    const find = (k: string): string => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k)!)!); k = parent.get(k)!; } return k; };
    for (const l of st.links) {
      const [a, b] = l.split('|');
      if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
    }
    const groups = new Map<string, string[]>();
    for (const k of keys) { const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(k); }
    const locked = new Set(st.locked);
    return [...groups.values()].map((keys, id) => ({
      id, keys: keys.sort((a, b) => { const [ar, ac] = E.toRC(a), [br, bc] = E.toRC(b); return ar - br || ac - bc; }),
      locked: keys.some(k => locked.has(k))
    }));
  });

  /** Nivel "crudo" para simular lo que se ve en el diseñador. */
  readonly preview = computed<Level>(() => {
    const st = this.state();
    return {
      v: 2, rows: st.rows, cols: st.cols, inv: {},
      rays: st.emitters.map(e => ({ er: e.r, ec: e.c, dir: e.dir, target: e.target ?? -1 })),
      blocked: st.blocked.map(E.toRC), fixed: []
    };
  });
  readonly info = computed(() => E.info(this.preview()));

  /** Lo que se dibuja: el diseño o la solución alternativa del solver. */
  readonly display = computed(() => {
    const alt = this.altView(), st = this.state();
    return alt ? { glass: alt.glass, links: alt.links, alt: true } : { glass: st.glass, links: st.links, alt: false };
  });
  readonly sim = computed(() => E.simulate(this.preview(), new Map(Object.entries(this.display().glass))));

  readonly summary = computed(() => {
    const comps = this.components();
    return {
      glasses: Object.keys(this.state().glass).length,
      locked: comps.filter(c => c.locked).length,
      tray: comps.filter(c => !c.locked).length
    };
  });

  // ================= EDICIÓN =================

  private snapshot(): void {
    this.undoStack.push(structuredClone(this.state()));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.canUndo.set(true);
  }
  private change(fn: (st: DesignState) => void): void {
    const st = structuredClone(this.state());
    fn(st);
    this.state.set(st);
    this.altView.set(null);
    this.verifyResult.set(null);
  }
  /** Llamar al empezar un gesto (un clic o un arrastre que pinta): guarda un punto para deshacer. */
  beginGesture(): void { this.snapshot(); }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.state.set(prev);
    this.canUndo.set(this.undoStack.length > 0);
    this.altView.set(null);
    this.verifyResult.set(null);
    this.sound.remove();
    this.status.set('Deshecho.');
  }

  private inside(r: number, c: number): boolean {
    const st = this.state();
    return r >= 0 && c >= 0 && r < st.rows && c < st.cols;
  }
  private isEmitterAt(st: DesignState, r: number, c: number): number {
    return st.emitters.findIndex(e => e.r === r && e.c === c);
  }

  /**
   * Aplica la herramienta activa sobre una posición. (r,c) puede estar en el margen (para proyectores de borde).
   * side = lado más cercano dentro de la celda (para el conector). paint = valor a pintar al arrastrar.
   */
  apply(r: number, c: number, side: Dir | null, paint?: boolean): boolean | undefined {
    const tool = this.tool(), st = this.state(), k = E.key(r, c), inB = this.inside(r, c);
    if (tool === 'projector') return this.applyProjector(r, c);
    if (!inB) { this.status.set('Afuera del tablero solo van proyectores.'); return; }
    const hasGlass = k in st.glass, isBlocked = st.blocked.includes(k), emitter = this.isEmitterAt(st, r, c) >= 0;

    switch (tool) {
      case 'glass': {
        if (isBlocked) { this.bad('Ese casillero está bloqueado.'); return; }
        if (emitter) { this.bad('Ahí hay un proyector.'); return; }
        if (hasGlass && st.glass[k] === this.glassType()) return;
        this.change(s => { s.glass[k] = this.glassType(); });
        this.sound.place(this.glassType() || '+');
        this.status.set(hasGlass ? 'Vidrio cambiado.' : 'Vidrio puesto.');
        return;
      }
      case 'link': {
        if (!hasGlass) { this.bad('Tocá un vidrio, cerca del lado que querés conectar.'); return; }
        if (!side) { this.status.set('Tocá más cerca del lado que querés conectar (norte, sur, este u oeste).'); return; }
        const [dr, dc] = E.DIRV[side], k2 = E.key(r + dr, c + dc);
        if (!(k2 in st.glass)) { this.bad('Del otro lado no hay vidrio. Poné uno (puede ser transparente) y conectalos.'); return; }
        const lk = linkKey(k, k2), on = st.links.includes(lk);
        this.change(s => { s.links = on ? s.links.filter(x => x !== lk) : [...s.links, lk]; });
        this.sound.rotate();
        this.status.set(on ? 'Conector quitado.' : 'Vidrios conectados: ahora son una sola pieza.');
        return;
      }
      case 'lock': {
        if (!hasGlass) { this.bad('Tocá un vidrio para ponerle o sacarle el candado.'); return; }
        const comp = this.components().find(cp => cp.keys.includes(k))!;
        const lock = !comp.locked;
        this.change(s => {
          const set = new Set(s.locked);
          comp.keys.forEach(x => (lock ? set.add(x) : set.delete(x)));
          s.locked = [...set];
        });
        this.sound.ui();
        this.status.set(lock ? 'Pieza con candado: queda fija y el jugador no la puede mover.' : 'Candado quitado: la pieza va a la bandeja del jugador.');
        return;
      }
      case 'block': {
        if (hasGlass || emitter) { this.bad('Primero sacá lo que hay en ese casillero.'); return; }
        const val = paint ?? !isBlocked;
        if (val === isBlocked) return val;
        this.change(s => { s.blocked = val ? [...s.blocked, k] : s.blocked.filter(x => x !== k); });
        this.sound.ui();
        this.status.set(val ? 'Casillero bloqueado: no admite vidrios ni conectores.' : 'Casillero libre.');
        return val;
      }
      case 'erase': {
        const ei = this.isEmitterAt(st, r, c);
        if (hasGlass) {
          this.change(s => {
            delete s.glass[k];
            s.links = s.links.filter(l => !l.split('|').includes(k));
            s.locked = s.locked.filter(x => x !== k);
          });
        } else if (ei >= 0) this.change(s => { s.emitters.splice(ei, 1); });
        else if (isBlocked) this.change(s => { s.blocked = s.blocked.filter(x => x !== k); });
        else return;
        this.sound.remove();
        this.status.set('Borrado.');
        return;
      }
    }
    return;
  }

  private applyProjector(r: number, c: number): undefined {
    const st = this.state(), k = E.key(r, c), rows = st.rows, cols = st.cols;
    const ei = this.isEmitterAt(st, r, c);
    const inB = this.inside(r, c);
    const border = !inB && ((r >= 0 && r < rows && (c === -1 || c === cols)) || (c >= 0 && c < cols && (r === -1 || r === rows)));
    if (!inB && !border) { this.status.set('Los proyectores van en el borde o adentro del tablero (no en las esquinas).'); return; }
    if (inB && (k in st.glass || st.blocked.includes(k))) { this.bad('Ese casillero está ocupado.'); return; }
    if (ei >= 0) {
      if (border) {
        this.change(s => { s.emitters.splice(ei, 1); });
        this.sound.remove();
        this.status.set('Proyector quitado.');
      } else {
        const order: Dir[] = ['N', 'E', 'S', 'W'];
        const next = order[(order.indexOf(st.emitters[ei].dir) + 1) % 4];
        this.change(s => { s.emitters[ei] = { ...s.emitters[ei], dir: next, target: undefined }; });
        this.sound.rotate();
        this.status.set('Proyector girado. Tocalo de nuevo para seguir girándolo; con Borrar lo sacás.');
      }
      return;
    }
    const dir: Dir = border ? (c === -1 ? 'E' : c === cols ? 'W' : r === -1 ? 'S' : 'N') : this.projectorDir();
    this.change(s => { s.emitters.push({ r, c, dir }); });
    this.sound.place('+');
    this.status.set(border ? 'Proyector en el borde. Tocalo de nuevo para sacarlo.' : 'Proyector adentro del tablero: frena los rayos que le llegan.');
    return;
  }

  private bad(msg: string): void { this.sound.bad(); this.status.set(msg); }

  setSize(rows: number, cols: number): void {
    rows = Math.max(3, Math.min(20, Math.round(rows) || 3));
    cols = Math.max(3, Math.min(20, Math.round(cols) || 3));
    this.snapshot();
    this.change(s => {
      const ok = (k: string) => { const [r, c] = E.toRC(k); return r < rows && c < cols; };
      s.rows = rows; s.cols = cols;
      for (const k of Object.keys(s.glass)) if (!ok(k)) delete s.glass[k];
      s.links = s.links.filter(l => l.split('|').every(ok));
      s.locked = s.locked.filter(ok);
      s.blocked = s.blocked.filter(ok);
      // proyectores: los del borde derecho e inferior se mueven al nuevo borde; los que quedan afuera se descartan
      const oldR = this.state().rows, oldC = this.state().cols;
      s.emitters = s.emitters
        .map(e => (e.c === oldC ? { ...e, c: cols } : e.r === oldR ? { ...e, r: rows } : e))
        .filter(e => {
          const inB = e.r >= 0 && e.c >= 0 && e.r < rows && e.c < cols;
          if (inB) return true;
          const want: Dir | null = e.c === -1 && e.r >= 0 && e.r < rows ? 'E' : e.c === cols && e.r >= 0 && e.r < rows ? 'W'
            : e.r === -1 && e.c >= 0 && e.c < cols ? 'S' : e.r === rows && e.c >= 0 && e.c < cols ? 'N' : null;
          return want === e.dir;
        });
    });
    this.status.set(`Tablero de ${rows} × ${cols}.`);
  }

  setName(name: string): void { this.state.update(s => ({ ...s, name })); }
  setOption(opt: 'rotatable' | 'shuffle', val: boolean): void { this.state.update(s => ({ ...s, [opt]: val })); }

  /** Toma como objetivo el color que hoy le llega a cada sensor. */
  takeTargets(): void {
    if (!this.state().emitters.length) { this.bad('Primero poné al menos un proyector.'); return; }
    this.snapshot();
    const sim = E.simulate(this.preview(), new Map(Object.entries(this.state().glass)));
    this.change(s => { s.emitters = s.emitters.map((e, i) => ({ ...e, target: sim[i].final })); });
    this.sound.sensorOn(0);
    this.status.set('Listo: cada sensor ahora pide el color que le llega con tu diseño.');
  }

  newDesign(): void {
    this.snapshot();
    const st = this.state();
    this.state.set(blank(st.rows, st.cols));
    this.altView.set(null);
    this.verifyResult.set(null);
    this.status.set('Diseño nuevo.');
  }

  // ================= EXPORTAR / IMPORTAR =================

  /** Convierte el diseño en un nivel jugable: lo que tiene candado queda fijo, el resto va a la bandeja. */
  exportLevel(): Level {
    const st = this.state();
    const sim = E.simulate(this.preview(), new Map(Object.entries(st.glass)));
    const rays: Ray[] = st.emitters.map((e, i) => ({ er: e.r, ec: e.c, dir: e.dir, target: e.target ?? sim[i].final }));
    const fixed: FixedShield[] = [], fixedLinks: [number, number, number, number][] = [];
    const inv: Record<string, number> = {}, sol: FixedShield[] = [], pieces: Piece[] = [], solP: PiecePlacement[] = [];
    let g = 0;
    const rnd = Math.random;
    for (const comp of this.components()) {
      const cells = comp.keys.map(k => { const [r, c] = E.toRC(k); return { r, c, t: st.glass[k] }; });
      const inner = st.links.filter(l => l.split('|').every(k => comp.keys.includes(k)));
      if (comp.locked) {
        const gid = cells.length > 1 ? ++g : undefined;
        cells.forEach(x => fixed.push(gid ? { ...x, g: gid } : x));
        inner.forEach(l => { const [a, b] = l.split('|').map(E.toRC); fixedLinks.push([a[0], a[1], b[0], b[1]]); });
        continue;
      }
      if (cells.length === 1 && cells[0].t) {
        inv[cells[0].t] = (inv[cells[0].t] || 0) + 1;
        sol.push(cells[0]);
        continue;
      }
      const r0 = Math.min(...cells.map(x => x.r)), c0 = Math.min(...cells.map(x => x.c));
      let piece: Piece = {
        cells: cells.map(x => ({ dr: x.r - r0, dc: x.c - c0, t: x.t })),
        links: inner.map(l => l.split('|').map(k => comp.keys.indexOf(k)) as [number, number])
      };
      let k = 0;
      if (!st.rotatable) piece.norotate = true;
      else if (st.shuffle) {
        const k0 = Math.floor(rnd() * 4);
        piece = { ...piece, cells: E.pieceCells(piece, k0) };
        k = (4 - k0) % 4;
      }
      pieces.push(piece);
      solP.push({ k, r: r0, c: c0 });
    }
    return {
      v: 2, name: st.name || 'Nivel propio', group: 'Propio', rows: st.rows, cols: st.cols, rays,
      blocked: st.blocked.map(E.toRC), fixed, fixedLinks, inv, pieces, sol, solP
    };
  }

  /** Abre un nivel (exportado o del juego) para seguir editándolo. */
  importLevel(L: Level): void {
    const glass: Record<string, string> = {}, links = new Set<string>(), locked: string[] = [];
    const addAdjacent = (cells: { r: number; c: number }[]) => {
      for (const a of cells) for (const b of cells) {
        if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1) links.add(linkKey(E.key(a.r, a.c), E.key(b.r, b.c)));
      }
    };
    for (const f of L.fixed || []) { const k = E.key(f.r, f.c); glass[k] = f.t; locked.push(k); }
    if (L.fixedLinks) L.fixedLinks.forEach(([a, b, c, d]) => links.add(linkKey(E.key(a, b), E.key(c, d))));
    else {
      const groups = new Map<number, { r: number; c: number }[]>();
      (L.fixed || []).forEach(f => { if (f.g) { if (!groups.has(f.g)) groups.set(f.g, []); groups.get(f.g)!.push(f); } });
      groups.forEach(addAdjacent);
    }
    (L.sol || []).forEach(s => { glass[E.key(s.r, s.c)] = s.t; });
    (L.pieces || []).forEach((p, i) => {
      const pl = L.solP?.[i];
      if (!pl) return;
      const abs = E.placedCells(p, pl);
      abs.forEach(a => { glass[E.key(a.r, a.c)] = a.t; });
      if (p.links) p.links.forEach(([x, y]) => links.add(linkKey(E.key(abs[x].r, abs[x].c), E.key(abs[y].r, abs[y].c))));
      else addAdjacent(abs);
    });
    const emitters: Emitter[] = L.rays.map(ray => {
      const [r, c] = E.rayOrigin(L, ray), [dr, dc] = E.rayDir(ray);
      const dir: Dir = dr === -1 ? 'N' : dr === 1 ? 'S' : dc === 1 ? 'E' : 'W';
      return { r, c, dir, target: ray.target };
    });
    this.snapshot();
    this.state.set({
      name: L.name || 'Nivel importado', rows: L.rows, cols: L.cols, glass, links: [...links], locked,
      blocked: (L.blocked || []).map(([r, c]) => E.key(r, c)), emitters,
      rotatable: !(L.pieces || []).some(p => p.norotate), shuffle: true
    });
    this.altView.set(null);
    this.verifyResult.set(null);
    this.status.set(`Abriste "${L.name || 'nivel'}". Lo que tenía candado sigue fijo; el resto es la solución.`);
  }

  importBuiltIn(i: number): void {
    const L = LEVELS[i];
    if (L) this.importLevel({ ...structuredClone(L), name: L.name || `Nivel ${i + 1}` });
  }

  importJson(text: string): boolean {
    try {
      const L = JSON.parse(text) as Level;
      if (!L || !L.rows || !L.cols || !Array.isArray(L.rays)) throw new Error('formato');
      this.importLevel(L);
      return true;
    } catch {
      this.bad('Ese archivo no es un nivel de Espectro.');
      return false;
    }
  }

  exportJson(): string { return JSON.stringify(this.exportLevel(), null, 2); }

  // ================= VERIFICACIÓN =================

  /** Busca si hay más de una forma de resolver el nivel con la bandeja del jugador y si sobra algo. */
  verify(): void {
    if (!this.state().emitters.length) { this.bad('Poné al menos un proyector.'); return; }
    this.verifying.set(true);
    this.verifyResult.set(null);
    this.altView.set(null);
    setTimeout(() => {
      this.verifyResult.set(this.runVerify());
      this.verifying.set(false);
    }, 30);
  }

  private runVerify(): VerifyResult {
    const st = this.state();
    if (st.emitters.some(e => e.target === undefined)) {
      return { kind: 'mismatch', text: 'Hay sensores sin objetivo. Tocá "Tomar colores actuales como objetivo".', extra: [] };
    }
    const L = this.exportLevel();
    const now = E.simulate(L, new Map([...(L.sol || []).map(s => [E.key(s.r, s.c), s.t] as [string, string]),
      ...(L.pieces || []).flatMap((p, i) => E.placedCells(p, L.solP![i]!).map(a => [E.key(a.r, a.c), a.t] as [string, string]))]));
    if (!now.every(x => x.ok)) {
      return { kind: 'mismatch', text: 'Tu diseño ya no da los colores objetivo. Si lo cambiaste a propósito, volvé a tomar los colores.', extra: [] };
    }
    const pieces = L.pieces || [];
    const opts = { maxLeaves: 20000, maxNodes: 80000 };
    const res = E.solveFull(L, L.inv, pieces, { ...opts, limit: 2 });
    const extra: string[] = [];
    const nItems = pieces.length + Object.values(L.inv).reduce((a, b) => a + b, 0);
    if (!nItems) extra.push('La bandeja del jugador está vacía: sacale el candado a alguna pieza.');
    // ¿sobra algo de la bandeja?
    if (res.sols.length && nItems && nItems <= 12) {
      for (const t of E.TYPES) {
        if (!L.inv[t]) continue;
        const r = E.solveFull(L, { ...L.inv, [t]: L.inv[t] - 1 }, pieces, { ...opts, limit: 1 });
        if (r.found) extra.push(`El escudo suelto ${t} no hace falta: se puede ganar sin él.`);
      }
      pieces.forEach((_, i) => {
        const r = E.solveFull(L, L.inv, pieces.filter((__, j) => j !== i), { ...opts, limit: 1 });
        if (r.found) extra.push(`La pieza ${i + 1} de la bandeja no hace falta: se puede ganar sin ella.`);
      });
    }
    if (res.sols.length >= 2) {
      const alt = res.sols[1];
      const glass: Record<string, string> = {};
      const links: string[] = [];
      for (const f of L.fixed) glass[E.key(f.r, f.c)] = f.t;
      (L.fixedLinks || []).forEach(([a, b, c, d]) => links.push(linkKey(E.key(a, b), E.key(c, d))));
      alt.pieces.forEach((p, i) => {
        if (!p) return;
        const abs = E.placedCells(pieces[i], p);
        abs.forEach(a => { glass[E.key(a.r, a.c)] = a.t; });
        (pieces[i].links || []).forEach(([x, y]) => links.push(linkKey(E.key(abs[x].r, abs[x].c), E.key(abs[y].r, abs[y].c))));
      });
      E.concreteSingles(alt.L2, alt.single).forEach(s => { glass[E.key(s.r, s.c)] = s.t; });
      this.pendingAlt = { glass, links };
      return { kind: 'multiple', text: 'Hay más de una solución. Mirá la otra y agregá algo (un bloqueo, un candado, un proyector) para que quede una sola.', extra };
    }
    if (res.aborted) {
      return { kind: 'partial', text: `No pude revisar todas las combinaciones (el nivel es grande). Hasta donde llegué: ${res.sols.length ? 'una sola solución' : 'ninguna solución'}.`, extra };
    }
    if (!res.sols.length) return { kind: 'none', text: 'El solver no encontró solución con la bandeja. Revisá los candados.', extra };
    return { kind: 'unique', text: '¡Solución única! El nivel está listo.', extra };
  }

  toggleAlt(): void {
    if (this.altView()) { this.altView.set(null); this.status.set('Volviste a tu diseño.'); return; }
    if (this.pendingAlt) { this.altView.set(this.pendingAlt); this.status.set('Mostrando otra solución que encontró el solver.'); }
  }
}
