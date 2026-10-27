import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BoardComponent, CellDown } from '../../components/board/board';
import { HowtoModalComponent } from '../../components/howto-modal/howto-modal';
import { MixerModalComponent } from '../../components/mixer-modal/mixer-modal';
import { PieceComponent } from '../../components/piece/piece';
import { SensorsComponent } from '../../components/sensors/sensors';
import { ShieldComponent } from '../../components/shield/shield';
import { TrayComponent } from '../../components/tray/tray';
import { VictoryModalComponent } from '../../components/victory-modal/victory-modal';
import * as E from '../../core/engine';
import { PieceCell } from '../../core/models';
import { DesignerService } from '../../services/designer.service';
import { GameService } from '../../services/game.service';
import { SoundService } from '../../services/sound.service';

/** Pantalla de juego: arma la partida según la ruta y maneja el arrastre entre bandeja y tablero. */
@Component({
  selector: 'app-game',
  imports: [BoardComponent, TrayComponent, SensorsComponent, ShieldComponent, PieceComponent, MixerModalComponent, HowtoModalComponent, VictoryModalComponent],
  templateUrl: './game.html',
  styleUrl: './game.scss',
  host: {
    '(window:pointermove)': 'onMove($event)',
    '(window:pointerup)': 'onUp($event)',
    '(window:pointercancel)': 'onUp($event)',
    '(document:keydown)': 'onKey($event)'
  }
})
export class GamePage {
  readonly game = inject(GameService);
  readonly sound = inject(SoundService);
  private router = inject(Router);
  private board = viewChild(BoardComponent);
  readonly mixer = signal(false);
  readonly howto = signal(false);

  constructor() {
    const route = inject(ActivatedRoute), designer = inject(DesignerService);
    const sub = route.paramMap.subscribe(pm => {
      const n = pm.get('n'), band = pm.get('band');
      if (route.snapshot.data['test']) {
        if (designer.testLevel) this.game.startCustom(designer.testLevel);
        else void this.router.navigate(['/admin']);
      } else if (band) this.game.startRandom(band);
      else this.game.startLevel(Math.max(0, Number(n) - 1));
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
    // acceso para pruebas automáticas desde la consola
    (window as unknown as { espectro: unknown }).espectro = { game: this.game, page: this };
  }

  /** Lo que se dibuja pegado al dedo mientras se arrastra. */
  readonly ghost = computed(() => {
    const d = this.game.drag();
    if (!d || !d.moved) return null;
    const s = this.board()?.geo().s ?? 56;
    if (d.kind === 'single') {
      const size = s * .62;
      return { single: true, t: d.t!, size, w: size + 8, h: size + 8, vb: `${-(size + 8) / 2} ${-(size + 8) / 2} ${size + 8} ${size + 8}`, x: d.x, y: d.y, transform: 'translate(-50%, -50%) scale(1.15)', cells: [] as PieceCell[] };
    }
    const cells = E.pieceCells(this.game.pieces()[d.pi!], d.k!);
    const g = cells[d.grab!];
    const w = (Math.max(...cells.map(x => x.dc)) + 1) * s, h = (Math.max(...cells.map(x => x.dr)) + 1) * s;
    return { single: false, t: '', size: s, w, h, vb: `${-s / 2} ${-s / 2} ${w} ${h}`, x: d.x, y: d.y, transform: `translate(${-(g.dc + .5) * s}px, ${-(g.dr + .5) * s}px)`, cells };
  });

  // ================= ARRASTRE Y TOQUES =================
  onSingleDown({ ev, t }: { ev: PointerEvent; t: string }): void {
    if (this.game.won()) return;
    this.sound.unlock();
    ev.preventDefault();
    if (this.game.remaining(t) <= 0) { this.sound.bad(); return; }
    this.game.drag.set({ kind: 'single', src: 'tray', t, sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY, moved: false, hover: null });
  }

  onPieceDown({ ev, pi }: { ev: PointerEvent; pi: number }): void {
    if (this.game.won()) return;
    this.sound.unlock();
    ev.preventDefault();
    if (this.game.pp()[pi]) { this.game.setStatus('Esa pieza ya está en el tablero. Tocala ahí para devolverla.'); return; }
    this.game.drag.set({ kind: 'piece', src: 'tray', pi, k: this.game.pRot()[pi], grab: 0, sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY, moved: false, hover: null });
  }

  onCellDown({ ev, k }: CellDown): void {
    const g = this.game;
    if (g.won() || !g.level()) return;
    this.sound.unlock();
    ev.preventDefault();
    const pm = g.pieceMap();
    if (pm.has(k)) {
      const pi = pm.get(k)!.pi, p = g.pp()[pi]!;
      const cells = E.pieceCells(g.pieces()[pi], p.k), [r, c] = E.toRC(k);
      const grab = cells.findIndex(x => x.dr + p.r === r && x.dc + p.c === c);
      g.drag.set({ kind: 'piece', src: 'board', pi, k: p.k, grab, sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY, moved: false, hover: null });
      return;
    }
    if (g.placed().has(k)) {
      g.drag.set({ kind: 'single', src: 'board', from: k, t: g.placed().get(k), sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY, moved: false, hover: null });
      return;
    }
    const sel = g.selection();
    if (typeof sel === 'number') {
      const kk = g.pRot()[sel], cells = E.pieceCells(g.pieces()[sel], kk), [r, c] = E.toRC(k);
      if (g.placePiece(sel, kk, r - cells[0].dr, c - cells[0].dc)) g.selection.set(null);
      return;
    }
    if (sel) {
      if (g.placeSingle(k, sel) && g.remaining(sel) <= 0) g.selection.set(null);
      return;
    }
    const I = g.info()!;
    if (I.fixed.has(k)) { g.setStatus('Ese escudo viene fijo con el nivel.', 'bad'); this.sound.bad(); }
    else if (I.placeable.has(k)) g.setStatus('Arrastrá un escudo o una pieza hasta acá.');
  }

  onMove(e: PointerEvent): void {
    const d = this.game.drag();
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 7) return;
    if (!d.moved) { this.game.selection.set(null); this.sound.pick(); }
    const hover = this.board()?.cellFromPoint(e.clientX, e.clientY) ?? null;
    this.game.drag.set({ ...d, moved: true, x: e.clientX, y: e.clientY, hover });
  }

  onUp(e: PointerEvent): void {
    const d = this.game.drag();
    if (!d) return;
    this.game.drag.set(null);
    const g = this.game;
    if (!d.moved) {
      if (d.src === 'tray') {
        const id = d.kind === 'piece' ? d.pi! : d.t!;
        g.selection.set(g.selection() === id ? null : id);
        this.sound.ui();
        if (d.kind === 'piece') g.setStatus(g.selection() !== null ? 'Pieza elegida. Tocá la celda donde va su primer escudo (o arrastrala).' : 'Selección quitada.');
        else g.setStatus(g.selection() ? 'Escudo elegido. Tocá una celda iluminada.' : 'Selección quitada.');
      } else if (d.kind === 'piece') g.removePiece(d.pi!);
      else g.removeSingle(d.from!);
      return;
    }
    const k = this.board()?.cellFromPoint(e.clientX, e.clientY) ?? null;
    if (d.kind === 'piece') {
      if (!k) {
        if (d.src === 'board') g.removePiece(d.pi!);
        else g.setStatus('Soltá la pieza sobre el tablero.');
        return;
      }
      const cells = E.pieceCells(g.pieces()[d.pi!], d.k!), [r, c] = E.toRC(k);
      const r0 = r - cells[d.grab!].dr, c0 = c - cells[d.grab!].dc;
      const cur = g.pp()[d.pi!];
      if (d.src === 'board' && cur && cur.r === r0 && cur.c === c0 && cur.k === d.k) return;
      g.placePiece(d.pi!, d.k!, r0, c0);
      return;
    }
    if (d.src === 'tray') {
      if (k && g.freeForSingle(k)) g.placeSingle(k, d.t!);
      else { this.sound.remove(); g.setStatus('Soltalo sobre una celda iluminada.'); }
    } else {
      if (k === d.from) return;
      if (k && g.freeForSingle(k)) g.placeSingle(k, d.t!, d.from!);
      else g.removeSingle(d.from!);
    }
  }

  onKey(e: KeyboardEvent): void {
    const g = this.game, key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); g.undo(); }
    else if (e.key === 'Escape') g.selection.set(null);
    else if (key === 'h') g.hint();
    else if (key === 'r') {
      const d = g.drag();
      if (d && d.kind === 'piece' && d.moved && !g.pieces()[d.pi!].norotate) {
        g.drag.set({ ...d, k: (d.k! + 1) % 4 });
        this.sound.rotate();
      } else if (typeof g.selection() === 'number') g.rotateTray(g.selection() as number);
    }
  }

  // ================= BOTONES =================
  back(): void { this.sound.ui(); void this.router.navigate([this.game.custom() ? '/admin' : '/niveles']); }
  hint(): void { this.sound.unlock(); this.game.hint(); }
  openMixer(): void { this.sound.ui(); this.mixer.set(true); }
  next(): void {
    this.sound.ui();
    this.game.showVictory.set(false);
    if (this.game.custom()) { void this.router.navigate(['/admin']); return; }
    const band = this.game.band();
    if (band) { this.game.startRandom(band); return; }
    const i = this.game.levelIndex(), n = i + 1 < this.game.levels.length ? i + 2 : i + 1;
    if (n === i + 1) this.game.startLevel(i);
    else void this.router.navigate(['/jugar', n]);
  }
  toLevels(): void { this.game.showVictory.set(false); this.back(); }
}
