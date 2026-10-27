import { Component, computed, inject, output } from '@angular/core';
import * as E from '../../core/engine';
import { GameService } from '../../services/game.service';
import { PieceComponent } from '../piece/piece';
import { ShieldComponent } from '../shield/shield';

/** Bandeja con las piezas (con botón de giro) y los escudos sueltos con su contador. */
@Component({
  selector: 'app-tray',
  imports: [ShieldComponent, PieceComponent],
  templateUrl: './tray.html',
  styleUrl: './tray.scss'
})
export class TrayComponent {
  readonly game = inject(GameService);
  readonly singleDown = output<{ ev: PointerEvent; t: string }>();
  readonly pieceDown = output<{ ev: PointerEvent; pi: number }>();

  readonly pieces = computed(() => {
    const step = 40, sel = this.game.selection();
    return this.game.pieces().map((p, pi) => {
      const cells = E.pieceCells(p, this.game.pRot()[pi] || 0);
      const w = Math.max(...cells.map(x => x.dc)) + 1, h = Math.max(...cells.map(x => x.dr)) + 1;
      return { pi, cells, step, w: w * step, h: h * step, used: !!this.game.pp()[pi], sel: sel === pi, rotatable: !p.norotate };
    });
  });

  readonly singles = computed(() => {
    const L = this.game.level(), sel = this.game.selection();
    this.game.placed();
    if (!L) return [];
    return E.TYPES.filter(t => L.inv[t]).map(t => ({ t, n: this.game.remaining(t), sel: sel === t }));
  });

  rotate(ev: Event, pi: number): void {
    ev.stopPropagation();
    this.game.rotateTray(pi);
  }
}
