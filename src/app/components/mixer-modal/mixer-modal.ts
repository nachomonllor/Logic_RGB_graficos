import { Component, computed, inject, input, output, signal } from '@angular/core';
import { LIGHT, LIGHT_NAME } from '../../core/models';
import { SoundService } from '../../services/sound.service';

/** Mezclador para practicar la suma de colores luz. */
@Component({
  selector: 'app-mixer-modal',
  templateUrl: './mixer-modal.html',
  styleUrl: './mixer-modal.scss'
})
export class MixerModalComponent {
  private sound = inject(SoundService);
  readonly open = input(false);
  readonly closed = output<void>();
  readonly on = signal({ R: true, G: true, B: true });

  readonly lights = [
    { ch: 'R' as const, x: 95, y: 82, col: '#ff0000', btn: '#ff4d5e' },
    { ch: 'G' as const, x: 145, y: 82, col: '#00ff00', btn: '#2fd47a' },
    { ch: 'B' as const, x: 120, y: 125, col: '#0000ff', btn: '#4d7cff' }
  ];
  readonly result = computed(() => {
    const o = this.on(), v = (o.R ? 4 : 0) + (o.G ? 2 : 0) + (o.B ? 1 : 0);
    return { col: LIGHT[v], name: LIGHT_NAME[v] };
  });

  toggle(ch: 'R' | 'G' | 'B'): void {
    this.on.update(o => ({ ...o, [ch]: !o[ch] }));
    this.sound.ui();
  }
}
