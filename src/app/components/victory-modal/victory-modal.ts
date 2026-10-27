import { Component, computed, inject, output } from '@angular/core';
import { GameService } from '../../services/game.service';

/** Cartel de victoria con estrellas, tiempo y pistas usadas. */
@Component({
  selector: 'app-victory-modal',
  templateUrl: './victory-modal.html',
  styleUrl: './victory-modal.scss'
})
export class VictoryModalComponent {
  readonly game = inject(GameService);
  readonly next = output<void>();
  readonly levels = output<void>();

  readonly vm = computed(() => {
    const r = this.game.lastResult();
    const s = Math.floor((r?.timeMs || 0) / 1000);
    const time = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    const isLast = this.game.levelIndex() + 1 >= this.game.levels.length;
    return {
      stars: [0, 1, 2].map(i => i < (r?.stars || 0)),
      time,
      hints: r?.hints ? `Pistas usadas: ${r.hints}` : 'Sin pistas. ¡Brillante!',
      nextLabel: this.game.custom() ? '← Volver al diseñador' : this.game.band() ? 'Otro aleatorio →' : isLast ? 'Volver a jugar' : 'Siguiente →'
    };
  });
}
