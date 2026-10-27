import { Routes } from '@angular/router';
import { GamePage } from './pages/game/game';
import { IntroPage } from './pages/intro/intro';
import { LevelsPage } from './pages/levels/levels';
import { AdminPage } from './pages/admin/admin';

export const routes: Routes = [
  { path: '', component: IntroPage, title: 'Espectro' },
  { path: 'niveles', component: LevelsPage, title: 'Espectro · Niveles' },
  { path: 'jugar/:n', component: GamePage, title: 'Espectro · Jugar' },
  { path: 'aleatorio/:band', component: GamePage, title: 'Espectro · Aleatorio' },
  { path: 'admin', component: AdminPage, title: 'Espectro · Diseñador' },
  { path: 'probar', component: GamePage, data: { test: true }, title: 'Espectro · Probar diseño' },
  { path: '**', redirectTo: '' }
];
