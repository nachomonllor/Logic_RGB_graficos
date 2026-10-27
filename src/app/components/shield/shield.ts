import { Component, computed, input } from '@angular/core';
import { parts } from '../../core/engine';
import { CHANNEL_COLOR, Channel } from '../../core/models';

interface ShieldPart { label: string; col: string; add: boolean; y: number; }

/** Escudo dibujado en SVG, centrado en (0,0). Se usa como <g appShield [t]="'-R'" [size]="40">. */
@Component({
  selector: 'g[appShield]',
  templateUrl: './shield.html',
  styleUrl: './shield.scss'
})
export class ShieldComponent {
  readonly t = input.required<string>();
  readonly size = input(40);
  readonly locked = input(false);

  readonly vm = computed(() => {
    const s = this.size(), h = s / 2, ps = parts(this.t());
    const list: ShieldPart[] = ps.map((p, i) => ({
      label: (p[0] === '+' ? '+' : '−') + p[1],
      col: CHANNEL_COLOR[p[1] as Channel],
      add: p[0] === '+',
      y: -h + s * .1 + i * s * .41
    }));
    return { s, h, glass: list.length === 0, single: list.length === 1, list };
  });
}
