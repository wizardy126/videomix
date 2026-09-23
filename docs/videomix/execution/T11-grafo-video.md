# T11 · Generador del grafo de vídeo

- **Hito**: M3 · **Modelo**: Opus · **Depende de**: T09, T10 · **Estado**: hecha

## Objetivo

Traducir un `MixPlan` a los argumentos de ffmpeg (entradas, `filter_complex`, mapeos y bloques) según la decisión del **ADR-001**.

## Contexto (leer antes de empezar)

- `docs/videomix/decisiones/ADR-001-render.md` (**especificación principal**)
- [04-diseno](../04-diseno.md) §2, §3.1, §4
- `geometry.ts` (T03) y `planner/` (T10)
- [03-convenciones](../03-convenciones.md) §9 (tests obligatorios)

## Alcance

1. **`src/renderer/src/videomix/render/buildVideoGraph.ts`** (puro):
   - recorte de cada clip según el ancho de su columna (`getCropForAspect`) y normalización a pares;
   - `fps` y escala;
   - `xfade` en las sustituciones con el tipo y la duración globales;
   - re-layout animado (o fallback, según el ADR);
   - relleno (desenfoque o color) y separación;
   - `fade` in/out global si `fadeInOut`.
2. **`render/buildRenderJob.ts`** (puro): compone el trabajo completo como una lista de bloques, cada uno `{ args: string[], duration, outPath }`, más el paso de concat, según el ADR. Parámetros de salida: resolución, fps, CRF, preset, `-pix_fmt yuv420p` y `-movflags +faststart`. En esta tarea el audio se deja como un hueco o interfaz para T12: una función `buildAudioGraph` inyectable, o un stub que genere silencio.
3. **Tests**:
   - snapshots de los argumentos para 3–4 planes (estático, con sustituciones, con re-layout, con relleno);
   - verificador del grafo: etiquetas definidas y consumidas exactamente una vez, entradas referenciadas que existen y recortes dentro del fotograma de la fuente.
4. **Test de integración opcional con ffmpeg real** (`*.ffmpeg.test.ts`), que se omite si no hay ffmpeg en `ffmpeg/<plat>-<arch>`: renderiza un plan pequeño con los medios de T02 a 320×180 y comprueba la duración y la resolución con ffprobe.

## Fuera de alcance

- La ejecución desde la app, el progreso y la UI (T13).
- El audio (T12).

## Criterios de aceptación

- Un script de desarrollo (`script/videomix/renderPlan.ts` o equivalente) renderiza un proyecto `.vmx` de ejemplo con los medios de T02 y el resultado se ve correcto. Se adjuntan capturas de fotogramas clave en `docs/videomix/decisiones/` o se describen en las notas.
- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

### Resumen

Generador del render por bloques de ADR-001 portado del prototipo de T09 a código de producción, en `src/renderer/src/videomix/render/` (puro, sin React ni Electron). La API está documentada en [04-diseno §4.2](../04-diseno.md).

- **`renderTimeline.ts`**: vista del plan en fotogramas (`f = round(t·fps)`, una sola vez para bloques, xfades y geometría).
  - Geometría de columnas por fotograma, con `smoothstep` durante un re-layout y `getAnimatedColumn` (T10b) para las columnas que aparecen o desaparecen.
  - Rellenos por fotograma (`L`, `R` y los huecos que se abren entre columnas durante una animación).
  - Fundido final hacia el relleno: usa `ColumnPlacement.transitionOut` de T10b. Además deduce `endsInFill` (sin sucesor, la columna sigue en el layout y no termina con el vídeo) para el caso `D = 0`, en el que el planificador no pone el campo y hay que cortar a relleno.
- **`renderChunks.ts`**: `getRenderChunks`. Intervalos ocupados = xfades, fundidos hacia el relleno y cambios de layout (también los instantáneos, que obligan a cortar). Cortes obligatorios alrededor de los cambios de layout y cortes opcionales cada ≤ 15 s fuera de los intervalos ocupados.
- **`buildVideoGraph.ts`**: grafo de un bloque según el esqueleto del ADR.
  - Entradas `-ss s−p -t … -i` con `p = min(0,1, s)`; cabecera `setpts=PTS-p/TB,fps=F:start_time=0,tpad,trim=end_frame=N,setpts=PTS-STARTPTS`.
  - Camino estático (ancho constante) y "capa de columna" (ancho variable): unión de recortes, `scale … eval=frame` y `overlay` con sumas planas de escalones sobre una base del ancho máximo.
  - `xfade` por columna con el tipo global; `concat` cuando el solape es 0.
  - Pillarbox/letterbox sobre el desenfoque del propio clip; rellenos (bordes, huecos durante un re-layout y columnas ya terminadas) con el desenfoque a 1/8 de la columna más cercana que se reproduce todo el bloque, o color.
  - Barras de separación redibujadas cuando alguna capa es más ancha que su ventana.
  - Fundido global a/desde negro con una capa negra con alfa medida en fotogramas: sale exacto aunque el fundido caiga partido entre dos bloques.
- **`buildRenderJob.ts`**: `RenderJob` con:
  - `files` (grafos y lista del concat, que se escriben antes de ejecutar);
  - `chunks` (`{ chunk, args, frames, duration, outPath, graphPath }`);
  - `audio` y `concat` (`-c copy`, `-t` exacto, `+faststart`);
  - `tempPaths`, `totalFrames` y `duration`.

  Además: `getChunkConcurrency` (2; 1 a 2160p o con < 4 núcleos), `encoding` para la previsualización y `join` inyectable para las rutas.
  - **Hook de audio**: `buildAudioGraph(input) → { inputs, filterComplex, outLabel }`, que por defecto da silencio (`buildSilentAudioGraph`). T12 ya lo implementa con esa forma; un test comprueba que su `buildAudioGraph` encaja en el hook (`(input) => buildAudioGraph({ ...input, clips, loudness })`).
- **`verifyFilterGraph.ts`**: comprueba que:
  - cada etiqueta se produce y se consume una vez;
  - las entradas existen y se usan una vez;
  - los `crop` de cada entrada son pares y caben en la fuente;
  - `split=n` cuadra con sus salidas;
  - no hay `if()`.
- **Tests**:
  - `buildRenderJob.test.ts`: snapshots de argumentos y grafos de 5 planes escritos a mano en `renderTestFixtures.ts`:
    - estático;
    - sustituciones con fuente de 25 fps y fundido final hacia el relleno;
    - el ejemplo del ADR a 1080p (re-layout con zoom y xfade simultáneos);
    - pillarbox con rellenos y columna nueva;
    - columna quitada.

    Más: modo color, overrides, hook de audio y bloques cortos que no cortan transiciones.
  - `buildVideoGraph.test.ts`:
    - utilidades (`stepExpr` plano con 500 términos, `formatNumber` sin exponentes, radios de `boxblur`);
    - geometría y bloques;
    - **25 planes aleatorios del planificador real** (24/25/30 fps, gap 0/4/8, transición 0 o 0,5, blur/color), con el verificador en cada bloque y ningún corte dentro de un intervalo ocupado.
  - `buildRenderJob.ffmpeg.test.ts`: renderiza los 5 planes (y el modo color) a 320×180 con ffmpeg real y comprueba con ffprobe la resolución, `yuv420p`, el fps, que el número de fotogramas es exactamente `totalFrames`, la duración y la pista de audio. Tarda unos 6,5 s aquí y se omite si faltan ffmpeg o los medios de T02.
- **`script/videomix/renderPlan.ts`**: script de desarrollo (reutiliza `rendererImports.ts` de T12; no añade dependencias).
  - Sin argumentos, escribe `test-media/render-example/example.vmx` (7 clips de 6 fuentes de T02), lo carga con `loadMixProject`, planifica con `planMix` a la resolución de salida y renderiza con `buildRenderJob` (2 bloques en paralelo).
  - Con un `.vmx`, renderiza ese proyecto. `--fixture <plan>` renderiza un plan de los tests. `--frames` extrae PNG.
  - El audio del script es el silencio por defecto, porque la medida de sonoridad vive en main.

### Resultados del render

- **Ejemplo** a 640×360 (`ultrafast`):
  - plan de 17,5 s con 2 columnas, 5 xfades, 2 re-layouts con relleno, un letterbox y un fundido final hacia el relleno;
  - 5 bloques (2 animados), **4,9 s**;
  - 525 fotogramas exactos y audio de 17,5 s.
- **El mismo a 1920×1080** (`veryfast`): 10,7 s, 525 fotogramas.
- **Fotogramas revisados** (PNG en `test-media/`, ignorado por git; no se adjuntan al repo):
  - **ADR a 1280×720** (`--fixture relayout`): la continuidad en los cortes de bloque es exacta: 59 → 60 (inicio de la animación) y 74 → 75 (fin). El vertical hace zoom centrado en su mín. y el xfade se ve limpio durante el re-layout.
  - **Sustituciones**: fundido de entrada desde negro, xfade `fade` a mitad, clip fundiéndose hacia el relleno desenfocado a 1/3 y 2/3, relleno final y fundido a negro al final.
  - **Rellenos**: pillarbox con fondo desenfocado del propio clip y rellenos laterales que se cierran mientras la columna nueva crece desde ancho 0.
  - **Columna quitada**: encoge manteniendo la altura completa (recortada por la ventana) hasta ancho 0 junto a su vecina derecha.
  - **Ejemplo a 1080p en mitad de un re-layout**: relleno izquierdo creciendo, xfade en la columna 0, separación y relleno derecho.
- **Error encontrado y corregido** al revisar los fotogramas: la columna que desaparece se veía en letterbox en el bloque animado. El criterio de "colapso" miraba solo los anchos del bloque, que no llegan a 0 hasta el fotograma siguiente; ahora se calcula con los keyframes.

### Decisiones y desviaciones

- **Nombres de módulos**: se siguen los del task-doc y el ADR (`buildRenderJob.ts`, `renderChunks.ts`, `buildVideoGraph.ts`) en lugar de `buildRenderArgs.ts` (04-diseno antiguo); 04-diseno §4.2 está actualizado.
  - `buildVideoGraph` recibe la vista en fotogramas (`timeline`) en vez de `plan`, para no recalcularla en cada bloque.
  - `getRenderChunks` también recibe la vista en fotogramas.
- **Recortes**: se usa el `getCropForAspect` real, que da recortes pares, también por fotograma. En los fotogramas `fill` de la capa de columna se escala de forma anisótropa (ventana exacta, como el camino estático, que estira hasta ±1 %). Así no quedan franjas de 1 px y no hay salto en los cortes de bloque.
- **Letterbox en un re-layout**: escala "contain", continua con el camino estático. Las columnas que aparecen o desaparecen llenan la altura, recortadas por la ventana, como pide el ADR.
- **Rellenos desenfocados**:
  - la fuente es la columna más cercana que se reproduce durante todo el bloque (así nunca hay ciclos);
  - si es de ancho variable, solo se usa su parte siempre visible;
  - los rellenos de < 16 px usan el color de relleno, porque un desenfoque de 1–2 px no aporta nada y `boxblur` exige radios válidos.
- **Fundido global** a/desde negro = `D` (el mismo que usa el audio de T12). Con `D = 0` no hay fundido.
- **`concat`** lleva `-t <fotogramas/fps>` para que el audio no alargue la salida.

### Dudas y limitaciones (para el orquestador)

1. **Interpolación**: el render usa `smoothstep` (ADR-001). La semántica de keyframes de 04-diseno §3.1 dice "linealmente". T15 debería dibujar el plan con la misma curva; `smoothstep` está exportado en `renderTimeline.ts`.
2. **Colapso en el borde derecho**: una columna que aparece o desaparece sin vecina derecha colapsa en `x = W` (regla de T10b). Si a la vez hay o aparece un relleno derecho, al empezar o acabar la animación asoma de golpe una barra del color de la separación entre la columna y el relleno (un salto de `gap` px en un fotograma).
   - Con `x = W + gap` en `getAnimatedColumn` sería continuo, pero cambia la regla del planificador; no se ha tocado.
3. **Previsualización**: el plan se calcula a la resolución de salida, así que T13 debe escalar también la separación (par) al planificar a 640×360; el script lo hace así.
4. **Transiciones con geometría** (`wipe*`, `slide*`…) durante un re-layout: se calculan sobre el ancho máximo de la capa (limitación aceptada en T09).
5. `colStart > 0` (una columna que empieza dentro de un bloque sin ser nueva) no ocurre con un plan válido; si ocurriera, se rellena con `tpad`.

## Revisión

- **Resultado**: aceptada. `tsc`, `lint` y tests en verde (369, incluido el test con ffmpeg real). Fotogramas revisados.
- **Decisiones del orquestador**:
  1. Se mantiene `smoothstep` para los re-layouts; 04-diseno §3.1 se corrige.
  2. La barra de un fotograma con separación > 0 (`getAnimatedColumn` con x = W) pasa al backlog de T16, por ser de bajo impacto.
  3. El escalado de la separación en la previsualización se añade al alcance de T13.
