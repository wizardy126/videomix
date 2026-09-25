# T47 · v4: sugerencia de recorte, bandas negras (A7)

- **Hito**: M11 · **Modelo**: Sonnet · **Depende de**: T44 · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- Lógica de T44 (parseo de `cropdetect`, rect inicial) y sus notas. `src/main/videomix/loudness.ts` y `thumbnails.ts` como patrón de proceso ffmpeg en main expuesto al renderer; creación de clips (`videomix/clips.ts`, `hooks/useMixClips.ts`).

## Alcance

1. **Main**: `detectBlackBars({ filePath, start, end, abortSignal })` con `cropdetect` sobre varias muestras repartidas en el tramo (rápido: pocas decenas de fotogramas por muestra, *seek* por entrada). Test con ffmpeg real sobre un medio de prueba con bandas negras (añadirlo a `generateTestMedia.ts`, p. ej. 16:9 con barras superior e inferior, y otro con barras laterales).
2. **Por fuente, en segundo plano**: al añadir o activar una fuente sin detección válida, se detecta (sobre toda la fuente) y se guarda en el proyecto (caché, sin historial). Con `autoCropBlackBars` activo, los clips **nuevos** de esa fuente nacen con el máx. sin bandas (si la detección aún no ha terminado, nacen como hoy).
3. **Botón "Quitar bandas negras"** en la barra del editor: analiza **el tramo del clip** y ajusta el máx. (un paso de historial; el mín. se recorta para seguir dentro; aviso si no hay bandas).
4. Ajuste `autoCropBlackBars` en el diálogo de ajustes del proyecto.
5. i18n (en + es).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde; e2e: fuente con bandas → clip nuevo sin bandas; botón en un clip existente.

## Notas de ejecución

### Resumen

- **Main** (`src/main/videomix/blackBars.ts`): `detectBlackBars({ filePath, start, end, abortSignal })` ejecuta `cropdetect` sobre 1–5 muestras repartidas en `[start, end)` (una cada `MIN_SAMPLE_SPACING` = 1 s, hasta `MAX_SAMPLES` = 5), cada una con *seek* de entrada (`-ss` antes de `-i`, rápido y aproximado) y `SAMPLE_FRAMES` = 30 fotogramas (`-frames:v`). Las salidas se concatenan y se pasan a `parseCropDetectOutput` (T44, `src/common/videomix/cropDetect.ts`), que ya hace la unión de varias líneas. Expuesto como `videomix.detectBlackBars` en `remoteApiLegacy` (`src/main/index.ts`), mismo patrón que `measureLoudness`.
- **Renderer, glue** (`videomix/hooks/useBlackBars.ts`, nuevo): sobre la lógica pura de T44 (`blackBars.ts`: `cropDetectToDisplayRect`, `getPictureRect`, `createBlackBarsDetection`, `isBlackBarsDetectionValid`, `removeBlackBarsFromRects`):
  - **Detección por fuente en segundo plano** (A7 (3)): un efecto recorre `project.sources`; para cada una con tamaño conocido, `autoCropBlackBars` activo y sin detección válida (`isBlackBarsDetectionValid` sin `stat`, igual que `getNewClipMaxRect`), detecta sobre toda la fuente (`[0, duration)`) y cachea con `setSourceBlackBars` (T44: sin paso de historial ni `dirty`). *Fire-and-forget*, como `refreshSourcesMeta`; un `Set` en un ref evita relanzar la detección de una fuente que ya está en curso.
  - **Botón "Quitar bandas negras"**: `userRemoveBlackBars(clipId)` detecta en fresco sobre `[clip.start, clip.end)` (no la caché de la fuente), convierte a píxeles de visualización, `getPictureRect` en el fotograma de la fuente, lo gira al fotograma del clip (`rotateRect`, E9) y aplica `removeBlackBarsFromRects`; sin bandas o clip/fuente desconocidos → aviso (toast). Un paso de historial. Usa el patrón `workingRef`/`setWorking`/`withErrorHandling` habitual de las operaciones de main.
- **Clips nuevos con `autoCropBlackBars`**: `createClip` (`clips.ts`) ahora recibe el `maxRect` ya resuelto por el llamador, en vez de calcularlo desde `frameSize`; los dos sitios que crean clips —`useMixClips.userAddClip` ("Añadir clip") y `clipSegments.ts#getClipActionsFromSegments` (sincronización con la línea de tiempo de LosslessCut: nuevos segmentos, splits)— usan `getNewClipMaxRect({ source, autoCropBlackBars }) ?? getFrameRect(frameSize)` (T44). Así un clip nacido desde cualquier flujo de creación respeta el ajuste y la caché de la fuente.
- **Ajuste de proyecto**: interruptor "Remove black bars automatically" en la sección "Composition" de `MixSettingsDialog.tsx` (`autoCropBlackBars`, T44 ya lo definía en el modelo v5 con `true` por defecto).
- **Botón en la barra del editor**: "Remove black bars" en `RectOverlayToolbar.tsx`, junto a "Fill frame" (`data-testid="remove-black-bars"`).
- **Medios de prueba** (`script/videomix/generateTestMedia.ts`, `docs/videomix/06-entorno-desarrollo.md`, `e2e/run.ts`): `h-bars-1280x960-6s.mp4` (contenido 1280×720 con bandas arriba/abajo de 120 px) y `v-bars-960x1280-6s.mp4` (contenido 720×1280 con bandas a los lados de 120 px). El contador de tiempo se superpone **antes** del `pad` (sobre el contenido), para que las bandas queden puramente negras y no interfieran con `cropdetect`.
- i18n en + es.

### Decisiones

- **Detección por fuente solo con `autoCropBlackBars` activo**: si el ajuste está desactivado, el efecto en segundo plano no gasta CPU detectando algo que no se va a usar (el botón "Quitar bandas negras" de un clip siempre detecta en fresco, no depende de esta caché). Al activar el ajuste más tarde, el efecto detecta entonces todas las fuentes pendientes.
- **Validez de la caché sin `stat` en el punto de uso** (crear un clip, o decidir si lanzar la detección en segundo plano): igual que ya documentó T44 para `getNewClipMaxRect`, solo se compara el tamaño de la fuente; la detección en segundo plano sí guarda la identidad del fichero (`fs.stat`) en la caché para que una futura invalidación (p. ej. un cambio de tamaño detectado por `setSourceMeta`) la marque inválida.
- **Muestreo**: 1 muestra por segundo del tramo (mínimo 1, máximo 5), 30 fotogramas cada una, con *seek* de entrada — rápido incluso sobre una fuente larga. Se probó a mano con los medios nuevos (bandas horizontales y verticales) y con `h-1080p-10s.mp4` (sin bandas): detecta exactamente el rectángulo esperado en los tres casos (test `blackBars.ffmpeg.test.ts`).
- **`createClip` cambia de `frameSize` a `maxRect`**: el llamador decide el rect inicial (con o sin recorte automático) en vez de que `createClip` siempre calcule el fotograma completo; ambos puntos de creación (botón "Añadir clip" y sincronización de segmentos de LosslessCut) quedan simétricos y usan la misma fórmula `getNewClipMaxRect(...) ?? getFrameRect(frameSize)`.
- **Medios de prueba con bandas**: el contador de tiempo (obligatorio, 06-entorno-desarrollo.md) se dibuja sobre el contenido antes de añadir el `pad` de las bandas, para no ensuciar la detección (`cropdetect` vería el contador como "imagen" si estuviera sobre la banda).

### Validación

- `yarn tsc`, `yarn lint` y `yarn test run` en verde (93 ficheros, 1132 tests). Nuevos: `clips.test.ts` (createClip con `maxRect`), `clipSegments.test.ts` (autoCropBlackBars con y sin detección cacheada), `blackBars.ffmpeg.test.ts` (main, con ffmpeg real y los medios nuevos, se omite sin ellos).
- `yarn build` en verde.
- `yarn test-e2e`: 21/21, incluido el nuevo escenario 18 ("VideoMix (black bars)"): fuente con bandas horizontales → reintenta "Añadir clip" (con deshacer) hasta que la detección en segundo plano termina y el clip nuevo nace en 1280×720 (sin bandas); se desactiva `autoCropBlackBars` y el siguiente clip nace en 1280×960 (con bandas); el botón "Remove black bars" lo recorta a 1280×720; al pulsarlo otra vez sobre un clip ya sin bandas, aviso "No black bars found in this clip" y el máx. no cambia. Capturas `18a-clip-without-bars` y `18b-remove-black-bars-button` revisadas.

### Dudas para el orquestador

Ninguna: T44 ya fijó los contratos (representación de la caché, fórmulas de `blackBars.ts`) y esta tarea solo añadía el proceso de main y la orquestación de la UI/reducer sobre ellos.

## Revisión

- **Resultado**: aceptada. Validación del orquestador (junto con T46): tsc, lint, 1132 tests, e2e 21/21.
- **Corrección del orquestador**: la detección en segundo plano destapó una carrera al guardar (`useMixProject.saveTo`): una actualización de caché que llegaba durante la escritura dejaba el proyecto "sucio" tras guardar (e2e 12 intermitente). Ahora las actualizaciones de caché (`applyCacheUpdate`) también se aplican al proyecto que se está guardando. Además, el e2e 11 leía el `.vmx` antes de terminar de escribirse: espera ya al título sin "*", como el 12.
