import { Injectable } from '@angular/core';
import { LIGHT } from '../core/models';

/** Lluvia de confeti luminoso sobre toda la pantalla. */
@Injectable({ providedIn: 'root' })
export class ConfettiService {
  burst(): void {
    let box = document.getElementById('confetti');
    if (!box) {
      box = document.createElement('div');
      box.id = 'confetti';
      document.body.appendChild(box);
    }
    const cols = Object.values(LIGHT).slice(0, 7);
    for (let k = 0; k < 70; k++) {
      const c = document.createElement('div');
      const col = cols[k % cols.length];
      c.className = 'confetto';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = col;
      c.style.boxShadow = `0 0 10px ${col}`;
      c.style.animationDuration = 1.8 + Math.random() * 1.8 + 's';
      c.style.animationDelay = Math.random() * .6 + 's';
      box.appendChild(c);
      setTimeout(() => c.remove(), 4400);
    }
  }
}
