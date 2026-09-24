# T38b · v3: ampliar más allá del máx. para evitar relleno (E7)

- **Hito**: M9 · **Modelo**: Opus · **Depende de**: T37, T38 · **Estado**: hecha

## Objetivo

Cuando, respetando los máx., una disposición dejaría relleno, se amplía el recorte de los clips que lo permitan hasta llenar el fotograma con material real de la fuente.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §11 (E7)
- [04-diseno](../04-diseno.md) §2 (geometría) y §3 (planificador)
- Notas de T03, T10b, T29, T35 (píxeles de visualización), T38 y T32 (previsualización)

## Alcance

1. **Modelo**: `MixClip.extendBeyondMax?: boolean`, donde sin definir equivale a `true` (aditivo, sin cambio de versión). Se valida.
2. **Geometría**:
   - intervalo de proporciones ampliado de un clip: el máx. puede crecer en el eje principal hasta los bordes del fotograma de la fuente, manteniendo la altura (o el ancho en filas);
   - recorte centrado en el máx. y asimétrico si un lado toca el borde;
   - pares y en píxeles de visualización (T35).
3. **Planificador (último recurso)**:
   - las opciones se evalúan igual que ahora, con los intervalos normales;
   - solo si la opción elegida deja relleno estructural (o pillarbox o letterbox), se intenta cubrirlo ampliando los clips con el flag;
   - el ancho extra se reparte en proporción al material disponible de cada clip, saturando;
   - si no alcanza, queda relleno el resto.
   - **No** se aplica al final del vídeo (columnas que terminan sin sucesor).
   - Se emite el aviso `extended` (clip, píxeles ampliados y rango de tiempo).
   - Sin clips ampliables o con el flag desactivado, el plan es idéntico al actual (snapshots sin cambios).
4. **Render y previsualización en vivo**: usan el recorte ampliado. En el render, el `crop` codificado es de T35.
5. **UI**:
   - interruptor por clip ("Ampliar más allá del máx. si hace falta") en la lista de clips o en su menú, y en el panel del clip seleccionado si existe;
   - aviso en la vista Mix: icono en el bloque y tooltip, más la línea en la confirmación previa al render.
   - i18n en español.
6. **Tests**:
   - geometría (centrado, asimetría en el borde, reparto proporcional);
   - planificador: invariantes nuevas (el recorte ampliado no sale de la fuente y el relleno se reduce) y propiedades en los 3 aspectos;
   - render con ffmpeg real de un caso que antes tenía relleno y ahora no, revisando los fotogramas.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

### Resumen

- **Modelo**: `MixClip.extendBeyondMax?: boolean` (zod, opcional; sin definir = activado, solo se guarda `false`; `clipOptionalKeys` del reducer lo quita al volver a activarlo). Sin cambio de versión.
- **Geometría** (`geometry.ts`, 04-diseno §2.5):
  - `getExtensionRoom(max, fuente, dirección)`: píxeles pares de la fuente fuera del máx. en el eje principal (0 si el máx. se sale del fotograma).
  - `extendMaxRect(max, fuente, dirección, extra)`: máx. ampliado centrado en el máx. y asimétrico en el borde; conserva el otro eje.
  - `getExtendedCropForAspect(max, mín, máxAmpliado, a)`: igual que `getCropForAspect` salvo con pillarbox (columnas) o letterbox (filas); entonces alarga el recorte del límite del intervalo (ancho del máx. × alto del mín.) hasta la proporción de la celda, centrado en el máx. y dentro del ampliado. Es continuo con el recorte normal, así que las animaciones no saltan. Filas = transpuesta.
- **Planificador** (`planner/extendPlan.ts`, 04-diseno §3.8), pasada sobre el plan terminado y **antes de los avisos**; la puntuación (`PlanScore`, eje en 1:1) se calcula sobre el plan sin ampliar, así que las decisiones no cambian:
  1. keyframes con relleno estructural: cada columna puede crecer el mínimo de lo que permiten todos los clips que muestra mientras el keyframe está quieto; el relleno se reparte en proporción a esa capacidad (material disponible), en unidades de 2 px por mayor resto, saturando (`shareEven`); el resto sigue siendo relleno centrado;
  2. cada colocación cuyas celdas quietas son más largas de lo que permite su máx. (relleno propio "en su sitio" o columna alargada) recibe `ColumnPlacement.extendedMaxRect` con la ampliación máxima necesaria.
  - Entrada: `PlannerClip.extendBeyondMax = { frame }`, que pone `getPlannerInput({ clips, settings, sources })` si el flag no es `false` y se conoce el tamaño de la fuente. `planRender` exige ahora `sources`.
  - Avisos: nuevo `{ type: 'extended', clipId, pixels, time, endTime }` (píxeles de fuente en el eje principal); `pillarbox`/`letterbox`/`upscale` usan el recorte ampliado; `fill` sale de los keyframes ampliados. `truncatePlan` recorta el tramo al límite. `formatPlan` lo muestra.
  - `validatePlan`: `extendedMaxRect` solo en clips con flag, par, dentro de la fuente, contiene el máx., solo en el eje principal; el aviso `extended` corresponde a un clip ampliado y cae en su intervalo (§3.2, regla 17).
- **Render y previsualización en vivo**: `buildVideoGraph` (columna estática y capa de columna) y `previewDraw.getClipCellDraw` usan `getExtendedCropForAspect` con `placement.extendedMaxRect`: el dato viene del plan, así que no pueden divergir. En el render el `crop` sigue pasando por `toCodedRect` (T35).
- **UI**:
  - Lista de clips: icono conmutable (`MdOpenInFull`, `role="switch"`, atenuado si está desactivado) junto al de silenciar.
  - Menú contextual del clip (lista y vista Mix): casilla "Extend beyond the max if needed" (`getToggleExtendBeyondMaxAction`, en `useMixClipPins`). No hay panel propio del clip seleccionado.
  - Vista Mix: icono `MdOpenInFull` en el bloque (aparte del triángulo de avisos) y tooltip con píxeles y tramo; confirmación previa al render con una línea por clip ampliado (`RenderWarning` `extended`).
  - i18n: 7 claves en inglés (`scan-i18n`) y su traducción en `locales/es`.
- **Manual y diseño**: 04-diseno §1.2, §2.5, §3.1, §3.2 (regla 17), §3.8; manual de usuario (rectángulos y lista de clips).

### Decisiones

- **Altura del recorte ampliado**: se conserva la del recorte en el límite del intervalo (la altura del mín., o el ancho en filas) y su posición, en vez de volver a la altura completa del máx. Así el recorte es continuo con el normal en `aMax` (sin saltos al animar) y hace falta menos material. Sin mín. es lo mismo.
- **Qué celdas cuentan**: los tramos quietos de los keyframes (como los avisos de pillarbox). Durante una animación, el clip saliente de una columna que se alarga no se amplía para la anchura nueva (sigue con su recorte o su ampliación), igual que antes quedaba con pillarbox en esa transición.
- **Final del vídeo**: no se añaden keyframes, así que las columnas que acaban sin sucesor pasan a relleno como antes. Un clip de cadena que "se queda en su sitio" con pillarbox al final sí se amplía: es relleno del propio clip, no el del final.
- **Píxeles del aviso**: de fuente (no de salida), que es lo que el usuario ve en el editor de rectángulos. La vista previa de render (360p) calcula lo mismo en píxeles de fuente.
- **Estimación de duración** (`useMixDuration`): planifica sin fuentes; la ampliación no cambia tiempos.
- La ampliación cuenta también para la línea `upscale`: el factor se calcula con el recorte ampliado.

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (917 tests), `yarn build` y `yarn test-e2e` (14) en verde. En una primera pasada completa falló por tiempo una prueba de propiedades de `pinsGroups.test.ts` (sin clips ampliables, no le afecta este cambio) y en la primera e2e el umbral de audio de la previsualización en vivo (8a, 0,0189 frente a 0,02); ambas pasaron al repetir. El árbol lo comparten otros agentes (había cambios suyos en `e2e/videomix.e2e.ts`, `workspace.ts`, `useMixProject.ts`…).
- Tests nuevos:
  - `geometry.test.ts`: room, centrado, asimetría en los dos bordes, recorte parcial (pillarbox), con mín., filas, y propiedades (par, dentro del ampliado, contiene el mín., nunca peor que sin ampliar).
  - `planner/extendPlan.test.ts`: 9:16 solo en 16:9 a pantalla completa, asimetría con poco material, reparto proporcional (572/132 de 704), saturación con separación, columna con un clip no ampliable, plan idéntico sin clips ampliables, final del vídeo, filas en 9:16, pillarbox/letterbox propio, cadenas y secuencia, plan truncado, `shareEven` y propiedades en 16:9, 9:16 y 1:1 (válido, mismas decisiones y eje, relleno que no crece, columnas que no encogen, recortes dentro de la fuente, determinista).
  - `buildVideoGraph.test.ts` (crop ampliado en columna estática y unión en la capa de columna), `previewDraw.test.ts`, `renderOutput.test.ts`, `plannerInput.test.ts`, `mixPlanLayout.test.ts`.
  - **ffmpeg real** `render/extendBeyondMax.ffmpeg.test.ts`: 16:9 (dos 9:16 de fuentes horizontales, uno a 100 px del borde izquierdo) y 9:16 (dos bandas 1,8:1 de una fuente vertical, una a 100 px del borde superior). Sin ampliar hay relleno (color naranja, > 10 % del fotograma); ampliado no hay nada (< 0,1 %) y cada celda coincide con el recorte ampliado de la fuente hecho por ffmpeg directamente (diferencia media ≈ 0,6–1,0) y no con el recorte sin ampliar estirado. Con `VIDEOMIX_EXTEND_FRAMES_DIR` escribe los fotogramas: los revisé (en 16:9 la columna izquierda muestra el borde izquierdo de la fuente con su código de tiempo, 100 px a la izquierda y 252 a la derecha del máx.; en 9:16 la fila inferior muestra el código de tiempo del borde superior de la fuente).
  - `anamorphic.ffmpeg.test.ts`: ampliación asimétrica (máx. 1:1 junto al borde derecho) de una fuente con SAR 679:640, comparada con la referencia en píxeles de visualización.

### Observaciones (fuera de alcance)

- `MixPlanView.warningTooltip` no tiene texto para el aviso `truncated` (T38): cae en el último `return` y muestra "Its transition is shortened" en los bloques de clips cortados. Probablemente lo resuelva T39.
- `script/videomix/renderVerticalExample.ts` sigue llamando a `planRender` sin `sources` (sin ampliación); `renderPlan.ts` pasa el proyecto entero y sí amplía.

## Revisión

- **Resultado**: aceptada. Verificado con ffmpeg real (relleno > 10 % → < 0,1 %, también de forma asimétrica y con SAR). Sin clips ampliables, el plan es idéntico. Validado junto a T35b.
