import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { LEVELS } from '../../core/levels';
import { ProgressService } from '../../services/progress.service';
import { SoundService } from '../../services/sound.service';

const TITLES: Record<string, string> = {
  Aprender: 'Aprender', Inicial: 'Cruces', Sumar: 'Quitar y sumar', Experto: 'Experto', Piezas: 'Piezas pegadas y escudos dobles'
};

/** Selector de niveles agrupados, con estrellas, y niveles aleatorios. */
@Component({
  selector: 'app-levels',
  templateUrl: './levels.html',
  styleUrl: './levels.scss'
})
export class LevelsPage {
  readonly sound = inject(SoundService);
  private progress = inject(ProgressService);
  private router = inject(Router);

  readonly bands = [
    { id: 'easy', name: 'Fácil' }, { id: 'mid', name: 'Media' }, { id: 'hard', name: 'Difícil' }, { id: 'combo', name: 'Con piezas' }
  ];

  readonly groups = computed(() => {
    this.progress.progress();
    const groups: { name: string; title: string; items: { n: number; stars: boolean[]; done: boolean }[] }[] = [];
    LEVELS.forEach((lv, i) => {
      const name = lv.group || '';
      let g = groups.find(x => x.name === name);
      if (!g) { g = { name, title: TITLES[name] || name, items: [] }; groups.push(g); }
      const st = this.progress.stars('n' + i);
      g.items.push({ n: i + 1, stars: [0, 1, 2].map(k => k < st), done: st > 0 });
    });
    return groups;
  });

  open(n: number): void { this.sound.ui(); void this.router.navigate(['/jugar', n]); }
  random(band: string): void { this.sound.ui(); void this.router.navigate(['/aleatorio', band]); }
  admin(): void { this.sound.ui(); void this.router.navigate(['/admin']); }
  back(): void { this.sound.ui(); void this.router.navigate(['/']); }
}
