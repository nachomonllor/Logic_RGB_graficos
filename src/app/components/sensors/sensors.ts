import { Component, computed, inject } from '@angular/core';
import { LETTERS, LIGHT, LIGHT_NAME } from '../../core/models';
import { GameService } from '../../services/game.service';

/** Lista de sensores: qué color pide cada uno y cuál le llega. */
@Component({
  selector: 'app-sensors',
  templateUrl: './sensors.html',
  styleUrl: './sensors.scss'
})
export class SensorsComponent {
  private game = inject(GameService);
  readonly rows = computed(() => {
    const L = this.game.level(), sim = this.game.sim();
    if (!L) return [];
    return L.rays.map((ray, i) => ({
      letter: LETTERS[i], ok: sim[i].ok,
      targetCol: LIGHT[ray.target], targetName: LIGHT_NAME[ray.target],
      gotCol: LIGHT[sim[i].final], gotName: LIGHT_NAME[sim[i].final]
    }));
  });
}
