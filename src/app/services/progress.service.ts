import { Injectable, InjectionToken, inject, signal } from '@angular/core';

/** Resultado de una partida ganada. */
export interface LevelResult {
  stars: number;
  timeMs: number;
  hints: number;
}

/** Mejor resultado guardado de cada nivel. */
export type ProgressMap = Record<string, LevelResult>;

/**
 * Dónde se guarda el progreso. Hoy: localStorage. Mañana: Supabase.
 * Para conectar Supabase alcanza con escribir otra clase que implemente esto y cambiar el provider.
 */
export interface ProgressStore {
  getAll(): Promise<ProgressMap>;
  save(levelId: string, result: LevelResult): Promise<void>;
}

export class LocalProgressStore implements ProgressStore {
  private static readonly KEY = 'espectro-progress-v2';
  async getAll(): Promise<ProgressMap> {
    try { return JSON.parse(localStorage.getItem(LocalProgressStore.KEY) || '{}'); } catch { return {}; }
  }
  async save(levelId: string, result: LevelResult): Promise<void> {
    const all = await this.getAll();
    all[levelId] = result;
    try { localStorage.setItem(LocalProgressStore.KEY, JSON.stringify(all)); } catch { /* sin almacenamiento */ }
  }
}

export const PROGRESS_STORE = new InjectionToken<ProgressStore>('PROGRESS_STORE', {
  providedIn: 'root',
  factory: () => new LocalProgressStore()
});

/** Progreso del jugador: estrellas, mejor tiempo y pistas por nivel. */
@Injectable({ providedIn: 'root' })
export class ProgressService {
  private store = inject(PROGRESS_STORE);
  readonly progress = signal<ProgressMap>({});

  constructor() {
    void this.store.getAll().then(p => this.progress.set(p));
  }

  stars(levelId: string): number {
    return this.progress()[levelId]?.stars ?? 0;
  }

  /** Guarda solo si mejora: más estrellas, o mismas estrellas en menos tiempo. */
  async record(levelId: string, result: LevelResult): Promise<void> {
    const prev = this.progress()[levelId];
    const better = !prev || result.stars > prev.stars || (result.stars === prev.stars && result.timeMs < prev.timeMs);
    if (!better) return;
    this.progress.update(p => ({ ...p, [levelId]: result }));
    await this.store.save(levelId, result);
  }
}
