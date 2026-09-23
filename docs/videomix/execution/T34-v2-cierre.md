# T34 · v2: i18n, manual y cierre

- **Hito**: M8 · **Modelo**: Sonnet · **Depende de**: T24–T33 · **Estado**: hecha

## Alcance

1. `scan-i18n` y revisión del español.
2. Manual de usuario: todas las mejoras v2.
3. Proyecto de ejemplo en 9:16 con textos, lista de música y ducking, renderizado y revisado.
4. **Pendiente de T29**: al cambiar `settings.output.aspect`, reajustar las cajas de los overlays de imagen para conservar la proporción de la imagen, sin estirarla (centradas en su caja actual). Con test.
5. **Pendientes de T33**: ensanchar el campo de nombre del clip en `ClipList` y corregir en el manual que el `.vmx` es JSON5. Después de los cambios, ejecutar `yarn test-e2e`, que debe seguir en verde.
6. Revisión de atajos y menús nuevos.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

### Resumen de cambios

- **i18n (punto 1)**: `yarn scan-i18n` no encontró ninguna clave de VideoMix pendiente de traducir; el español ya estaba completo tras T24–T33. No hizo falta tocar `locales/es/translation.json`.
- **Manual (punto 2, `docs/videomix/manual-usuario.md`)**: reescrito para cubrir v2 completo:
  - intro y §1 (`.vmx` es JSON5, no JSON);
  - §3 nueva sección "Fijar y agrupar clips" (A4, T30) y mención a las miniaturas de la lista de clips (T31);
  - §5 tabla de Ajustes de montaje: proporción de salida (16:9/9:16/1:1), códec y codificador (software/hardware, T25), y la sección Música reescrita como §5.1 (lista de reproducción, fundido cruzado, bucle y *ducking*, T27); nota sobre el reajuste de las cajas de imagen al cambiar la proporción (punto 3);
  - §6 previsualización del plan: miniaturas de fondo, arrastrar fija un bloque; nueva §6.1 "Previsualización en vivo" (T32);
  - §7 overlays: quinto tipo (Texto, T26) con su animación de entrada, y nueva sección "Estilo" (aplicar/guardar/gestionar presets, T26);
  - §8 nueva §8.1 "Caché de render" (T28: qué es, "Vaciar caché de render", cómo se recorta sola) y su ajuste (`renderCacheMaxBytes`) en §10;
  - §9 atajos: comprobados uno a uno contra `allDefaultKeyBindings` (`src/main/configStore.ts`) — la tabla ya era exacta, así que no cambia; se añade una nota de que las acciones más nuevas (texto, fijar/agrupar, estilos, vaciar caché) no tienen atajo por defecto.
- **T29 pendiente (punto 3)**: al cambiar `settings.output.aspect`, las cajas de los overlays de imagen se reajustan para conservar la proporción real de la imagen, centradas en su caja anterior.
  - `overlayTimeline.ts`: `refitImageOverlayBox(box, imageSize, frame)` (nueva, pura, con test), hermana de `getImageBox` pero centrando en el centro de `box` en vez del centro del fotograma.
  - `projectReducer.ts`: la acción `updateSettings` gana `imageSizes?: ReadonlyMap<string, Size>`; si `patch.output.aspect` cambia y hay un tamaño conocido para un overlay de imagen, su caja se reajusta con `refitImageOverlayBox` sobre el nuevo `getOutputSize(settings.output)`; sin tamaño conocido (fichero no legible) la caja no se toca.
  - **Tamaño de la imagen**: no se guarda en el modelo (confirmado: `createImageOverlay`/`useMixOverlays.userAddImage` solo lo leen una vez, al añadirla, para ajustar la caja inicial, y lo descartan). Se lee de forma perezosa en `useMixProject.updateSettings`: si el `patch` cambia el aspecto, antes de despachar la acción se relee con `ffprobe` (`readFileFfprobeMeta`, el mismo camino que T22) el tamaño de cada overlay de imagen y se construye el mapa `imageSizes`, que viaja en la misma acción de despacho (un solo paso de deshacer). Es asíncrono (la función pasa a devolver una `Promise`, compatible con la prop `onChange: (patch) => void` de `MixSettingsDialog`) y best-effort: un fichero que ya no se puede leer simplemente deja la caja como estaba.
  - Tests: `overlayTimeline.test.ts` (`refitImageOverlayBox`: centrado, achicado si se sale del fotograma, entrada inválida) y `projectReducer.test.ts` (`updateSettings` con `imageSizes`: reajuste correcto y centrado, overlay sin tamaño conocido sin tocar, sin cambio de aspecto sin tocar, sin `imageSizes` sin tocar).
- **T33 pendiente (punto 4)**: en `ClipList.tsx` se bajan el icono de silencio y el selector de ganancia de la primera fila (con el asa, la miniatura, el número/color y el nombre) a la segunda fila (con la fuente, el tiempo y la duración), así el campo de nombre ocupa toda la anchura de la primera fila en vez de competir por sitio con ellos; se añade además `minWidth: '3em'` al campo para que nunca colapse a 0. Ningún `data-testid` ni comportamiento cambia (T33's e2e sigue en verde). Manual: ya corregido arriba (JSON5).
- **Ejemplo 9:16 (punto 5)**: `script/videomix/renderVerticalExample.ts` (nuevo), basado en `renderOverlaysExample.ts` pero con la planificación real (`planRender`, no un plan escrito a mano) para que fijar/agrupar sean exactamente lo que haría la app:
  - 4 clips a 720×1280 (9:16, resolución "720"), `maxColumns: 2` (hasta 2 filas a la vez): un clip fijado (`pinTime`) al principio, un grupo de 2 clips que aparecen juntos como 2 filas, y un cuarto clip suelto;
  - un texto ("¡Bienvenidos!... ") con animación de entrada (`entry: { kind: 'slide', from: 'bottom' }`);
  - música: lista de reproducción de 2 pistas (`music-20s.m4a`, `music-60s.mp3`) con fundido cruzado y *ducking* activado;
  - mide la sonoridad de cada clip y pista con ffmpeg real (como `renderOverlaysExample.ts`) y renderiza con `buildRenderJob`/`buildAudioGraph` reales (ffmpeg de `ffmpeg/linux-x64/lib`, medios de `generateTestMedia.ts`).
  - Comprobaciones: 720×1280 y duración por ffprobe; el clip fijado (con solo 4 clips cortos alrededor, no hay sitio para esperar hasta su `pinTime` sin hueco) se desplaza antes, con el aviso `pin-shifted` esperado — el planificador prefiere rellenar con otro clip disponible en vez de dejar un hueco en blanco, así que no hay ningún tramo sin ningún clip para medir el *ducking* de forma limpia; se deja como comprobación informativa (no falla el script) y ya está cubierto de forma exacta por `buildAudioGraph.ffmpeg.test.ts` (T27, con tonos generados).
  - Fotogramas extraídos y revisados con la herramienta Read (ver más abajo).
- **Menús y atajos (punto 6)**: revisados `src/main/menu.ts` y `allDefaultKeyBindings` (`src/main/configStore.ts`). Los ítems de menú nuevos de v2 (Ajustes de montaje, Vista previa, Renderizar, Vaciar caché de render) no llevan `accelerator` (se disparan por IPC y la app tiene su propio atajo de teclado, patrón ya fijado en T17/T33 para evitar que se disparen dos veces); los atajos nuevos de v2 (fijar/agrupar/estilos/caché) se ofrecen solo por menú contextual o de Proyecto, sin atajo por defecto. No se ha encontrado ningún conflicto (todas las combinaciones de `allDefaultKeyBindings` son únicas).

### Fotogramas revisados (script/videomix/renderVerticalExample.ts)

Con la herramienta Read sobre los PNG extraídos: el primer clip (barras de color SMPTE con su timecode) llenando el fotograma 720×1280; el bloque del grupo con las dos filas visibles a la vez, cada una con su propio clip y timecode; el texto "¡Bienvenidos! / Montaje de ejemplo" a mitad de su animación de entrada (deslizando desde abajo, parcialmente dentro del fotograma) y ya asentado en fotogramas posteriores, con su borde negro legible sobre el fondo de barras; el clip fijado en pantalla con el texto superpuesto; y el último fotograma antes del final, todo compuesto correctamente sin errores visuales.

### Validación

`yarn tsc`, `yarn lint`, `yarn test run` (788 tests), `yarn build` y `yarn test-e2e` (11/11, Xvfb) en verde.

### Dudas

- Ninguna que requiera consultar al usuario: T29 y T33 ya dejaban la decisión tomada por el orquestador (reajustar las cajas de imagen conservando su proporción; ensanchar el nombre del clip) y T34 solo pedía implementarla.

## Revisión

- **Resultado**: aceptada. `tsc`, `lint`, tests (788), `build` y `test-e2e` (11/11) en verde. Ejemplo 9:16 renderizado y revisado. Hito M8 cerrado.
