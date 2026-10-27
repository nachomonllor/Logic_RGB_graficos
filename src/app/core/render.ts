import { projectorSet, rayDir, rayOrigin, rayPath } from './engine';
import { LETTERS, LIGHT, Level, RayResult } from './models';

/** Geometría de dibujo compartida por el tablero de juego y el del diseñador. */

export interface RayLine { x1: number; y1: number; x2: number; y2: number; col: string; dark: boolean; }
export interface EmitterView { x: number; y: number; rot: number; inside: boolean; }
export interface SensorView {
  x: number; y: number; r: number; ok: boolean; ring: string; target: string; fill: string;
  dark: boolean; label: string; textFill: string; ping: boolean; noTarget: boolean;
}

/**
 * Líneas de luz, proyectores y sensores de todos los rayos.
 * s = tamaño de celda, m = margen. targets indefinidos (en el diseñador) se dibujan grises.
 */
export function rayGeometry(L: Level, sim: RayResult[], s: number, m: number, pings: number[] = []) {
  const cx = (c: number) => m + c * s + s / 2;
  const cy = (r: number) => m + r * s + s / 2;
  const proj = projectorSet(L);
  const lines: RayLine[] = [];
  const emitters: EmitterView[] = [];
  const sensors: SensorView[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number, col: number) =>
    lines.push({ x1, y1, x2, y2, col: LIGHT[col], dark: col === 0 });

  L.rays.forEach((ray, ri) => {
    const [dr, dc] = rayDir(ray), [orr, oc] = rayOrigin(L, ray);
    const path = rayPath(L, ray, proj), segs = sim[ri]?.segs || [];
    const inside = orr >= 0 && oc >= 0 && orr < L.rows && oc < L.cols;
    // del proyector a la primera celda
    const sx0 = cx(oc) + dc * s * (inside ? .3 : .45), sy0 = cy(orr) + dr * s * (inside ? .3 : .45);
    seg(sx0, sy0, cx(oc) + dc * s / 2, cy(orr) + dr * s / 2, 7);
    for (const sg of segs) {
      const x = cx(sg.c), y = cy(sg.r);
      seg(x - dc * s / 2, y - dr * s / 2, x, y, sg.cin);
      seg(x, y, x + dc * s / 2, y + dr * s / 2, sg.cout);
    }
    const fin = sim[ri]?.final ?? 7;
    // fin del rayo: afuera del tablero o contra otro proyector
    const [er, ec] = path.end;
    const lastX = cx(ec) - dc * s / 2, lastY = cy(er) - dr * s / 2;
    let sx: number, sy: number, rad: number;
    if (path.blocked) { sx = lastX - dc * s * .2; sy = lastY - dr * s * .2; rad = s * .2; }
    else { sx = cx(ec) + dc * s * .12; sy = cy(er) + dr * s * .12; rad = s * .34; seg(lastX, lastY, sx, sy, fin); }
    emitters.push({ x: cx(oc), y: cy(orr), rot: Math.atan2(dr, dc) * 180 / Math.PI, inside });
    const hasTarget = ray.target !== undefined && ray.target !== null && ray.target >= 0;
    const ok = hasTarget && sim[ri]?.ok;
    sensors.push({
      x: sx, y: sy, r: rad, ok: !!ok, noTarget: !hasTarget,
      ring: !hasTarget ? '#6a6f9a' : ray.target === 0 ? '#6a6f9a' : LIGHT[ray.target],
      target: hasTarget ? LIGHT[ray.target] : '#6a6f9a', fill: LIGHT[fin], dark: fin === 0,
      label: ok ? '✓' : LETTERS[ri] ?? String(ri + 1), textFill: fin === 0 || fin === 1 ? '#fff' : '#1a1433',
      ping: pings.includes(ri)
    });
  });
  return { lines, emitters, sensors };
}

/** Vidrios fijos agrupados en piezas (por grupo g), con sus conectores como índices. */
export function fixedGroups(L: Level) {
  const singles: { r: number; c: number; t: string }[] = [];
  const groups = new Map<number, { r: number; c: number; t: string }[]>();
  for (const f of L.fixed || []) {
    if (f.g) { if (!groups.has(f.g)) groups.set(f.g, []); groups.get(f.g)!.push(f); }
    else singles.push(f);
  }
  const links = L.fixedLinks;
  const out = [...groups.values()].map(list => {
    const r0 = Math.min(...list.map(x => x.r)), c0 = Math.min(...list.map(x => x.c));
    const idx = (r: number, c: number) => list.findIndex(x => x.r === r && x.c === c);
    const lk = links
      ? links.map(([a, b, c, d]) => [idx(a, b), idx(c, d)] as [number, number]).filter(([i, j]) => i >= 0 && j >= 0)
      : undefined;
    return { r0, c0, cells: list.map(x => ({ dr: x.r - r0, dc: x.c - c0, t: x.t })), links: lk };
  });
  return { singles, groups: out };
}

/**
 * Color con que se ilumina cada baldosa: la luz que sale de ella.
 * Si la cruzan dos rayos, las luces se suman (igual que en la realidad).
 */
export function cellTints(sim: RayResult[]): Map<string, string> {
  const mask = new Map<string, number>();
  for (const rs of sim) for (const sg of rs.segs) {
    const k = sg.r + ',' + sg.c;
    mask.set(k, (mask.get(k) || 0) | sg.cout);
  }
  const out = new Map<string, string>();
  for (const [k, m] of mask) if (m) out.set(k, LIGHT[m]);
  return out;
}
