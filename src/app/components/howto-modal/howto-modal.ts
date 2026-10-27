import { Component, input, output } from '@angular/core';

/** Reglas del juego. */
@Component({
  selector: 'app-howto-modal',
  templateUrl: './howto-modal.html',
  styleUrl: './howto-modal.scss'
})
export class HowtoModalComponent {
  readonly open = input(false);
  readonly closed = output<void>();
}
