# T51 · v5: atajos con cualquier foco y deshacer en todas las acciones (G4)

- **Hito**: M12 · **Modelo**: Opus · **Depende de**: — · **Estado**: en curso

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§13 (v5)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- `src/renderer/src/hooks/useKeyboard.ts` (`if (e.target !== document.body) return;` y la alternativa comentada), `videomix/hooks/useMixClips.ts` (`dispatchMerged`/`dispatchStep`, `undo`), `useMixProject.ts`, `projectHistory.ts`, `useMixClipPins.ts`, `useClipKeyframes.ts`, `MixPlanView.tsx`, `e2e/app.ts` (`pressShortcut` quita el foco antes de pulsar: por eso los e2e no lo detectaban).

## Alcance

1. **Reproducir primero** en un e2e (sin quitar el foco): pulsar "Ajustar a 1/2" (o cualquier botón) y después Ctrl+Z → hoy no deshace.
2. **Atajos con cualquier foco salvo edición de texto**: se ignoran solo si el foco está en `input` de texto/número, `textarea`, `select` o `contentEditable` (incluidos los *sliders* `input[type=range]` y *checkboxes* si capturan teclas: decide y documenta). Con el foco en un botón u otro elemento activable, **Espacio e Intro** los maneja el elemento (no se disparan también los atajos ligados a esas teclas); el resto de atajos sí funcionan. Revisa que no haya dobles disparos (menú nativo con acelerador y atajo propio) ni regresiones en diálogos (Esc, Radix).
3. **Auditoría de deshacer** en VideoMix: cada acción de usuario crea exactamente un paso de historial y Ctrl+Z / Ctrl+Mayús+Z la deshacen/rehacen, sea cual sea el foco. Mínimo: arrastres y fijaciones en la vista Mix (A4: mover, fijar, agrupar, secuencia), edición de clips (tiempos, nombre, color, audio, ganancia, enlaces, giro, ampliar), rectángulos (arrastre, teclas, barra del editor), keyframes (Animar, auto-key, añadir, borrar, interpolación), overlays, ajustes del proyecto. Lo que falte o esté mal, se corrige. Lista de la auditoría en las notas.
4. **e2e**: `pressShortcut` deja de quitar el foco por defecto (opción explícita solo donde haga falta y justificado). Escenario nuevo que cubra deshacer tras clic en botones de la barra del editor, en la vista Mix y en keyframes.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

## Revisión
