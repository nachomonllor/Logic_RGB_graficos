import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DesignBoardComponent } from '../../components/design-board/design-board';
import { ShieldComponent } from '../../components/shield/shield';
import { LEVELS } from '../../core/levels';
import { Dir, LETTERS, LIGHT, LIGHT_NAME } from '../../core/models';
import { DesignerService, Tool } from '../../services/designer.service';
import { SoundService } from '../../services/sound.service';

/** Sección admin: diseñador de niveles. */
@Component({
  selector: 'app-admin',
  imports: [DesignBoardComponent, ShieldComponent],
  templateUrl: './admin.html',
  styleUrl: './admin.scss'
})
export class AdminPage {
  readonly d = inject(DesignerService);
  readonly sound = inject(SoundService);
  private router = inject(Router);
  readonly rowsIn = signal(this.d.state().rows);
  readonly colsIn = signal(this.d.state().cols);
  readonly builtIn = LEVELS.map((l, i) => ({ i, label: `${i + 1}. ${l.name || l.group || 'Nivel'}` }));

  readonly tools: { id: Tool; icon: string; name: string; help: string }[] = [
    { id: 'glass', icon: '▢', name: 'Vidrio', help: 'Tocá un casillero para poner un vidrio del tipo elegido. Sobre un vidrio existente, le cambia el tipo. Podés arrastrar para pintar.' },
    { id: 'link', icon: '⛓', name: 'Conector', help: 'Tocá un vidrio cerca del lado que querés unir (norte, sur, este u oeste), o arrastrá de un vidrio al vecino. Los vidrios unidos forman una pieza.' },
    { id: 'lock', icon: '🔒', name: 'Candado', help: 'Tocá una pieza para dejarla fija. Lo que no tiene candado va a la bandeja del jugador.' },
    { id: 'block', icon: '▨', name: 'Bloquear', help: 'Marcá casilleros donde no se puede apoyar ningún vidrio. La luz igual los atraviesa.' },
    { id: 'projector', icon: '☀', name: 'Proyector', help: 'Tocá un lugar del borde (círculos punteados) o un casillero de adentro. Adentro usa la dirección elegida; tocalo de nuevo para girarlo. Un proyector frena los rayos que le llegan.' },
    { id: 'erase', icon: '⌫', name: 'Borrar', help: 'Saca vidrios (con sus conectores), proyectores y bloqueos.' }
  ];
  readonly glassTypes = ['', '-R', '-G', '-B', '+R', '+G', '+B'];
  readonly dirs: { id: Dir; icon: string }[] = [{ id: 'N', icon: '↑' }, { id: 'E', icon: '→' }, { id: 'S', icon: '↓' }, { id: 'W', icon: '←' }];

  readonly toolHelp = computed(() => this.tools.find(t => t.id === this.d.tool())!.help);

  readonly sensors = computed(() => {
    const st = this.d.state(), sim = this.d.sim();
    return st.emitters.map((e, i) => ({
      letter: LETTERS[i] ?? String(i + 1),
      hasTarget: e.target !== undefined,
      targetCol: e.target !== undefined ? LIGHT[e.target] : '#555',
      targetName: e.target !== undefined ? LIGHT_NAME[e.target] : 'sin objetivo',
      gotCol: LIGHT[sim[i]?.final ?? 7], gotName: LIGHT_NAME[sim[i]?.final ?? 7],
      ok: e.target !== undefined && sim[i]?.final === e.target
    }));
  });

  setTool(t: Tool): void { this.d.tool.set(t); this.sound.ui(); this.d.status.set(this.tools.find(x => x.id === t)!.help); }
  setGlass(t: string): void { this.d.glassType.set(t); this.d.tool.set('glass'); this.sound.ui(); }
  setDir(dir: Dir): void { this.d.projectorDir.set(dir); this.d.tool.set('projector'); this.sound.ui(); }
  applySize(): void { this.d.setSize(this.rowsIn(), this.colsIn()); this.rowsIn.set(this.d.state().rows); this.colsIn.set(this.d.state().cols); }

  test(): void {
    if (!this.d.state().emitters.length) { this.d.status.set('Poné al menos un proyector para probar.'); this.sound.bad(); return; }
    if (this.d.state().emitters.some(e => e.target === undefined)) this.d.takeTargets();
    this.d.testLevel = this.d.exportLevel();
    this.sound.ui();
    void this.router.navigate(['/probar']);
  }

  download(): void {
    const json = this.d.exportJson();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const name = (this.d.state().name || 'nivel').toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, '-');
    a.download = `espectro-${name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.d.status.set('Nivel exportado como JSON.');
    this.sound.ui();
  }

  upload(ev: Event): void {
    const input = ev.target as HTMLInputElement, file = input.files?.[0];
    if (!file) return;
    void file.text().then(t => { if (this.d.importJson(t)) { this.rowsIn.set(this.d.state().rows); this.colsIn.set(this.d.state().cols); } });
    input.value = '';
  }

  loadBuiltIn(ev: Event): void {
    const sel = ev.target as HTMLSelectElement;
    if (sel.value === '') return;
    this.d.importBuiltIn(+sel.value);
    this.rowsIn.set(this.d.state().rows); this.colsIn.set(this.d.state().cols);
    sel.value = '';
  }

  newDesign(): void { this.d.newDesign(); this.sound.remove(); }
  back(): void { this.sound.ui(); void this.router.navigate(['/niveles']); }
  num(ev: Event): number { return +(ev.target as HTMLInputElement).value; }
  text(ev: Event): string { return (ev.target as HTMLInputElement).value; }
  checked(ev: Event): boolean { return (ev.target as HTMLInputElement).checked; }
}
