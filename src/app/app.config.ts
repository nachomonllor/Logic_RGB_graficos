import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // rutas con # para que funcione en cualquier hosting estático (y dentro de Capacitor)
    provideRouter(routes, withHashLocation())
  ]
};
