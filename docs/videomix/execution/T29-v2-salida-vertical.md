# T29 · v2: salida vertical 9:16 y 1:1 (B5)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T24 · **Estado**: hecha

## Alcance

1. **Planificador en "eje principal"**:
   - en 9:16, filas a ancho completo apiladas (se trasponen las proporciones y los recortes);
   - en 1:1, se prueban filas y columnas y gana la de menor puntuación. Se decide una vez por proyecto, no por evento; se documenta si hay otra opción mejor.
   - Todas las invariantes y `validatePlan` se generalizan. Tests de propiedades en los tres aspectos.
2. **Render**: `renderTimeline` y `buildVideoGraph` trabajan en el eje, con capas de columna o fila, rellenos, separaciones y animaciones.
   - Snapshots y un test con ffmpeg real en 9:16 (el número de fotogramas es exacto).
3. **Geometría**: `getCropForAspect` y `distributeWidths` generalizados, o una versión traspuesta. Los avisos de upscale siguen siendo correctos.
4. **UI**:
   - selector de proporción y resolución en `MixSettingsDialog` (`getOutputSize` de T24);
   - la mini vista y `MixPlanView` se adaptan: los carriles son filas en vertical;
   - las cajas de overlays en 0..1 se mantienen.
5. **Previsualización**: resolución reducida con la misma proporción.
6. **i18n**: español.

## Criterios de aceptación

- Fotogramas revisados en 9:16 y 1:1 con re-layout animado.
- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

(La tarea se retomó tras un reinicio del contenedor: el trabajo parcial del primer agente ya cubría casi todo; el segundo lo revisó, lo completó y lo validó.)

### Resumen de cambios

- **`geometry.ts`**: `LayoutAxis = 'columns' | 'rows'`, `transposeRect`, `transposeAspectRange` (`a → 1/a`), `getMainAspectRange`, `getAxisLengths` (longitud principal y transversal del fotograma) y `getCellRect` (rectángulo de salida de una columna o fila). `getCropForAspect` y `distributeWidths` no cambian: se usan sobre datos traspuestos.
- **Planificador** (`planner/`):
  - `MixPlan.axis?` (ausente = columnas, `getPlanAxis`, `getPlanAxisLengths`) y `PlannerSettings.axis?` para forzarlo (tests).
  - `planMixAxis(input, axis)`: el algoritmo de siempre sobre los clips traspuestos (proporciones y rectángulos) cuando el eje es `rows`; en los `layouts`, `x`/`width` son desplazamiento/longitud a lo largo del eje (y/alto en filas). Devuelve además un `PlanScore` del plan completo (`fill`, `clips`, `relayouts`, `order`), con los mismos pesos que las decisiones por evento.
  - `planMix`: 16:9 → columnas, 9:16 → filas (`getDefaultAxis`, B5: nunca lado a lado), 1:1 → planifica en los dos ejes y gana el de menor puntuación total (empate → columnas). Se decide una vez por proyecto.
  - `getPlanWarnings`: avisos en términos de salida (el `pillarbox` traspuesto es un `letterbox`; el upscale se mide con el tamaño real de la fila). `validatePlan` usa la longitud principal y comprueba el tamaño y el eje esperado. `formatPlan` marca `rows`.
- **Render**: `renderTimeline` (geometría por fotograma y rellenos a lo largo del eje) y `buildVideoGraph` (capas de fila a ancho completo, ancladas arriba, `overlay=x=0:y=…`, barras de separación horizontales, rellenos desenfocados/de color, pillarbox/letterbox y capas animadas con el eje correcto). Los overlays (cajas 0..1 sobre W×H) no cambian.
- **`renderOutput.ts`**: `getPreviewSize` (lado corto 360 con la proporción de la salida: 640×360, 360×640, 360×360); el gap de la previsualización se escala por el lado corto; en 1:1 la previsualización usa el eje que elige el render final (así no cambia de disposición en un casi empate). El aviso `fill` lleva `rows` (texto "whole height").
- **UI**:
  - `MixSettingsDialog`, sección Salida: selector de proporción (16:9 / 9:16 / 1:1) junto al de resolución (`getOutputSize` de T24), con una nota en 1:1; las etiquetas de máximo y separación dicen columnas, filas o "columnas o filas".
  - `MixPlanView`: la mini vista dibuja filas (cabe en 192×150 con la proporción de la salida); los carriles son las filas de arriba abajo (se ordenan por su desplazamiento en el eje) y el aviso del bloque dice "en esta fila".
  - `MixPreviewDialog`: el vídeo toma la proporción del fichero y cabe en 75vh.
- **Script** `renderPlan.ts --size WxH`: gap escalado por el lado corto (acepta tamaños verticales y cuadrados).
- **i18n**: `scan-i18n`; todas las claves nuevas traducidas al español (incluidas las que T28 dejó en inglés).
- **Docs**: `04-diseno` §3.1 y §9.

### Decisiones

- **Trasponer en lugar de reescribir**: el planificador y la geometría trabajan en "eje principal" sobre clips traspuestos; un plan en filas es exactamente el plan en columnas de los clips traspuestos (test). Así todas las invariantes y el ajuste de T10b valen sin cambios.
- **Regla 1:1**: puntuación del plan entero (relleno × tiempo, recorte/upscale/letterbox ponderados por el tiempo que se ve cada clip en cada disposición, número de columnas, re-layouts y orden). Alternativas consideradas: decidir por mayoría de orientación de los clips (más simple y predecible, pero ignora los rangos flexibles: dos 16:9 que admiten 2,4:1 se apilan bien en un cuadrado) o fijarlo por proyecto en Ajustes. La puntuación cubre ambos casos; si el usuario lo pide se puede añadir un selector "automático / columnas / filas" (el planificador ya acepta `axis`).
- **Previsualización en 1:1**: se reutiliza el eje del plan a resolución final (una planificación extra, barata) en vez de volver a elegir a 360×360.

### Tests

- `geometry.test.ts`: trasposición de rectángulos y rangos, recorte de una fila = traspuesta del recorte de la columna (pillarbox ↔ letterbox), tamaños de celda, reparto de alturas.
- `planMix.test.ts`: plan en filas = plan en columnas traspuesto (varias configuraciones), horizontales apilados en 9:16, vertical a pantalla completa, re-layouts animados entre filas, avisos en términos de salida, regla 1:1 (filas para horizontales flexibles, columnas para verticales, gana la menor puntuación, empate → columnas), eje forzado y `validatePlan`. Propiedades: 60 proyectos aleatorios en 1920×1080, 1080×1920, 1080×1080 (auto, columnas y filas) y 360×640 cumplen todas las invariantes y son deterministas.
- `buildVideoGraph.test.ts`: los 5 planes de prueba como filas (grafo válido con fondo desenfocado y de color, composición a `x=0`), capas animadas con `y` por fotograma y barras horizontales (snapshot), fila estática con letterbox (snapshot) y el verificador sobre 15 planes aleatorios en 9:16 y 15 en 1:1.
- `renderOutput.test.ts`: tamaño de previsualización por proporción, gap escalado, eje en 9:16 y el mismo eje que el render final en 1:1.
- `verticalRender.ffmpeg.test.ts` (ffmpeg real): 9:16 (180×320) y 1:1 (240×240) del planificador con re-layouts animados y overlays (texto, imagen, contador y barra), y los planes de prueba `relayout`, `fills` y `removal` como filas: tamaño y **número exacto de fotogramas** con ffprobe `-count_frames`, y la separación entre filas es una barra horizontal magenta en todo el ancho. Con `VIDEOMIX_VERTICAL_FRAMES_DIR` escribe vídeos y fotogramas para revisarlos.
- Revisión visual de fotogramas (Read): 9:16 y 1:1 con re-layout a mitad de animación, overlays en su sitio, relleno desenfocado arriba/abajo, fila nueva creciendo desde 0 y fila que se cierra; además, el ejemplo del script a 270×480 (25,5 s, 765 fotogramas exactos) con sustituciones, re-layout, relleno y un vertical a pantalla completa.
- `yarn tsc`, `yarn lint`, `yarn test run` (703 tests) y `yarn build` en verde.

### Dudas

- Las imágenes superpuestas guardan su caja en fracciones 0..1: si se cambia la proporción de la salida después de añadirlas, se deforman (la caja se ajusta a la proporción de la imagen solo al añadirla). Es lo que pide la especificación ("las cajas en 0..1 se mantienen"); si molesta, se podría reajustar el alto al cambiar de proporción.
- ¿Selector manual del eje en 1:1? Ver Decisiones.

## Revisión

- **Resultado**: aceptada (retomada tras un reinicio del contenedor). `tsc`, `lint`, tests (703) y `build` en verde. Fotogramas de 9:16 y 1:1 revisados y número de fotogramas exacto.
- **Decisiones del orquestador**:
  - Al cambiar la proporción de salida, las cajas de las imágenes se reajustan para conservar la proporción de la imagen (en T34).
  - El selector manual de filas o columnas en 1:1 pasa al backlog.
