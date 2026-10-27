/** Colores luz como 3 bits: R=4, G=2, B=1. Blanco = 7, negro = 0. */
export type LightColor = number;

/** Un escudo simple ('-R', '+G'), doble ('-R+G') o vidrio transparente (''). */
export type ShieldType = string;

/** Dirección de un proyector: norte, sur, este, oeste. */
export type Dir = 'N' | 'S' | 'E' | 'W';

export type Channel = 'R' | 'G' | 'B';

export interface Ray {
  /** Formato clásico: 'h' horizontal (recorre una fila) o 'v' vertical (recorre una columna). */
  o?: 'h' | 'v';
  /** Formato clásico: índice de fila o de columna. */
  i?: number;
  /** Formato clásico: true si viaja de derecha a izquierda o de abajo hacia arriba. */
  rev?: boolean;
  /** Formato con proyectores: posición del proyector (puede ser -1 o rows/cols para los bordes). */
  er?: number;
  ec?: number;
  /** Formato con proyectores: hacia dónde sale la luz. */
  dir?: Dir;
  /** Color que pide el sensor al final del rayo. */
  target: LightColor;
}

export interface FixedShield {
  r: number;
  c: number;
  t: ShieldType;
  /** Escudos fijos con el mismo grupo se dibujan unidos (pieza con candado). */
  g?: number;
}

export interface PieceCell {
  dr: number;
  dc: number;
  t: ShieldType;
}

export interface Piece {
  cells: PieceCell[];
  /** Conectores entre celdas (índices). Si falta, se unen todas las celdas vecinas. */
  links?: [number, number][];
  norotate?: boolean;
}

/** Ubicación de una pieza: giro k (cuartos horarios) y origen (r, c). */
export interface PiecePlacement {
  k: number;
  r: number;
  c: number;
}

export interface Level {
  /** 2 = nivel hecho con el diseñador (proyectores, vidrios transparentes, conectores). */
  v?: number;
  name?: string;
  group?: string;
  rows: number;
  cols: number;
  rays: Ray[];
  blocked: [number, number][];
  fixed: FixedShield[];
  /** Conectores entre vidrios fijos: [r1, c1, r2, c2]. */
  fixedLinks?: [number, number, number, number][];
  inv: Record<string, number>;
  pieces?: Piece[];
  sol?: FixedShield[];
  solP?: (PiecePlacement | null)[];
}

export interface RaySegment {
  r: number;
  c: number;
  cin: LightColor;
  cout: LightColor;
  t?: ShieldType;
}

export interface RayResult {
  final: LightColor;
  segs: RaySegment[];
  ok: boolean;
}

export interface Need {
  t: ShieldType;
  min: number;
}

export interface SingleSolution {
  assign: Map<string, ShieldType>;
  needsByRay: Need[][];
}

export interface FullSolution {
  pieces: (PiecePlacement | null)[];
  single: SingleSolution;
  L2: Level;
}

export const LIGHT: Record<number, string> = {
  7: '#ffffff', 4: '#ff4d5e', 2: '#3dff7a', 1: '#4d7cff', 6: '#ffe14d', 3: '#3de8ff', 5: '#ff4dff', 0: '#2a2d48'
};
export const LIGHT_NAME: Record<number, string> = {
  7: 'blanco', 4: 'rojo', 2: 'verde', 1: 'azul', 6: 'amarillo', 3: 'cian', 5: 'magenta', 0: 'negro'
};
export const CHANNEL_COLOR: Record<Channel, string> = { R: '#ff4d5e', G: '#2fd47a', B: '#4d7cff' };
export const LETTERS = 'ABCDEFGHIJ';
