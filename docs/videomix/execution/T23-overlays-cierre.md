# T23 · Overlays: i18n, manual y revisión final

- **Hito**: M7 · **Modelo**: Sonnet · **Depende de**: T20, T21, T22 · **Estado**: hecha

## Objetivo

Cerrar el hito de overlays.

## Alcance

1. `scan-i18n` y revisión del español de todas las claves nuevas.
2. **Manual de usuario**: sección de imágenes, contadores, barras y efectos de sonido (anclajes, edición y ejemplos típicos, como una cuenta atrás de 10 s con barra y un pitido al terminar).
3. **Proyecto de ejemplo** en `script/videomix/` (o una ampliación de `renderPlan.ts`) que use los cuatro tipos con `test-media`. Renderízalo y revisa fotogramas y audio.
4. **Formato del contador** (decisión tras T20): si la duración es ≥ 60 s, `M:SS` durante toda la cuenta. Hay que ajustar `overlayFrames.getCountdownTextAt` y `overlayFilters` (una sola `drawtext`), con sus tests.
5. Añadir los avisos de tiempo de los overlays (recortado, fuera del vídeo) a la confirmación previa al render, si T22 no lo ha hecho.
6. **Pendientes de T22**: pasar `overlayName` a `getIssueText` desde `useMixRender`; unificar el texto del contador de la mini vista con `overlayFrames.getCountdownTextAt`; que "Replace…" limpie el aviso de fichero no encontrado.
7. Revisión de los atajos, si se añadieron.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

### Resumen de cambios

- **Formato del contador (punto 4)**: `overlays/overlayFrames.ts` — `getCountdownMinutesThreshold`/`getCountdownSecondsFormatFrames` (per-valor) sustituidos por `getCountdownMinutesFormat(frames, fps)`, que decide una sola vez por la **duración sin recortar** (`rawEnd − rawStart ≥ 60·fps`), como decidió el orquestador en la revisión de T20. `formatCountdown` recibe ahora `minutesFormat: boolean` en vez de decidirlo internamente; `getCountdownTextAt` lo calcula y se lo pasa. `render/overlayFilters.ts#addCountdown` genera ya una única `drawtext` (se quitan `switchFrame`/`phases`): el texto (`minutesText` o `secondsText`) se elige una vez con `getCountdownMinutesFormat({rawStart:raw.start, rawEnd:raw.end}, fps)`. Tests actualizados en `overlayFrames.test.ts` y `overlayFilters.test.ts` (el de "switches from M:SS to SS" pasa a comprobar que se mantiene `M:SS` toda la cuenta con duración ≥ 60 s, y `SS` toda la cuenta por debajo). El snapshot de `overlayFilters.test.ts` no cambia (su contador de prueba dura 2 s). `overlayFilters.ffmpeg.test.ts` no necesitaba cambios (su contador dura 2,5 s) y sigue en verde con ffmpeg real.
- **Mini vista del contador (punto 6, unificación con T20)**: `overlayTimeline.ts` — `OverlayFrameBox` gana el campo `times` (el resuelto de T19, ya calculado en `getOverlayFrameBoxes`); se quita `formatCountdownText` (y su test), que quedaba obsoleta y con la regla de formato antigua (por valor). `components/MixPlanView.tsx#OverlayBoxContent` recibe ahora `fps` y usa `overlayFrames.getOverlayFrames` + `getCountdownTextAt`, con el fotograma acotado a `[frames.start, frames.end)` para que el elemento seleccionado siga mostrando un valor aproximado cuando no está en pantalla (igual que antes, pero con el mismo cálculo que el render).
- **`overlayName` en `getIssueText` (punto 6)**: `hooks/useMixRender.ts#prepare` construye `overlayNameById` y una función `issueText(issue)` que pasa `overlayName` cuando el aviso tiene `overlayId` (los avisos de overlays de `validateMixProject` ya mostraban el id como respaldo; ahora muestran el nombre).
- **Avisos de tiempo de overlays en la confirmación previa (punto 5)**: `hooks/useMixRender.ts#prepare` resuelve `resolveOverlayTimes(project, renderPlan.plan, { soundDurations: getKnownSoundDurations(project.overlays) })` (la caché de sonidos ya sondeados por la UI, T22 `useOverlaySoundDurations`, sin I/O nueva) y añade una línea traducida por cada aviso (`overlayTexts.getOverlayTimeWarningText`, ya cubre recortado/fuera de vídeo/ciclo/referencia rota/duración desconocida) a `warningLines`, con la nueva clave `Overlay "{{overlay}}": {{warning}}`. El render (`render()`) sigue resolviendo los tiempos otra vez con las duraciones exactas de la medida de sonoridad (T21): esta resolución en `prepare` es solo para el texto de la confirmación.
- **"Replace…" limpia el aviso de fichero no encontrado (punto 6)**: `hooks/useMixWorkspace.ts` extrae `clearMissingOverlayFile(overlayId, kind)` (usada también por `userLocateOverlayFile`) y la expone; `hooks/useMixOverlays.ts` gana el parámetro opcional `onFileReplaced`, llamado desde `userChooseOverlayFile` tras `relinkOverlayFile`; `App.tsx` conecta `onFileReplaced: mixWorkspace.clearMissingOverlayFile`.
- **Atajos (punto 7)**: T22 no añadió atajos de teclado propios de los overlays (no hay nada en `useKeyboard.ts`/`KeyboardShortcuts.tsx`); no hace falta ningún cambio ni en el manual.
- **`scan-i18n` (punto 1)**: una clave nueva (el aviso de tiempo de overlays); traducida al español. El resto de claves de T19-T22 ya estaban traducidas.
- **Manual de usuario (punto 2)**: nueva sección "7. Elementos superpuestos: imágenes, cuentas atrás, barras y sonidos" en `docs/videomix/manual-usuario.md` (carriles, añadir, mover/redimensionar/colocar, panel de propiedades, un ejemplo típico de cuenta atrás + barra vinculada + pitido al terminar, avisos y ficheros que faltan), con las secciones siguientes renumeradas (8 Previsualizar y renderizar, 9 Atajos, 10 Otros ajustes) y una mención en la introducción.
- **Proyecto de ejemplo (punto 3)**: `script/videomix/generateTestMedia.ts` gana `overlay-logo.png` (PNG transparente, círculo, vía `geq`) y `overlay-beep.wav` (pitido de 0,5 s con *fade out*; 0,3 s resultó ser demasiado corto para que `loudnorm` lo mida — ver "Dudas"). Nuevo `script/videomix/renderOverlaysExample.ts` (no una ampliación de `renderPlan.ts`: monta su propio plan fijo de un solo clip, más simple que pasar por el planificador) que:
  - construye un proyecto con un clip de 11 s (`v-1080x1920-12s.mp4`, recortado a 11 s) y los cuatro tipos de overlay: una cuenta atrás de 10 s arriba a la derecha, una barra vinculada a ella abajo, un logo PNG con *fade* anclado al inicio del clip y un pitido anclado al **fin** de la cuenta atrás (el vídeo dura 1 s más que la cuenta atrás para que el pitido, que empieza justo cuando llega a 0, quepa entero);
  - **mide la sonoridad con ffmpeg directamente** (`loudnorm`/`ffprobe`, replicando el algoritmo de `src/main/videomix/loudness.ts`; reutiliza sin cambios `src/main/videomix/loudnessParse.ts` y `getFixChannelLayoutFilter` de `src/common/util.ts`, que no tienen imports problemáticos para un script de Node), así que el pitido suena con su normalización real en vez del silencio de `renderPlan.ts`;
  - renderiza con el código de producción (`buildRenderJob`/`buildVideoGraph`/`buildAudioGraph`, cargados con `rendererImports.ts`), extrae 4 fotogramas (medio *fade* del logo, contador+barra a la mitad, contador cerca de 0, justo tras el pitido) y comprueba con `ffmpeg -af astats` que el pitido resalta sobre el ruido de fondo (RMS ≥ 2 dB más alto) en la ventana que sigue al fin de la cuenta atrás.
  - Ejecutado (`node script/videomix/renderOverlaysExample.ts`, ffmpeg real de `ffmpeg/linux-x64`): overlays resueltos sin avisos, `OK: the beep is clearly louder…`. Fotogramas revisados con la herramienta Read: `10` con el círculo semitransparente a mitad de *fade* (t=0,25 s); `5` con la barra ~60 % llena (t=5 s); `1` con la barra casi llena (t=9,7 s); contador y barra ya desaparecidos justo después del fin (t=10,067 s, el "+" que se ve es la marca propia de `testsrc2`, no un overlay).

### Dudas

- **Pitidos muy cortos y `loudnorm`**: un `sine` de 0,3 s hace que `loudnorm` (con la configuración de T21/T12b, sin ventana mínima especial) devuelva `input_i: "-inf"`, que `toLoudnessAnalysis` trata como silencio (`hasAudio: false`, por debajo de `SILENCE_LOUDNESS = -70`). Esto no es un problema introducido por T23, sino una limitación de `loudnorm` con clips muy cortos que ya existía en `measureLoudness` (T21) para *cualquier* efecto de sonido de menos de ~0,4 s: en la app real, un efecto así de corto se oiría como silencio. No es señalado como aviso al usuario (no hay ningún `unknown-duration`-like para "silencioso por ser muy corto"; `resolveOverlayTimes` solo avisa si la duración es *desconocida*, no si la medida sale silenciosa). Lo documento aquí porque lo encontré construyendo el proyecto de ejemplo (con 0,3 s) y lo evité subiendo la duración del pitido de prueba a 0,5 s; no lo he arreglado en `loudness.ts` porque no estaba en el alcance de esta tarea y afecta a T21, ya cerrada. El orquestador puede decidir si merece una tarea propia (p. ej. una ventana mínima o un aviso "efecto demasiado corto para medir su volumen").
- El resto de decisiones (formato del contador, `resolved` en los borrados, etc.) ya estaban tomadas por el orquestador en las revisiones de T19-T22; no ha habido más dudas bloqueantes.

### Validación

`yarn tsc`, `yarn lint`, `yarn test run` (524 tests, 44 ficheros) y `yarn build` en verde. `yarn scan-i18n` sin claves nuevas sin traducir. `overlayFilters.ffmpeg.test.ts` (ffmpeg real) y `script/videomix/renderOverlaysExample.ts` (ffmpeg real) ejecutados y en verde.

## Revisión

- **Resultado**: aceptada. `tsc`, `lint`, tests (524) y `build` en verde. Proyecto de ejemplo renderizado y verificado (fotogramas y posición del pitido).
- **Duda sobre sonidos muy cortos** (< ~0,4 s, que `loudnorm` no mide): es un problema real, porque los pitidos de cuenta atrás suelen ser así de cortos. Se corrige en T21b.
