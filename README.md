# Espectro (Angular)

Juego de rayos de luz y escudos de color. Port de la versión en un solo HTML.

## Correr

```bash
npm install
npm start          # http://localhost:4200
npm run build      # salida en dist/espectro-angular/browser
```

## Estructura

```
src/app/
  core/
    models.ts        tipos (Level, Ray, Piece...) y colores
    engine.ts        motor puro: simulación de la luz, solvers y generadores (sin Angular)
    levels.ts        los 30 niveles verificados
  services/
    game.service.ts      estado de la partida con signals y todas las acciones (poner, sacar, deshacer, pista, victoria)
    progress.service.ts  progreso del jugador + interfaz ProgressStore (hoy localStorage)
    sound.service.ts     efectos con Web Audio
    confetti.service.ts
  components/
    board/   tablero SVG          tray/   bandeja de escudos y piezas
    shield/  escudo (g[appShield]) piece/ pieza pegada (g[appPiece])
    sensors/ lista de sensores     mixer-modal/ howto-modal/ victory-modal/
  pages/
    intro/   presentación          levels/  selector de niveles        game/  partida + arrastre
```

Rutas: `#/`, `#/niveles`, `#/jugar/:n`, `#/aleatorio/:band` (easy, mid, hard, combo), `#/admin` (diseñador), `#/probar`.

## Diseñador de niveles (`#/admin`)

- Tablero de 3 × 3 hasta 20 × 20.
- Herramientas: **Vidrio** (transparente, −R, −G, −B, +R, +G, +B), **Conector** (une vidrios vecinos por el lado N, S, E u O; los vidrios unidos forman una pieza), **Candado** (la pieza queda fija), **Bloquear** (casillero sin vidrios), **Proyector** (en el borde o adentro, con dirección; frena los rayos que le llegan) y **Borrar**.
- La luz se ve en vivo mientras diseñás.
- **Tomar colores actuales como objetivo**: cada sensor pide el color que le llega con tu diseño.
- **Verificar con el solver**: avisa si hay más de una solución (y te la muestra) o si sobra alguna pieza.
- **Probar nivel**, **Exportar / Importar JSON** y **Abrir un nivel del juego** para editarlo.
- El borrador se guarda solo en el navegador.

Archivos: `services/designer.service.ts` (estado y reglas del diseñador), `components/design-board/` (tablero), `pages/admin/` (paneles). El motor ahora soporta proyectores internos, vidrios transparentes y piezas con conectores (`core/engine.ts`), y el dibujo de la luz es compartido (`core/render.ts`).

## Próximos pasos

- **Puntajes**: `GameService.checkWin()` ya arma el resultado (`stars`, `timeMs`, `hints`) y lo pasa a `ProgressService.record()`. Ahí se puede calcular un puntaje.
- **Supabase**: escribir una clase `SupabaseProgressStore implements ProgressStore` (métodos `getAll` y `save`) y registrarla en `app.config.ts`:
  `{ provide: PROGRESS_STORE, useClass: SupabaseProgressStore }`. El resto del juego no cambia.
