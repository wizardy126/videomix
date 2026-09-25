# T44 · v4: modelo v5 y lógica pura (encaje, keyframes, bandas negras)

- **Hito**: M11 · **Modelo**: Opus · **Depende de**: — · **Estado**: hecha

## Objetivo

Base de datos y lógica pura de las mejoras v4, para que las tareas de UI y render (T45–T49) trabajen en paralelo sobre contratos estables.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- `videomix/types.ts`, `projectFile.ts` (migraciones v1→v4), `projectReducer.ts`, `geometry.ts` (`getAspectRange`, `getWidthRange`, `distributeWidths`, `getExtensionRoom`), `clipRotation.ts`, `sourceResize.ts` (escalado proporcional de B2), `planner/extendPlan.ts`.

## Alcance

1. **Modelo v5** (`version: 5`) con migración v4→v5 y tests:
   - `clip.keyframes?` (A9): lista ordenada por tiempo. Tiempo en **segundos de la fuente** (así los keyframes siguen al contenido si se mueve el inicio del clip; los que queden fuera del tramo se conservan y se aplican como extremos). Cada keyframe guarda la **transformación del encuadre** (posición y escala del máx.; el mín. se transforma igual, conservando su posición relativa dentro del máx.) y su interpolación de salida: `'smooth' | 'linear' | 'hold'` (por defecto `smooth`). Elige la representación (p. ej. `{ time, x, y, scale }` respecto a `maxRect`) y documéntala: la proporción no cambia nunca.
   - Resultado de la detección de bandas negras **por fuente** (A7): rectángulo con imagen, en píxeles de visualización, + identidad del fichero (tamaño y mtime, como la caché de sonoridad) para invalidarlo.
   - Ajuste del proyecto `autoCropBlackBars` (A7), **activo por defecto**.
   - Acciones del reducer necesarias (con historial donde aplique; la detección es caché, sin historial ni `dirty`, como `setSourceMeta`).
2. **Encaje en fracciones (F1)**, puro, en `videomix/fitFractions.ts` (o nombre coherente):
   - fracciones **1/3, 1/2, 2/3, completo**; tamaño de la celda de cada fracción en el eje principal de la salida, descontando la separación (`gap`) como hace el planificador (p. ej. 2/3 = dos tercios + una separación); en columnas, anchos; en filas (9:16, 1:1 en filas), altos (usar `getMainAspectRange`/transposición);
   - para un clip (máx., mín., giro ya aplicado, extendBeyondMax y material disponible en la fuente): estado por fracción `fits | extends | no`, y en `no` cuánto **falta** (máx. demasiado estrecho) o **sobra** (mín. demasiado ancho) en **píxeles de la fuente**, con el redondeo par que usa `getWidthRange`;
   - debe coincidir con lo que haría el planificador para n clips iguales: tests que lo contrasten con `distributeWidths`.
3. **Imán y "Ajustar a" (F2)**, puro:
   - `snapRectEdge` (o similar): dado el rectángulo que se arrastra (máx. o mín.), el borde y un umbral en px de fuente, devuelve el rectángulo enganchado al tamaño exacto de la fracción más cercana si está dentro del umbral;
   - `fitMaxRectToFraction`: máx. con la proporción exacta de la fracción, centrado en el mín. si existe, si no en el centro del máx. actual, dentro del fotograma, conteniendo al mín.; si no es posible, devuelve el motivo.
4. **Keyframes (A9)**, puro: `getClipRectsAt(clip, sourceTime)` → máx./mín. interpolados (curvas smooth/linear/hold), siempre dentro del fotograma, con rectángulos pares; y helpers de edición (añadir o actualizar el keyframe en un tiempo, borrar, anterior/siguiente). El `maxRect`/`minRect` base siguen siendo los que usan el encaje y el planificador.
5. **Copiar/pegar (A5)**, puro: pegar un encuadre (máx. + mín. + giro) en otro clip, escalando proporcionalmente si la fuente tiene otro tamaño (reutiliza `sourceResize.ts`), con aviso si cambia la proporción. Keyframes: decide si se copian (propuesta: sí, escalados) y documéntalo.
6. **Bandas negras (A7)**, puro: parseo de la salida de `cropdetect` (varias muestras → unión), conversión a píxeles de visualización (SAR, rotación de la fuente) y rectángulo inicial de un clip nuevo.

## Fuera de alcance

UI, render, previsualización y proceso main (T45–T49).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run` en verde; tests para cada función pura, incluidos 9:16, giros y SAR.
- Sección nueva en [04-diseno](../04-diseno.md) con el modelo v5 y las fórmulas de encaje.

## Notas de ejecución

### Resumen

- **Modelo v5** (`types.ts`, `project.ts`): `MIX_PROJECT_VERSION = 5`, migración v4 → v5 aditiva (solo `version`; `autoCropBlackBars` sale de los valores por defecto al abrir, `true`). Nuevos `MixClip.keyframes?` (`mixClipKeyframeSchema`), `MixSource.blackBars?` (`blackBarsDetectionSchema`) y `MixSettings.autoCropBlackBars`. Validación nueva `invalid-keyframes` (error).
- **Reducer** (`projectReducer.ts`): `updateClip` normaliza `keyframes` (ordenados, lista vacía → sin definir); `rotateClip` gira los keyframes con los rectángulos; `relinkSource` (B2) los reescala; acción nueva `setSourceBlackBars`. **Hook** `useMixProject().setSourceBlackBars(sourceId, detection | undefined)`: sin historial ni `dirty` (como `setSourceMeta`). Duplicar y dividir clips copian los keyframes (clonado profundo existente).
- **Lógica pura nueva** (con tests): `fitFractions.ts` (F1, F2), `clipKeyframes.ts` (A9), `clipFraming.ts` (A5), `blackBars.ts` (A7, renderer) y `src/common/videomix/cropDetect.ts` (parser de `cropdetect`, compartido con main). `sourceResize.ts` exporta además `getFrameChange(from, to)`.
- **Docs**: [04-diseno](../04-diseno.md) §1.2 (modelo v5) y §10 nueva (modelo, fórmulas de encaje, keyframes, pegar, bandas negras).

### Decisiones de representación

- **Keyframe** = `{ time, centerX, centerY, scale, interpolation? }`:
  - `time` en **segundos de la fuente**; los keyframes fuera del tramo del clip se conservan y actúan como extremos.
  - `centerX/centerY`: centro del máx. animado, en px del fotograma **girado** del clip (el mismo espacio que `maxRect`). Elegí el **centro** (y no la esquina) porque, si cambia el tamaño del `maxRect` base (p. ej. editar la proporción de un clip animado, o reescalar por B2/A5), los encuadres animados crecen o encogen alrededor de su centro, que es lo natural. Para interpolar da igual (con el mismo peso en centro y escala, cada borde se mueve igual).
  - `scale` relativa al tamaño del `maxRect` base (> 0). Máx. animado = base × `scale`; el mín. se escala igual y conserva su posición relativa. **La proporción no cambia nunca**.
  - `interpolation` hacia el siguiente keyframe; sin definir = `smooth` (solo se guarda otro valor, como el resto de opcionales del proyecto).
  - Sin keyframes (`undefined`) = clip no animado. `maxRect`/`minRect` base siguen siendo los que usan encaje, planificador y E7.
- **Curvas**: `smooth` = smoothstep `u²·(3 − 2u)` (ease in-out, fácil de escribir como expresión de ffmpeg), `linear` = `u`, `hold` = 0 hasta el siguiente keyframe. Escala interpolada **linealmente** (no geométricamente): así todos los bordes son lineales en el peso, lo que simplifica el render.
- **Bandas negras**: `MixSource.blackBars = { rect, frame, file: { size, mtimeMs } }`. `rect` en px de visualización (SAR y rotación aplicados); sin bandas (o sin imagen detectada) se guarda **el fotograma entero**. `frame` guarda el tamaño de visualización al que se refiere para detectar también un cambio de tamaño o de SAR (B1/B2).
- **Fracciones**: la celda `k/n` mide `k·Tₙ/n + (k−1)·gap`, con `Tₙ = floorEven(principal − (n−1)·gap)`. Para 1/n esto es exactamente la condición de `distributeWidths` con n clips iguales (test aleatorio de 300 clips × 9 salidas/separaciones/ejes).

### Contratos para T45–T49

**T45 (encaje UI, F1/F2)** — `fitFractions.ts`:
- `getClipFractionFits({ clip, source, settings, axis? })` → `FractionFit[]` en el orden `['1/3', '1/2', '2/3', 'full']`: `{ fraction, length, status: 'fits' | 'extends' | 'no', missing?, excess? }`. `missing` = "faltan N px" (el máx. es corto en el eje principal), `excess` = "sobran N px" (el mín., o el máx. sin mín., es largo); px de la fuente, pares. Para los rectángulos que se están arrastrando (tiempo real) usar `getFractionFits({ maxRect, minRect, frame: getClipFrame(clip, source), extendBeyondMax: canExtendBeyondMax(clip), layout: getFitLayout(settings, axis) })`.
- Eje: `getFitAxes(outputSize)` da `['columns']`, `['rows']` o ambos en 1:1. En 1:1 el planificador elige el eje por proyecto (`MixPlan.axis`); **propuesta**: usar el eje del plan actual si lo hay y, si no, columnas (lo que hace `getFitLayout` por defecto). Lo decide T45.
- Imán: `snapRectEdge({ rect, edge: 'left'|'right'|'top'|'bottom', threshold, layout, bounds, fractions? })` → `{ rect, fraction } | undefined`. `threshold` en px de **fuente** (T45 convierte su umbral de pantalla con la escala del overlay). `bounds`: el fotograma para el máx.; el máx. para el mín. Solo bordes; en una esquina, T45 decide qué borde engancha (p. ej. el del eje principal). Por defecto 1/3, 1/2 y 2/3 (`snapFractions`).
- "Ajustar a": `fitMaxRectToFraction({ maxRect, minRect, frame, fraction, layout })` → `{ ok: true, maxRect } | { ok: false, reason: 'min-too-large' }`. Se aplica con `updateClip(id, { maxRect })` (un paso de historial). Con mín. el resultado siempre da `fits`.

**T46 (copiar/pegar, A5)** — `clipFraming.ts`:
- `copyClipFraming(clip, source)` → `ClipFraming | undefined` (undefined si no se conoce el tamaño de la fuente: desactivar "Copiar"). Guardarlo en un portapapeles interno (estado de React), no en el proyecto.
- `getPasteFramingAction({ project, framing, clipIds })` → `{ action, aspectChangedClipIds, skippedClipIds }`: `action` es un `batch` de `updateClip` (despacharlo con `dispatch`: un paso de historial); si `aspectChangedClipIds` no está vacío, toast de aviso. Pegar reemplaza máx., mín., giro y keyframes del destino (los que falten en el encuadre se borran). **Keyframes: se copian**, escalados como los rectángulos y desplazados en el tiempo para conservar su desfase respecto al inicio del clip. No se copian E7 ni el audio.

**T47 (bandas negras, A7)** — `common/videomix/cropDetect.ts` + `blackBars.ts`:
- Main: `detectBlackBars` ejecuta `cropdetect` (con autorotate, el comportamiento por defecto de ffmpeg) sobre varias muestras y devuelve `parseCropDetectOutput(stderr)` (`CropDetectRect | undefined`, px codificados orientados; unión de todas las líneas). Importar desde main con `../../common/videomix/cropDetect.js`.
- Renderer: `cropDetectToDisplayRect({ rect, sar: source.sar, displayFrame: { width: source.width, height: source.height } })` → px de visualización. Para caché por fuente: `createBlackBarsDetection({ rect, frame, file: fs.stat })` y `setSourceBlackBars(sourceId, detection)` (sin historial ni dirty). Validez: `isBlackBarsDetectionValid(source.blackBars, source, stat)` (sin `stat` solo comprueba el tamaño).
- Clip nuevo: `getNewClipMaxRect({ source, autoCropBlackBars: settings.autoCropBlackBars })` → `Rect | undefined` (undefined si no se conoce el tamaño: crear como hoy); sustituye a `getFrameRect(frameSize)` en `createClip`/`useMixClips`.
- Botón "Quitar bandas negras": detectar en el tramo del clip → `cropDetectToDisplayRect` → `getPictureRect(rect, sourceFrame)` (undefined = sin bandas: aviso) → girarlo al fotograma del clip con `rotateRect(picture, sourceFrame, getClipRotation(clip))` → `removeBlackBarsFromRects(clip, picture)` (undefined = nada que quitar) → `updateClip(id, rects)`.

**T48 (keyframes en render/preview/miniaturas, A9)** — `clipKeyframes.ts`:
- `getClipRectsAt(clip, sourceTime, getClipFrame(clip, source))` → `{ maxRect, minRect? }` pares y dentro del fotograma; sin keyframes devuelve exactamente los guardados (los grafos de clips sin keyframes no deben cambiar). Miniatura: `sourceTime = clip.start`. Previsualización en vivo: el tiempo de la fuente del fotograma dibujado.
- Render por expresiones: `getKeyframeSegments(clip.keyframes)` → `{ from, to, start, end, interpolation }[]` (tiempos de fuente; fuera de los segmentos se mantiene el primero/último) y `easeKeyframe(interpolation, u)` como fórmula de referencia; `clampTransform`/`getTransformedRects` dan la versión continua (sin redondear) dentro del fotograma. El recorte de cada fotograma se calcula sobre los rectángulos animados con las mismas funciones (`getCropForAspect`/`getExtendedCropForAspect`) que los estáticos.
- La clave de la caché de bloques debe incluir `clip.keyframes`.

**T49 (edición de keyframes, A9)** — `clipKeyframes.ts`:
- "Animar": `updateClip(id, { keyframes: setKeyframe(undefined, t, getBaseTransform(clip.maxRect)) })`; desactivar: `updateClip(id, { keyframes: undefined })`.
- Auto-key: mostrar `getClipRectsAt(clip, t, frame)`; al soltar un gesto de mover/escalar con la proporción bloqueada, `setKeyframe(clip.keyframes, t, getTransformFromMaxRect(clip.maxRect, rectMovido))` (actualiza el keyframe a menos de `KEYFRAME_TIME_EPSILON` = 1 ms, o el `epsilon` que se pase, p. ej. medio fotograma).
- `removeKeyframe`, `setKeyframeInterpolation`, `getPrevKeyframe`/`getNextKeyframe`, `findKeyframeIndex`, `isClipAnimated`. Todas devuelven listas nuevas ordenadas (`undefined` = sin keyframes) listas para `updateClip`.
- El tiempo de los keyframes es de la fuente: la marca en el timeline heredado (que ya está en tiempo de fuente) es directa.

### Otras decisiones

- **Imán y "Ajustar a"**: "tamaño exacto de la fracción" = **proporción exacta de la celda** tanto para el máx. como para el mín. (con clips rígidos coincide con "encaja justo"). "Ajustar a" conserva la longitud transversal del máx. (el alto en columnas) si puede.
- **"Quitar bandas negras"** nunca agranda el máx.: lo interseca con la zona con imagen (el mín. se interseca también; si quedara por debajo de 16 px, se mueve dentro). Bandas de menos de 4 px (`BLACK_BARS_MIN_SIZE`) se ignoran, para no reaccionar a bordes oscuros o líneas de relleno del códec.
- **Detección como caché en la fuente** (`MixSource.blackBars`): `relinkSource` la conserva y la validez se comprueba con la identidad del fichero y el tamaño; la invalidación la hace quien la usa (T47), no el reducer.
- **Parser en `src/common`**: main lo necesita para devolver un rectángulo; el renderer lo reexporta desde `blackBars.ts`.
- **Pegar sobre un clip con tamaño de fuente desconocido**: se omite (no se puede escalar); también "Copiar" sin tamaño conocido.

### Dudas para el orquestador

1. **Clips rígidos (sin mín.) y fracciones no enteras**: si la celda no mide un número par de px de salida (1/3 a 1280 px = 426,67; o separaciones que no dividen), un clip sin mín. nunca da ✓ en esa fracción, ni siquiera tras "Ajustar a": es lo que hace el planificador (`getWidthRange` + `distributeWidths` dejan 2 px de relleno o no lo colocan). Lo he dejado **fiel al planificador** (lo conservador). Alternativa futura: una tolerancia de ±1–2 px en `distributeWidths`, que cambiaría planes existentes.
2. **1:1**: qué eje muestran los chips (ver contrato de T45).
3. **Clip animado y botones que cambian el `maxRect` base** ("Ajustar a", "Quitar bandas negras", pegar sobre él): con la representación elegida, los encuadres animados cambian de tamaño alrededor de su centro. Lo coherente lo decide T49 (p. ej. deshabilitar "Ajustar a" en clips animados o aplicarlo a la proporción de todos los keyframes).

### Validación

- `yarn tsc`, `yarn lint` y `yarn test run` en verde (88 ficheros, 1074 tests).
- Tests nuevos: `clipKeyframes.test.ts` (curvas, extremos, dentro del fotograma y pares, edición, giro/reescalado/desplazamiento), `fitFractions.test.ts` (longitudes, 9:16, 1:1 en ambos ejes, separación, contraste aleatorio con `distributeWidths`, mínimos de faltan/sobran, E7 y clips girados, imán, "Ajustar a" con propiedades), `clipFraming.test.ts` (misma fuente, otra resolución, otra proporción, giro, batch), `blackBars.test.ts` (SAR > 1 y < 1, giro, caché, bandas finas, clip nuevo girado, botón), `common/videomix/cropDetect.test.ts` y ampliaciones de `project.test.ts` (migración v4 → v5, ida y vuelta, validación) y `projectReducer.test.ts`.

## Revisión

- **Resultado**: aceptada. Validado: tsc, lint, 1074 tests.
- **Decisiones del usuario sobre las dudas**: (1) tolerancia del 1% absorbida por recorte, ampliación y, como último recurso, estiramiento: nueva tarea T44b; (2) en 1:1 los chips usan el eje del plan actual (columnas si no hay plan); (3) clips animados: lo decide T49.
