# T40 · v3: i18n, manual, e2e y cierre

- **Hito**: M9 · **Modelo**: Sonnet · **Depende de**: T35–T39 · **Estado**: hecha

## Alcance

1. `scan-i18n` y revisión del español.
2. **Manual**:
   - contador de duración, "Nuevo clip desde aquí" y clips solapados (duplicar o esta acción);
   - clips enlazados, secuencia siempre visible, duración estimada y máxima;
   - nota sobre las fuentes anamórficas.
3. **Nuevos escenarios e2e**: contador visible al marcar un inicio, "Nuevo clip desde aquí" dentro de un clip, indicador de duración estimada y aviso de duración máxima.
4. **Estabilizar el e2e 8a** (nivel de audio de la previsualización en vivo tras un *seek*): falla de forma intermitente (≈0,019 frente a un umbral de 0,02, o `farFromKeyframe` = 0). Hay que buscar la causa: si es del test, ajustar la medida; si es de la app, corregirla.
5. Proyecto de ejemplo que use cadenas, secuencia y límite: renderizado y revisado.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

### 1. `scan-i18n` y español

`yarn scan-i18n` pasa sin cambios. Comparando `locales/en/translation.json` con `locales/es/translation.json` quedan 133 claves sin traducir, pero todas son cadenas heredadas de LosslessCut que ya no se usan en el flujo de VideoMix (comprobado: ninguna contiene vocabulario de las mejoras v3 — cadenas, secuencia, giro, ampliar, solapados, etc. — y `scan-i18n` sólo compara el código con el locale de referencia `en`, no `en` con `es`). Cada commit de T35–T39 mantuvo `es` al día (verificado con `git show --stat` de esos commits: siempre tocan `locales/en` y `locales/es` juntos). No ha hecho falta traducir nada nuevo.

### 2. Manual (`docs/videomix/manual-usuario.md`)

Añadidas las secciones que faltaban: contador de duración (E1, en §3), "Nuevo clip desde aquí" y clips solapados (E6, §3), clips enlazados/cadenas (E2, nueva sección en §3), secuencia siempre visible (E5, nueva sección en §3), duración estimada y máxima (E3/E4, nueva sección en §5) y una nota sobre fuentes anamórficas (B1, en §2, automático). También una fila nueva en la tabla de ajustes de montaje (§5, "Enlaces") y una fila nueva en la tabla de atajos (§9, `Mayús+I` para "Nuevo clip desde aquí", que sí tiene atajo por defecto — corregido: antes el manual lo daba, erróneamente, por una acción "más nueva" sin atajo). Verificado el atajo real en `src/main/configStore.ts` (`ShiftLeft+KeyI` → `newClipFromCursor`), no asumido.

### 3. Nuevos escenarios e2e

- Contador visible al marcar un inicio y "duración estimada" de E3: añadidos dentro del test 2 (`e2e/videomix.e2e.ts`), comprobando `cursor-duration` (nuevo `data-testid` en `BottomBar.tsx`; también añadido `timeline-cursor-duration` en `Timeline.tsx` y `mix-duration-estimate` en `MixRenderButtons.tsx`, aunque sólo el primero se usa en el test para no acoplar el test a la condición de visibilidad del overlay de la línea de tiempo).
- "Nuevo clip desde aquí" dentro de un clip: ya existía (test 9b, de T37).
- Aviso de duración máxima: ya existía (test 14, de T39).

No se han duplicado escenarios.

### 4. Estabilizar el e2e 8a

Reproducido el fallo ejecutando el bloque `English UI` repetidas veces bajo carga de CPU sintética (`yes > /dev/null` en 3–4 núcleos, máquina de 4 núcleos): sin carga, `farFromKeyframe` salía 0,03–0,08 (holgado); con carga, a veces exactamente 0 (nunca ≈0,019 exacto, pero el mismo síntoma).

**Causa**: el test mide el pico de RMS durante una ventana fija de 1500 ms justo después de pulsar "Play" tras un *seek* largo (7 s de decodificación desde el *keyframe* anterior, con el elemento en pausa). Ese silencio mientras el elemento sigue buscando/decodificando es **correcto** (no hay nada que reproducir aún); lo que varía con la máquina y su carga es *cuánto* tarda esa búsqueda. Con una máquina lenta o cargada, la ventana de 1500 ms puede transcurrir entera dentro de ese silencio, y el test lee "nunca se reprodujo" cuando en realidad se reproduce unos instantes después. Es decir: **problema de medida del test** (ventana fija demasiado corta para una operación de duración variable), no un fallo de la app — la lógica de `previewClock.ts`/`previewEngine.ts` (el `seekLead` adaptativo de T33) sigue corrigiendo la deriva correctamente; sólo que corregirla puede tardar más de 1500 ms.

**Arreglo**: en vez de una medición única de longitud fija, ambas mediciones de audio del test 8a (la del *seek* corto —"twoClips"— y la del *seek* largo —"farFromKeyframe") ahora usan `expect.poll` con las mismas ventanas de 1500/1000 ms, repitiéndolas hasta un presupuesto generoso (10 s / 30 s) en vez de una sola vez. Una regresión real (el error de antes de T33, que no se recupera nunca) sigue fallando al agotar ese presupuesto. No se ha tocado el umbral de 0,02 (no había justificación para bajarlo: una vez fuera de la ventana de silencio, el nivel medido está muy por encima, 0,03–0,08).

Verificado: 3 ejecuciones limpias y 3 bajo carga (`for i in 1 2 3 4; do yes >/dev/null & done`) — 8a en verde en todas. Con una carga más agresiva y sostenida (3–4 procesos `yes` en una máquina de 4 núcleos, saturación casi total) sigue fallando alguna vez incluso con el presupuesto de 30 s (y en ese caso también fallan otros tests sin relación, como el 2 o el 9): ese nivel de saturación no es representativo de una máquina de CI simplemente cargada (que es lo que describe el enunciado, ≈0,019 frente a 0,02) y no parece razonable perseguir un tiempo de espera sin límite práctico para cubrirlo.

### 5. Proyecto de ejemplo (E2, E5, E7, E9, E4)

`script/videomix/renderChainsExample.ts` (nuevo, siguiendo el patrón de `renderVerticalExample.ts` de T34): 16:9, 4 clips silenciados (sin música, sin medir sonoridad, para centrarse en el plan/render de v3) —

- una cadena de 2 clips de la misma fuente (E2, corte directo);
- un clip recortado más estrecho que su columna, con `extendBeyondMax` (E7);
- un clip girado 90° (E9);
- un clip en la secuencia siempre visible (E5, `settings.alwaysVisible.clipIds`);
- una duración máxima (E4) que corta el vídeo 3 s antes del final "natural", con el *fade* de salida.

El script comprueba con aserciones (no sólo visualmente) que el plan real (`planRender`) coloca la cadena en el mismo hueco con corte directo, que la secuencia tiene hueco propio distinto del resto, que el clip estrecho se amplía (con el aviso `extended`) y que el vídeo se corta en el máximo (con el aviso `truncated`); luego renderiza con `buildRenderJob`/ffmpeg real y comprueba tamaño y duración con `ffprobe`.

**Bug real encontrado y corregido** (no en el script, en el motor de render): al construir el vídeo, `buildVideoGraph.ts` (`chainSegments`) usa el filtro `concat` de ffmpeg para el corte directo entre los dos clips de una cadena — pero, a diferencia de cada capa de clip/relleno (que siempre pasa por un filtro `fps=`), la salida de `concat` no tiene garantizada una base de tiempos limpia (1/fps). Cuando esa cadena termina y el siguiente clip de la columna **no** es parte de la cadena (una transición normal, `xfade`), ffmpeg rechaza el grafo: `First input link main timebase (1/1000000) do not match the corresponding second input link xfade timebase (1/30)`. Reproducido de forma determinista (100% de las veces, en un proceso nuevo cada vez, sin relación con carga de CPU ni con el proceso Node que lo genera) con un plan mínimo (`chainThenSwitch`, añadido a `renderTestFixtures.ts`: cadena de 2 + una tercera colocación con transición real). **Corrección**: añadir `fps=${fps}` a continuación de `concat` en `chainSegments` (una línea). Se ha añadido:
  - el plan `chainThenSwitch` en `renderTestFixtures.ts` (cadena + traspaso con transición real a un tercer clip, en el mismo hueco);
  - un caso más en la tabla de `buildRenderJob.ffmpeg.test.ts` (renderiza con ffmpeg de verdad y compureba con ffprobe) — comprobado que falla sin la corrección y pasa con ella;
  - la comprobación de estructura de `buildRenderJob.test.ts` recoge automáticamente el nuevo plan (nuevo snapshot).

Al investigar el primer síntoma (antes de dar con esta causa) se probaron muchas hipótesis que no explicaban el fallo por sí solas (documentadas para no repetirlas): multithreading de ffmpeg 8 (`-filter_complex_threads 1`), reintentos con espera creciente (hasta 10 s), ejecutarlo en un proceso Node nuevo, y llamarlo con `spawnSync` en vez de `spawn` asíncrono. Todas fallaban igual hasta identificar que el problema era de contenido (la combinación cadena + traspaso), no de entorno o de proceso; una vez con la causa real, el fallo se reprodujo y se corrigió de forma aislada y determinista (unit test + test con ffmpeg real).

**Fotogramas revisados** (`test-media/render-chains-example/frame-*.png`, con el `Read` tool):
- `frame-extended-and-sequence.png` (t=2 s): dos columnas lado a lado — la izquierda (clip ampliado) más ancha que su recorte original; la derecha, la secuencia siempre visible.
- `frame-chain-first-half.png` (t=5,5 s): el primer clip de la cadena, a pantalla completa (una sola columna en ese momento).
- `frame-chain-cut.png` (t=7,55 s, justo tras el corte directo): mismo patrón visual (misma fuente), con el contador de tiempo interno saltando al segundo clip de la cadena — corte limpio, sin fundido.
- `frame-rotated.png` (t=10,5 s): las barras verticales de la fuente original se ven horizontales tras el giro de 90° — confirma E9.
- `frame-near-end-fade.png` (t=10,7 s, dentro del recorte por duración máxima): mismo fotograma que el anterior pero visiblemente más oscuro — el *fade* de salida global en el corte de E4.

### Validación

`yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` (éste último dos veces) en verde. `yarn test run`: 986 tests, 81 ficheros. `yarn test-e2e`: 16 escenarios, dos ejecuciones limpias.

### Dudas / desviaciones

Ninguna duda de requisitos. Desviación menor: la secuencia siempre visible es la única del proyecto (no la hay repetida), como pide el requisito E5; el script de ejemplo demuestra una sola.

## Revisión

- **Resultado**: aceptada. Hito M9 cerrado.
  - Manual completo.
  - e2e 8a estabilizado: era un problema de medida del test, no de la app.
  - Bug real corregido: la base de tiempos de `concat` en cadenas hacía fallar un `xfade` posterior.

  `tsc`, `lint`, tests (986), `build` y `test-e2e` (16/16, dos veces) en verde.
