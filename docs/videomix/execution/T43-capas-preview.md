# T43 · Diálogos y avisos tapados por la previsualización en vivo

- **Hito**: M10 · **Modelo**: Opus · **Depende de**: T41, T42 · **Estado**: hecha

## Objetivo

El diagnóstico de T41 encontró que, en la pestaña Mix, `MixLivePreview` (`z-index: 1` en el contexto de apilamiento raíz) se pinta **encima** del `Working` heredado y de los diálogos centrados de Radix (ver la captura `test-results/e2e-screenshots/08a-preview-dialog.png`: la previsualización tapa el diálogo "Mix preview"). T41 solo lo resolvió para su modal (`z-index: 2`). Hay que arreglarlo de forma general.

## Alcance

1. Que **todos** los diálogos, el `Working`, los toasts (SweetAlert), los menús contextuales y los desplegables de Radix (incluidos los que se abren dentro de un diálogo) queden por encima de la previsualización en vivo. Averigua por qué `MixLivePreview` necesita `z-index` y por qué `isolation: isolate` en el contenedor del reproductor rompió el dibujado de fotogramas (e2e 7): elige la solución de raíz más pequeña (p. ej. quitar o rebajar ese `z-index`, o subir de forma coherente las capas de los portales) y documenta la causa.
2. Una vez resuelto de forma general, simplificar el `LAYER` de `RenderProgressDialog` si ya no hace falta.
3. **Decisión del orquestador sobre T42**: "Borrar caché de render" (`userClearRenderCache` en `useMixRender.ts`) debe **conservar** la carpeta `converted/` (las conversiones son de previsualización, pueden ser lentas y no son caché de render). Ajustar el código, un test si hay lógica pura, y el manual (que ahora dice que se borran).
4. **e2e**: comprobar con `elementFromPoint` (como hace el helper de T41) que el diálogo "Mix preview" del escenario 8a y el `Working` (alguna operación en la pestaña Mix que lo use) no quedan tapados; revisar las capturas.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde (el e2e 7, que dibuja fotogramas en la previsualización, incluido).

## Notas de ejecución

### Causa

- `MixLivePreview` es un hermano posicionado (`position: absolute`) dentro del contenedor del reproductor de `App.tsx`. Ese `z-index: 1` (T32) no hacía falta para tapar el reproductor (el `<video>` y el `ClipRectEditor` van **antes** en el DOM), sino para tapar los hermanos que van **después**: el control de volumen y el selector de pistas, el menú "Show sidebar", `BigWaveform`, la etiqueta del reproductor asistido por FFmpeg y la barra roja de pantalla completa (la nota de T32 lo dice: "la previsualización tapa también el control de volumen y el selector de pistas").
- Ningún otro elemento de la app usa `z-index` (ni `Working`, ni `Dialog.module.css`/`AlertDialog.module.css`, ni los menús desplegables de Radix, cuyo `Popper` copia el `z-index` del contenido, `auto`). Todos ellos pintan por orden del documento dentro del contexto de apilamiento raíz, y cualquier elemento con `z-index: 1` pinta después de todos los de `z-index: auto`: por eso la previsualización quedaba encima de `Working` y de todos los diálogos y menús (portados al final de `#app-root`). SweetAlert (toasts y `swal`) usa `z-index: 1060` y no estaba afectado.
- **`isolation: isolate`** (el intento de T41): no he podido reproducir que rompa el dibujado de fotogramas. Con `isolation: isolate` en el contenedor del reproductor y el `z-index: 1` original, el e2e 7 (fotogramas con `getImageData`) pasa; en la primera pasada falló el 8a en la medida de audio `farFromKeyframe` (el *flaky* conocido de T40, que también vio T42 con ejecuciones concurrentes) y en la segunda pasaron los 12 escenarios. Lo más probable es que T41 lo viera durante sus ejecuciones en paralelo con T42 (compartían `out/` y `test-results/`). De todos modos no lo he usado: crear un contexto de apilamiento nuevo solo para contener un `z-index` innecesario es peor que quitarlo.

### Arreglo

- **Quitar el `z-index` de `MixLivePreview` y pasarlo a ser el último hijo del contenedor del reproductor** (`App.tsx`: se mueve una línea). Así sigue tapando todos los controles del reproductor solo por orden del documento, y todo lo que va después en `#app-root` (`Working`, `RenderProgressDialog`, `GenericDialog`, `ErrorDialog`, y los portales de `Dialog`/`AlertDialog`/`DropdownMenu`, que se añaden al final de `#app-root`, incluidos los desplegables abiertos dentro de un diálogo) queda por encima sin tocar ninguna capa. Comportamiento igual que antes con la pestaña Mix (el volumen y el selector de pistas siguen tapados).
- `RenderProgressDialog`: fuera la constante `LAYER` y los `zIndex` del overlay y del contenido (ya no hacen falta; lo cubre `expectRenderProgress` en 8b).
- **"Borrar caché de render" conserva `converted/`** (decisión del orquestador sobre T42): función pura nueva `clearRenderCache({ root, keep, deps, join })` en `render/renderCache.ts` que borra las entradas de la raíz salvo las de `keep` y devuelve los bytes liberados (sin contar lo conservado); si no se conserva nada, borra la raíz entera como antes. `userClearRenderCache` la llama con `keep: [PREVIEW_CONVERSION_DIR_NAME]` para la raíz del proyecto y la carpeta de proyectos sin guardar (allí no hay `converted/`: las conversiones sin proyecto guardado van junto a la fuente). 3 tests en `previewConversion.test.ts` (conserva `converted/` y cuenta solo lo borrado; sin nada que conservar borra la raíz; solo convertidos → no borra nada, 0 bytes).
- Manual §8.1 (y `04-diseno.md`, § caché): los convertidos no se borran con "Vaciar caché de render"; se explica cómo liberar ese espacio a mano.

### e2e

- Helper `isOnTop(locator)` (lo que hay en el centro del elemento es el propio elemento, activando un momento los eventos de puntero del `body` que desactiva el diálogo modal), extraído de `expectRenderProgress` (T41), que ahora lo usa.
- **8a**: el diálogo "Mix preview" está arriba (`isOnTop`), antes de la captura `08a-preview-dialog.png`.
- **8a (final)**: con la pestaña Mix a la vista se activa otra fuente (sale `Working` "Loading file"). Como dura muy poco para comprobarlo con *polling*, un `MutationObserver` instalado antes del clic mira con `elementFromPoint`, en cuanto aparece `Working`, qué hay en el centro de la previsualización: debe ser `Working`. Después se espera a que cargue la fuente (los escenarios siguientes seleccionan sus clips, así que no dependen de la fuente activa).
- Comprobado que ambos chequeos fallan con el código anterior (App.tsx de HEAD con `z-index: 1`): primero el del diálogo y, con ese desactivado temporalmente, el de `Working`.

### Ficheros tocados

- `src/renderer/src/App.tsx` (se mueve la línea de `MixLivePreview` al final del contenedor del reproductor, con comentario).
- `src/renderer/src/videomix/components/MixLivePreview.tsx` (sin `zIndex`).
- `src/renderer/src/videomix/components/RenderProgressDialog.tsx` (sin `LAYER`).
- `src/renderer/src/videomix/render/renderCache.ts` (`clearRenderCache`), `src/renderer/src/videomix/hooks/useMixRender.ts` (`userClearRenderCache`), `src/renderer/src/videomix/previewConversion.test.ts` (3 tests).
- `e2e/videomix.e2e.ts` (helper `isOnTop`, 8a).
- `docs/videomix/manual-usuario.md` §8.1, `docs/videomix/04-diseno.md`.

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (83 ficheros, 1003 tests), `yarn build`: en verde.
- `yarn test-e2e`: 18/18 en verde (1,3 min), incluido el 7 (dibuja fotogramas). Capturas revisadas: en `08a-preview-dialog.png` el diálogo "Mix preview" y su velo quedan por encima de la previsualización; en `07-live-preview.png` la previsualización sigue tapando el control de volumen y el toast "Project saved" (swal) queda encima.

## Revisión

- **Resultado**: aceptada. Causa raíz: `z-index: 1` innecesario en `MixLivePreview`; se quita y se coloca al final del contenedor.
- **Validación del orquestador**: tsc, lint, 1003 tests y e2e 18/18.
