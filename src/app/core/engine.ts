import {
  Channel, Dir, FixedShield, FullSolution, Level, LightColor, Need, Piece, PieceCell, PiecePlacement,
  RayResult, Ray, ShieldType, SingleSolution
} from './models';

/** Motor del juego: luz, solver y generador. Sin dependencias de Angular. */

export const TYPES: ShieldType[] = ['-R', '-G', '-B', '+R', '+G', '+B'];
export const BIT: Record<Channel, number> = { R: 4, G: 2, B: 1 };

export const key = (r: number, c: number): string => r + ',' + c;
export const toRC = (k: string): [number, number] => k.split(',').map(Number) as [number, number];

/** Parte un escudo en efectos de a uno: '-R+G' -> ['-R', '+G']. */
export const parts = (t: ShieldType): string[] => t.match(/[+-][RGB]/g) || [];

/** Aplica un escudo (simple o doble) a un color luz. */
export const apply = (col: LightColor, t: ShieldType): LightColor =>
  parts(t).reduce((c, p) => (p[0] === '-' ? c & ~BIT[p[1] as Channel] : c | BIT[p[1] as Channel]), col);

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DIRV: Record<Dir, [number, number]> = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };

/** Dirección en que viaja la luz de un rayo: [dr, dc]. */
export function rayDir(ray: Ray): [number, number] {
  if (ray.dir) return DIRV[ray.dir];
  return ray.o === 'h' ? [0, ray.rev ? -1 : 1] : [ray.rev ? -1 : 1, 0];
}
/** Posición del proyector (puede estar afuera del tablero, en el borde). */
export function rayOrigin(L: Level, ray: Ray): [number, number] {
  if (ray.dir) return [ray.er!, ray.ec!];
  return ray.o === 'h' ? [ray.i!, ray.rev ? L.cols : -1] : [ray.rev ? L.rows : -1, ray.i!];
}
/** Posiciones de todos los proyectores del nivel. */
export function projectorSet(L: Level): Set<string> {
  return new Set(L.rays.map(ray => { const [r, c] = rayOrigin(L, ray); return key(r, c); }));
}
const inside = (L: Level, r: number, c: number) => r >= 0 && c >= 0 && r < L.rows && c < L.cols;

/**
 * Recorrido de un rayo: celdas que atraviesa, dónde termina y si lo frenó un proyector.
 * La luz avanza hasta salir del tablero o hasta chocar con otro proyector.
 */
export function rayPath(L: Level, ray: Ray, projectors = projectorSet(L)) {
  const [dr, dc] = rayDir(ray);
  let [r, c] = rayOrigin(L, ray);
  const cells: [number, number][] = [];
  let blocked = false;
  r += dr; c += dc;
  while (inside(L, r, c)) {
    if (projectors.has(key(r, c))) { blocked = true; break; }
    cells.push([r, c]);
    r += dr; c += dc;
  }
  if (!blocked && projectors.has(key(r, c))) blocked = true;
  return { cells, end: [r, c] as [number, number], blocked, dir: [dr, dc] as [number, number] };
}

/** Celdas que recorre un rayo, en el orden en que viaja la luz. */
export function rayCells(L: Level, ray: Ray, projectors?: Set<string>): [number, number][] {
  return rayPath(L, ray, projectors).cells;
}

export interface LevelInfo {
  /** Proyectores dentro del tablero (ocupan su casillero). */
  projectors: Set<string>;
  blocked: Set<string>;
  fixed: Map<string, ShieldType>;
  onRays: Map<string, number[]>;
  placeable: Set<string>;
  isCross: (k: string) => boolean;
}

/** Datos derivados del nivel: celdas bloqueadas, fijas, sobre qué rayos está cada una y cuáles aceptan escudo. */
export function info(L: Level): LevelInfo {
  const blocked = new Set((L.blocked || []).map(([r, c]) => key(r, c)));
  const fixed = new Map((L.fixed || []).map(f => [key(f.r, f.c), f.t] as [string, string]));
  const all = projectorSet(L);
  const projectors = new Set([...all].filter(k => { const [r, c] = toRC(k); return inside(L, r, c); }));
  const onRays = new Map<string, number[]>();
  L.rays.forEach((ray, ri) => rayCells(L, ray, all).forEach(([r, c]) => {
    const k = key(r, c);
    if (!onRays.has(k)) onRays.set(k, []);
    onRays.get(k)!.push(ri);
  }));
  const placeable = new Set([...onRays.keys()].filter(k => !blocked.has(k) && !fixed.has(k)));
  const isCross = (k: string) => (onRays.get(k) || []).length > 1;
  return { projectors, blocked, fixed, onRays, placeable, isCross };
}

/** Recorre cada rayo aplicando los escudos (fijos y del jugador) en el orden en que viaja la luz. */
export function simulate(L: Level, placed: Map<string, ShieldType>): RayResult[] {
  const I = info(L), proj = projectorSet(L);
  return L.rays.map(ray => {
    let col = 7;
    const segs = [];
    for (const [r, c] of rayCells(L, ray, proj)) {
      const k = key(r, c), t = I.fixed.get(k) || placed.get(k);
      const cin = col;
      if (t) col = apply(col, t);
      segs.push({ r, c, cin, cout: col, t });
    }
    return { final: col, segs, ok: col === ray.target };
  });
}

export interface SolveOptions { limit?: number; exact?: boolean; maxNodes?: number; }

/**
 * Solver de escudos sueltos. En cada rayo solo importa el ÚLTIMO escudo de cada canal,
 * así que se prueban las formas de ocupar los cruces y el resto de cada rayo queda forzado.
 */
export function solve(L: Level, inv: Record<string, number>, opts: SolveOptions = {}) {
  const limit = opts.limit || 2, exact = !!opts.exact, maxNodes = opts.maxNodes || 300000;
  const I = info(L);
  const crosses = [...I.placeable].filter(I.isCross).sort((a, b) => {
    const [ar, ac] = toRC(a), [br, bc] = toRC(b);
    return ar - br || ac - bc;
  });
  const proj = projectorSet(L);
  const rays = L.rays.map(ray => rayCells(L, ray, proj).map(([r, c]) => key(r, c)));
  const freePlain = rays.map(cells => cells.map((k, idx) => (I.placeable.has(k) && !I.isCross(k) ? idx : -1)).filter(x => x >= 0));
  const assign = new Map<string, ShieldType>();
  const left: Record<string, number> = { ...inv };
  const sols: SingleSolution[] = [];
  let nodes = 0, aborted = false;

  function evalAll(): { need: Record<string, number>; needsByRay: Need[][] } | null {
    const need: Record<string, number> = {}, needsByRay: Need[][] = [];
    for (let ri = 0; ri < rays.length; ri++) {
      const cells = rays[ri], target = L.rays[ri].target;
      const last: Record<Channel, { idx: number; t: string } | null> = { R: null, G: null, B: null };
      cells.forEach((k, idx) => {
        const t = I.fixed.get(k) || assign.get(k);
        if (t) for (const p of parts(t)) last[p[1] as Channel] = { idx, t: p };
      });
      const needs: Need[] = [];
      for (const ch of ['R', 'G', 'B'] as Channel[]) {
        const l = last[ch];
        const val = l ? (l.t[0] === '+' ? 1 : 0) : 1;
        const tb = target & BIT[ch] ? 1 : 0;
        if (val !== tb) needs.push({ t: (tb ? '+' : '-') + ch, min: l ? l.idx : -1 });
      }
      needs.sort((a, b) => b.min - a.min);
      for (let j = 0; j < needs.length; j++) {
        if (freePlain[ri].filter(x => x > needs[j].min).length < j + 1) return null;
      }
      needs.forEach(n => { need[n.t] = (need[n.t] || 0) + 1; });
      needsByRay.push(needs);
    }
    return { need, needsByRay };
  }

  function dfs(i: number): void {
    if (sols.length >= limit || aborted) return;
    if (++nodes > maxNodes) { aborted = true; return; }
    if (i === crosses.length) {
      const e = evalAll();
      if (!e) return;
      for (const t of TYPES) {
        const n = e.need[t] || 0, l = left[t] || 0;
        if (n > l || (exact && n !== l)) return;
      }
      sols.push({ assign: new Map(assign), needsByRay: e.needsByRay });
      return;
    }
    const k = crosses[i];
    dfs(i + 1);
    for (const t of TYPES) {
      if (!(left[t] > 0)) continue;
      left[t]--; assign.set(k, t);
      dfs(i + 1);
      assign.delete(k); left[t]++;
    }
  }
  dfs(0);
  return { sols, nodes, aborted, crosses };
}

// ---------- Piezas pegadas ----------

/** Celdas de una pieza girada k cuartos horarios, normalizadas para empezar en (0,0). Conserva el orden de las celdas. */
export function pieceCells(piece: Piece, k: number): PieceCell[] {
  let cells = piece.cells.map(x => ({ ...x }));
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) cells = cells.map(x => ({ dr: x.dc, dc: -x.dr, t: x.t }));
  const mr = Math.min(...cells.map(x => x.dr)), mc = Math.min(...cells.map(x => x.dc));
  return cells.map(x => ({ dr: x.dr - mr, dc: x.dc - mc, t: x.t }));
}

/** Orientaciones distintas de una pieza (sin repetir las simétricas). */
export function pieceOrients(piece: Piece): { k: number; cells: PieceCell[] }[] {
  const out: { k: number; cells: PieceCell[] }[] = [], seen = new Set<string>();
  for (let k = 0; k < (piece.norotate ? 1 : 4); k++) {
    const cells = pieceCells(piece, k);
    const sig = cells.map(x => `${x.dr},${x.dc},${x.t}`).sort().join(';');
    if (!seen.has(sig)) { seen.add(sig); out.push({ k, cells }); }
  }
  return out;
}

export const placedCells = (piece: Piece, p: PiecePlacement): FixedShield[] =>
  pieceCells(piece, p.k).map(x => ({ r: x.dr + p.r, c: x.dc + p.c, t: x.t }));

export interface FullOptions { exact?: boolean; maxLeaves?: number; maxNodes?: number; limit?: number; }

/**
 * Firma de una solución: qué hay en cada cruce y qué efectos hay entre cruce y cruce de cada rayo.
 * Dos soluciones con la misma firma son "la misma" para el jugador (solo cambia en qué casillero
 * de un mismo tramo quedó un escudo). Los vidrios transparentes no cuentan.
 */
export function solutionSignature(L: Level, cells: Map<string, ShieldType>): string {
  const I = info(L), proj = projectorSet(L);
  return L.rays.map(ray => {
    const out: string[] = [];
    let seg: string[] = [];
    for (const [r, c] of rayCells(L, ray, proj)) {
      const k = key(r, c), t = I.fixed.get(k) || cells.get(k) || '';
      if (I.isCross(k)) { out.push(seg.sort().join(''), 'X' + t); seg = []; }
      else if (t) seg.push(...parts(t));
    }
    out.push(seg.sort().join(''));
    return out.join('|');
  }).join('/');
}

/**
 * Solver general: ubica las piezas probando lugares distintos y deja los escudos sueltos al solver de cruces.
 * Con limit > 1 junta soluciones distintas (según su firma) hasta llegar al límite.
 */
export function solveFull(L: Level, inv: Record<string, number>, pieces: Piece[], opts: FullOptions = {}) {
  const exact = !!opts.exact, maxLeaves = opts.maxLeaves || 6000, limit = opts.limit || 1;
  const I = info(L);
  const occupied = new Set([...I.blocked, ...I.fixed.keys(), ...I.projectors]);
  const orients = pieces.map(pieceOrients);
  const choice: (PiecePlacement | null)[] = new Array(pieces.length).fill(null);
  const extra: FixedShield[] = [];
  const sols: FullSolution[] = [], sigs = new Set<string>();
  let leaves = 0, aborted = false;
  const done = () => sols.length >= limit || aborted;

  function dfs(j: number): void {
    if (done()) return;
    if (j === pieces.length) {
      if (++leaves > maxLeaves) { aborted = true; return; }
      const L2: Level = { ...L, fixed: [...(L.fixed || []), ...extra] };
      const res = solve(L2, inv, { limit: limit > 1 ? 50 : 1, exact, maxNodes: opts.maxNodes || 60000 });
      if (res.aborted) { aborted = true; return; }
      for (const single of res.sols) {
        const sol: FullSolution = { pieces: choice.map(p => p && { ...p }), single, L2 };
        if (limit > 1) {
          const m = new Map<string, ShieldType>();
          for (const f of extra) m.set(key(f.r, f.c), f.t);
          for (const f of concreteSingles(L2, single)) m.set(key(f.r, f.c), f.t);
          const sig = solutionSignature(L, m);
          if (sigs.has(sig)) continue;
          sigs.add(sig);
        }
        sols.push(sol);
        if (done()) return;
      }
      return;
    }
    const seen = new Set<string>();
    for (const { k, cells } of orients[j]) {
      for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
        const abs = cells.map(x => ({ r: x.dr + r, c: x.dc + c, t: x.t }));
        if (abs.some(a => a.r >= L.rows || a.c >= L.cols || occupied.has(key(a.r, a.c)))) continue;
        const onRay = abs.filter(a => I.onRays.has(key(a.r, a.c)));
        if (!onRay.length) continue;
        const sig = onRay.map(a => `${a.r},${a.c},${a.t}`).sort().join(';');
        if (seen.has(sig)) continue;
        seen.add(sig);
        abs.forEach(a => { occupied.add(key(a.r, a.c)); extra.push(a); });
        choice[j] = { k, r, c };
        dfs(j + 1);
        choice[j] = null;
        abs.forEach(a => occupied.delete(key(a.r, a.c)));
        extra.splice(extra.length - abs.length);
        if (done()) return;
      }
    }
    if (!exact) dfs(j + 1);
  }
  dfs(0);
  return { found: sols[0] || null, sols, aborted, leaves };
}

/** Escudos sueltos concretos a partir de una solución abstracta (cruces + necesidades por rayo). */
export function concreteSingles(L2: Level, single: SingleSolution): FixedShield[] {
  const I = info(L2), out: FixedShield[] = [], taken = new Set<string>();
  for (const [k, t] of single.assign) { const [r, c] = toRC(k); out.push({ r, c, t }); taken.add(k); }
  L2.rays.forEach((ray, ri) => {
    const cells = rayCells(L2, ray).map(([r, c]) => key(r, c));
    single.needsByRay[ri].forEach(n => {
      const idx = cells.findIndex((k, j) => j > n.min && I.placeable.has(k) && !I.isCross(k) && !taken.has(k));
      if (idx === -1) return;
      taken.add(cells[idx]);
      const [r, c] = toRC(cells[idx]);
      out.push({ r, c, t: n.t });
    });
  });
  return out;
}

// ---------- Generadores (para niveles aleatorios) ----------

export interface GenOptions {
  sizes: [number, number][]; h: [number, number]; v: [number, number]; k?: [number, number];
  add?: boolean; pAdd?: number; pCross?: number; pBlock?: number; pBlockX?: number; fixed?: [number, number];
  minCross?: number; maxWhite?: number; minDistinct?: number; attempts?: number; maxNodes?: number;
  pieces?: [number, number]; pDouble?: number; pFixedCombo?: number; multiRay?: boolean; pAdjacent?: number; shapes?: number[];
}

export const BANDS: Record<string, GenOptions> = {
  easy: { sizes: [[5, 5], [5, 6], [6, 6]], h: [1, 2], v: [1, 2], k: [2, 3], pCross: .6, pBlock: .25, minCross: 1 },
  mid: { sizes: [[6, 6], [6, 7]], h: [2, 2], v: [1, 2], k: [3, 4], add: true, pAdd: .35, pCross: .6, pBlock: .3, fixed: [0, 1], minCross: 1 },
  hard: { sizes: [[7, 7], [7, 8]], h: [2, 3], v: [2, 3], k: [4, 6], add: true, pAdd: .35, pCross: .65, pBlock: .3, pBlockX: .1, fixed: [1, 2], minCross: 2 },
  combo: { sizes: [[6, 6], [6, 7]], h: [2, 3], v: [1, 2], pieces: [1, 2], k: [1, 2], add: true, pAdd: .25, pDouble: .25, pBlock: .2, pFixedCombo: .3, multiRay: true, pAdjacent: .7 }
};

const SUB = ['-R', '-G', '-B'], ADD = ['+R', '+G', '+B'];
const SHAPES: [number, number][][] = [[[0, 0], [0, 1]], [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [1, 1]]];

function rngTools(seed: number) {
  const rng = mulberry32(seed >>> 0);
  const pick = <T>(a: T[]): T => a[Math.floor(rng() * a.length)];
  const rint = ([a, b]: [number, number]) => a + Math.floor(rng() * (b - a + 1));
  const shuffle = <T>(a: T[]): T[] => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  return { rng, pick, rint, shuffle };
}
const usage = (sol: SingleSolution) => {
  const u: Record<string, number> = {};
  for (const t of sol.assign.values()) u[t] = (u[t] || 0) + 1;
  sol.needsByRay.forEach(ns => ns.forEach(n => { u[n.t] = (u[n.t] || 0) + 1; }));
  return u;
};
const sameCounts = (a: Record<string, number>, b: Record<string, number>) => TYPES.every(t => (a[t] || 0) === (b[t] || 0));

/** Nivel de escudos sueltos con solución única. */
export function generate(o: GenOptions, seed: number): Level | null {
  const { rng, pick, rint, shuffle } = rngTools(seed);
  for (let att = 0; att < (o.attempts || 800); att++) {
    const [rows, cols] = pick(o.sizes);
    const nh = Math.min(rint(o.h), rows), nv = Math.min(rint(o.v), cols);
    const rowSel = shuffle([...Array(rows).keys()]).slice(0, nh);
    const colSel = shuffle([...Array(cols).keys()]).slice(0, nv);
    const rays: Ray[] = [
      ...rowSel.sort((a, b) => a - b).map(i => ({ o: 'h' as const, i, rev: rng() < .5, target: 7 })),
      ...colSel.sort((a, b) => a - b).map(i => ({ o: 'v' as const, i, rev: rng() < .5, target: 7 }))
    ];
    const L: Level = { rows, cols, rays, blocked: [], fixed: [], inv: {} };
    const I0 = info(L);
    const all = [...I0.onRays.keys()];
    const crosses = all.filter(I0.isCross), plains = all.filter(k => !I0.isCross(k));
    for (const k of plains) if (rng() < (o.pBlock || 0)) L.blocked.push(toRC(k));
    for (const k of crosses) if (rng() < (o.pBlockX || 0)) L.blocked.push(toRC(k));
    const used = new Set(L.blocked.map(([r, c]) => key(r, c)));
    const nFixed = rint(o.fixed || [0, 0]);
    for (let f = 0; f < nFixed; f++) {
      const free = all.filter(k => !used.has(k));
      if (!free.length) break;
      const k = pick(free), [r, c] = toRC(k);
      used.add(k);
      L.fixed.push({ r, c, t: rng() < .8 ? pick(SUB) : pick(ADD) });
    }
    const k = rint(o.k || [2, 3]);
    const placed = new Map<string, string>();
    for (let j = 0; j < k; j++) {
      const fc = crosses.filter(x => !used.has(x) && !placed.has(x));
      const fp = plains.filter(x => !used.has(x) && !placed.has(x));
      const pool = fc.length && rng() < (o.pCross || .5) ? fc : fp.length ? fp : fc;
      if (!pool.length) break;
      placed.set(pick(pool), o.add && rng() < (o.pAdd || .3) ? pick(ADD) : pick(SUB));
    }
    const sim = simulate(L, placed);
    rays.forEach((ray, i) => { ray.target = sim[i].final; });
    const inv: Record<string, number> = {};
    for (const t of placed.values()) inv[t] = (inv[t] || 0) + 1;
    if (o.add && !Object.keys(inv).some(t => t[0] === '+')) continue;
    if ([...placed.keys()].filter(x => I0.isCross(x)).length < (o.minCross || 0)) continue;
    if (rays.filter(r => r.target === 7).length > (o.maxWhite ?? 1)) continue;
    if (new Set(rays.map(r => r.target)).size < Math.min(rays.length, o.minDistinct || 2)) continue;
    const res = solve(L, inv, { limit: 2, maxNodes: o.maxNodes || 200000 });
    if (res.aborted || res.sols.length !== 1) continue;
    if (!sameCounts(usage(res.sols[0]), inv)) continue;
    L.inv = inv;
    L.sol = [...placed].map(([kk, t]) => { const [r, c] = toRC(kk); return { r, c, t }; });
    return L;
  }
  return null;
}

/** ¿Hace falta cada escudo y cada pieza? Si al sacar uno igual se puede, el nivel es flojo. */
export function allNecessary(L: Level, inv: Record<string, number>, pieces: Piece[], opts: FullOptions): boolean {
  for (const t of TYPES) {
    if (!inv[t]) continue;
    const r = solveFull(L, { ...inv, [t]: inv[t] - 1 }, pieces, opts);
    if (r.aborted || r.found) return false;
  }
  for (let i = 0; i < pieces.length; i++) {
    const r = solveFull(L, inv, pieces.filter((_, j) => j !== i), opts);
    if (r.aborted || r.found) return false;
  }
  return true;
}

/** Nivel con piezas pegadas, escudos dobles y piezas fijas. */
export function generateCombo(o: GenOptions, seed: number): Level | null {
  const { rng, pick, rint, shuffle } = rngTools(seed);
  const randType = (): string => {
    if (rng() < (o.pDouble || 0)) {
      const [a, b] = shuffle(['R', 'G', 'B']).slice(0, 2);
      return (rng() < .7 ? '-' : '+') + a + (rng() < .5 ? '-' : '+') + b;
    }
    return o.add && rng() < (o.pAdd || .3) ? pick(ADD) : pick(SUB);
  };
  for (let att = 0; att < (o.attempts || 600); att++) {
    const [rows, cols] = pick(o.sizes);
    const nh = Math.min(rint(o.h), rows), nv = Math.min(rint(o.v), cols);
    const pickLines = (n: number, total: number) => {
      const set = new Set<number>();
      if (n >= 2 && rng() < (o.pAdjacent ?? .6)) { const a = Math.floor(rng() * (total - 1)); set.add(a); set.add(a + 1); }
      for (const x of shuffle([...Array(total).keys()])) { if (set.size >= n) break; set.add(x); }
      return [...set].sort((a, b) => a - b);
    };
    const rays: Ray[] = [
      ...pickLines(nh, rows).map(i => ({ o: 'h' as const, i, rev: rng() < .5, target: 7 })),
      ...pickLines(nv, cols).map(i => ({ o: 'v' as const, i, rev: rng() < .5, target: 7 }))
    ];
    const L: Level = { rows, cols, rays, blocked: [], fixed: [], inv: {} };
    const I0 = info(L);
    const all = [...I0.onRays.keys()];
    for (const k of all) if (!I0.isCross(k) && rng() < (o.pBlock || 0)) L.blocked.push(toRC(k));
    const used = new Set(L.blocked.map(([r, c]) => key(r, c)));
    if (rng() < (o.pFixedCombo || 0)) {
      const free = all.filter(x => !used.has(x));
      if (free.length) {
        const [r, c] = toRC(pick(free)), horiz = rng() < .5, r2 = horiz ? r : r + 1, c2 = horiz ? c + 1 : c;
        if (r2 < rows && c2 < cols && !used.has(key(r2, c2))) {
          L.fixed.push({ r, c, t: pick(SUB), g: 1 }, { r: r2, c: c2, t: pick(SUB), g: 1 });
          used.add(key(r, c)); used.add(key(r2, c2));
        }
      }
    }
    for (let f = rint(o.fixed || [0, 0]); f > 0; f--) {
      const free = all.filter(x => !used.has(x));
      if (!free.length) break;
      const k = pick(free), [r, c] = toRC(k);
      used.add(k); L.fixed.push({ r, c, t: pick(SUB) });
    }
    const pieces: Piece[] = [], solP: PiecePlacement[] = [], cellMap = new Map<string, string>();
    let ok = true;
    for (let n = rint(o.pieces || [1, 1]); n > 0; n--) {
      const shape = pick(o.shapes ? o.shapes.map(i => SHAPES[i]) : SHAPES);
      const piece: Piece = { cells: shape.map(([dr, dc]) => ({ dr, dc, t: randType() })) };
      if (new Set(piece.cells.map(x => x.t)).size < Math.min(2, piece.cells.length)) { ok = false; break; }
      const opts: PiecePlacement[] = [];
      for (let k = 0; k < 4; k++) {
        const cells = pieceCells(piece, k);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const abs = cells.map(x => ({ r: x.dr + r, c: x.dc + c }));
          if (abs.some(a => a.r >= rows || a.c >= cols || used.has(key(a.r, a.c)) || cellMap.has(key(a.r, a.c)))) continue;
          if (abs.some(a => !I0.onRays.has(key(a.r, a.c)))) continue;
          const raySet = new Set(abs.flatMap(a => I0.onRays.get(key(a.r, a.c))!));
          if (o.multiRay && raySet.size < 2) continue;
          opts.push({ k, r, c });
        }
      }
      if (!opts.length) { ok = false; break; }
      const p = pick(opts);
      pieces.push(piece); solP.push(p);
      placedCells(piece, p).forEach(a => cellMap.set(key(a.r, a.c), a.t));
    }
    if (!ok) continue;
    const inv: Record<string, number> = {}, sol: FixedShield[] = [];
    for (let n = rint(o.k || [0, 0]); n > 0; n--) {
      const free = all.filter(x => !used.has(x) && !cellMap.has(x));
      if (!free.length) break;
      const crosses = free.filter(I0.isCross);
      const k = crosses.length && rng() < (o.pCross || .5) ? pick(crosses) : pick(free);
      const t = o.add && rng() < (o.pAdd || .3) ? pick(ADD) : pick(SUB);
      cellMap.set(k, t); inv[t] = (inv[t] || 0) + 1;
      const [r, c] = toRC(k); sol.push({ r, c, t });
    }
    const sim = simulate(L, cellMap);
    rays.forEach((ray, i) => { ray.target = sim[i].final; });
    if (rays.filter(r => r.target === 7).length > (o.maxWhite ?? 1)) continue;
    if (new Set(rays.map(r => r.target)).size < Math.min(rays.length, 2)) continue;
    pieces.forEach((p, i) => {
      const k0 = Math.floor(rng() * 4);
      p.cells = pieceCells(p, k0);
      solP[i] = { ...solP[i], k: (solP[i].k - k0 + 8) % 4 };
    });
    const check = new Map(sol.map(s => [key(s.r, s.c), s.t] as [string, string]));
    pieces.forEach((p, i) => placedCells(p, solP[i]).forEach(a => check.set(key(a.r, a.c), a.t)));
    if (!simulate(L, check).every(x => x.ok)) continue;
    if (!allNecessary(L, inv, pieces, { maxLeaves: 4000, maxNodes: 40000 })) continue;
    L.inv = inv; L.pieces = pieces; L.sol = sol; L.solP = solP;
    return L;
  }
  return null;
}
