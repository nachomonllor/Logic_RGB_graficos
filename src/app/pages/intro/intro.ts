import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HowtoModalComponent } from '../../components/howto-modal/howto-modal';
import { ShieldComponent } from '../../components/shield/shield';
import { SoundService } from '../../services/sound.service';

/** Pantalla de presentación con el logo y una demo animada del cruce. */
@Component({
  selector: 'app-intro',
  imports: [ShieldComponent, HowtoModalComponent],
  templateUrl: './intro.html',
  styleUrl: './intro.scss'
})
export class IntroPage {
  readonly sound = inject(SoundService);
  private router = inject(Router);
  readonly howto = signal(false);
  /** 0: solo blanco · 1: escudo −R en el cruce · 2: también −G abajo */
  readonly step = signal(0);

  readonly letters = [...'ESPECTRO'].map((ch, i) => ({
    ch, col: ['#ff4d5e', '#ffe14d', '#3dff7a', '#3de8ff', '#4d7cff', '#ff4dff', '#ffffff', '#ffe14d'][i],
    delay: `${i * .08}s, ${.8 + i * .15}s`
  }));
  readonly lines = [
    { x1: 20, y1: 70, x2: 140, y2: 70, c: '#ffffff', from: 0 },
    { x1: 140, y1: 70, x2: 300, y2: 70, c: '#3de8ff', from: 1 },
    { x1: 140, y1: 14, x2: 140, y2: 70, c: '#ffffff', from: 0 },
    { x1: 140, y1: 70, x2: 140, y2: 118, c: '#3de8ff', from: 1 },
    { x1: 140, y1: 118, x2: 140, y2: 156, c: '#4d7cff', from: 2 }
  ];

  constructor() {
    const id = setInterval(() => this.step.update(s => (s + 1) % 3), 1400);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  play(): void {
    this.sound.unlock();
    this.sound.sensorOn(0);
    void this.router.navigate(['/niveles']);
  }
  openHowto(): void {
    this.sound.unlock();
    this.sound.ui();
    this.howto.set(true);
  }
}
