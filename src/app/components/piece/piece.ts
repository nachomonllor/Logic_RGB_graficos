import { Component, computed, input } from '@angular/core';
import { PieceCell } from '../../core/models';
import { ShieldComponent } from '../shield/shield';

/** Pieza de varios escudos pegados. La celda (0,0) queda centrada en el origen; el paso entre celdas es step. */
@Component({
  selector: 'g[appPiece]',
  imports: [ShieldComponent],
  templateUrl: './piece.html',
  styleUrl: './piece.scss'
})
export class PieceComponent {
  readonly cells = input.required<PieceCell[]>();
  readonly step = input(50);
  /** Conectores (índices de celdas). Si no vienen, se unen todas las celdas vecinas. */
  readonly links = input<[number, number][] | undefined>(undefined);
  readonly locked = input(false);

  readonly vm = computed(() => {
    const step = this.step(), cells = this.cells();
    const links: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const add = (a: PieceCell, b: PieceCell) => links.push({ x1: a.dc * step, y1: a.dr * step, x2: b.dc * step, y2: b.dr * step });
    const lk = this.links();
    if (lk) lk.forEach(([i, j]) => { if (cells[i] && cells[j]) add(cells[i], cells[j]); });
    else {
      const at = new Map(cells.map(x => [x.dr + ',' + x.dc, x]));
      for (const x of cells) for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const y = at.get((x.dr + dr) + ',' + (x.dc + dc));
        if (y) add(x, y);
      }
    }
    return {
      step, tile: step * .62, links,
      tiles: cells.map(x => ({ t: x.t, transform: `translate(${x.dc * step} ${x.dr * step})` }))
    };
  });
}
