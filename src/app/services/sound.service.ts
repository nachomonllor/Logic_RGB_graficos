import { Injectable, signal } from '@angular/core';

interface ToneOptions { dur?: number; type?: OscillatorType; vol?: number; delay?: number; slide?: number | null; }

/** Efectos de sonido sintetizados con Web Audio (sin archivos). */
@Injectable({ providedIn: 'root' })
export class SoundService {
  readonly muted = signal(false);
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private static readonly NOTES = [523, 587, 659, 784, 880, 988, 1047, 1175, 1319, 1568];

  constructor() {
    try { this.muted.set(localStorage.getItem('espectro-muted') === '1'); } catch { /* sin almacenamiento */ }
  }

  /** Crea o reanuda el contexto de audio. Hay que llamarlo desde un gesto del usuario. */
  unlock(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = .5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  toggle(): void {
    this.muted.update(m => !m);
    try { localStorage.setItem('espectro-muted', this.muted() ? '1' : '0'); } catch { /* sin almacenamiento */ }
    if (!this.muted()) this.ui();
  }

  private tone(f: number, { dur = .12, type = 'sine', vol = .25, delay = 0, slide = null }: ToneOptions = {}): void {
    if (this.muted()) return;
    const c = this.unlock();
    if (!c || !this.master) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + .006);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + .03);
  }
  private shimmer(base: number, delay = 0): void {
    [1, 1.5, 2, 3].forEach((m, i) => this.tone(base * m, { dur: .5 - i * .08, vol: .06, delay: delay + i * .03 }));
  }

  ui(): void { this.tone(600, { dur: .06, type: 'triangle', vol: .15 }); }
  pick(): void { this.tone(420, { dur: .09, type: 'triangle', vol: .16, slide: 640 }); }
  place(t: string): void {
    const sub = t[0] === '-';
    this.tone(sub ? 330 : 660, { dur: .12, type: 'triangle', vol: .18 });
    this.tone(sub ? 220 : 990, { dur: .2, vol: .08, delay: .03 });
  }
  remove(): void { this.tone(640, { dur: .12, type: 'triangle', vol: .14, slide: 300 }); }
  rotate(): void { this.tone(520, { dur: .07, type: 'square', vol: .05 }); this.tone(780, { dur: .09, type: 'triangle', vol: .12, delay: .05 }); }
  sensorOn(i: number): void { this.shimmer(SoundService.NOTES[i % SoundService.NOTES.length]); }
  sensorOff(): void { this.tone(300, { dur: .18, type: 'triangle', vol: .1, slide: 200 }); }
  bad(): void { this.tone(160, { dur: .2, type: 'square', vol: .07, slide: 110 }); }
  hint(): void { [880, 1175, 1568, 2093].forEach((f, i) => this.tone(f, { dur: .2, vol: .09, delay: i * .06 })); }
  win(): void {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.shimmer(f, i * .09));
    [523, 659, 784, 1047].forEach(f => this.tone(f, { dur: 1.6, vol: .06, delay: .6 }));
  }
}
