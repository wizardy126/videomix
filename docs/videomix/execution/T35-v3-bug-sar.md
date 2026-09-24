# T35 · v3: bug SAR y re-vincular con otra resolución (B1, B2)

- **Hito**: M9 · **Modelo**: Opus · **Depende de**: — · **Estado**: hecha

## Contexto

- [01-requisitos](../01-requisitos.md) §11 (B1, B2).
- **Diagnóstico** (revisado por el orquestador, correcto):
  - `getSourceMeta` (`videomix/workspace.ts`) guarda el tamaño codificado orientado (aplica la rotación, pero no el SAR).
  - El editor (`ClipRectEditor.tsx`) usa `videoWidth`/`videoHeight`, que ya aplican el SAR.
  - El render (`buildVideoGraph.ts`, `cropFilter`) y las miniaturas (`src/main/videomix/thumbnails.ts`) recortan en píxeles codificados.
  - Caso real: 1280×720 con SAR 679:640 da 1358×720 de visualización. Un rect con borde derecho en 1310 es válido en el editor y falla con `max-rect-outside-frame`.
  - Con el reproductor compat, el editor usa el tamaño del stream (codificado): también hay que aplicar el SAR ahí.
- **Bug relacionado**: `setSourceMeta` y `relinkSource` (`projectReducer.ts`) cambian el tamaño sin tocar los rectángulos de los clips.

## Alcance

1. **Una sola fuente de verdad en píxeles de visualización**:
   - `getSourceMeta` aplica el SAR **antes** de la rotación: el ancho codificado × SAR y después se orienta.
   - Hay que guardar el SAR en `MixSource` (campo aditivo `sar?: { num, den }`), porque ffmpeg lo necesita para convertir.
   - Proyectos existentes: al activar una fuente se refresca su meta (ya ocurre). Los rectángulos guardados en píxeles de visualización pasan a ser válidos sin migrar nada.
2. **Render y miniaturas**: el rectángulo (en píxeles de visualización) se convierte a píxeles codificados **en el `crop`**, sin añadir un escalado del fotograma completo. El escalado a la celda, que ya lleva `setsar=1`, corrige la proporción.
   - **Rotación**: el autorotate de ffmpeg (transpose) invierte el SAR. En una fuente rotada 90° o 270°, el factor se aplica al eje vertical del fotograma ya rotado. Hay que verificarlo empíricamente.
   - Redondeo a pares en píxeles codificados.
   - Hay que revisar el resto de filtros que usan tamaños de la fuente (relleno desenfocado, capa de columna).
3. **Editor con reproductor compat**: el tamaño del stream también aplica el SAR.
4. **Previsualización en vivo**: debe seguir coherente, porque dibuja desde `<video>` en píxeles de visualización. Hay que verificar que `drawImage` con el rectángulo de origen use las coordenadas correctas: `drawImage` trabaja en píxeles intrínsecos del vídeo, que en Chromium son los de visualización; hay que confirmarlo.
5. **Re-vincular** (B2): si cambia el tamaño de la fuente (por `relinkSource` o `setSourceMeta`), los `maxRect`/`minRect` de sus clips se **escalan proporcionalmente**.
   - Si cambia la proporción, además se ajustan al fotograma (pares, mín. ⊆ máx.) y se avisa con un toast.
   - La primera vez que se refresca una meta que antes era desconocida no se escala nada.
6. **Tests**:
   - `getSourceMeta` con SAR y con SAR + rotación;
   - conversión de rectángulo a `crop` codificado;
   - escalado al re-vincular;
   - con ffmpeg real: genera en `generateTestMedia` una fuente anamórfica (p. ej. 1280×720 con `setsar=679/640`) y otra anamórfica rotada 90°; renderiza un clip con un rectángulo conocido y comprueba por píxeles que el encuadre coincide con el que da el `<video>` (o con un recorte hecho escalando primero a visualización);
   - miniaturas iguales.
7. Añade la fuente anamórfica a los escenarios e2e si es sencillo.

## Criterios de aceptación

- El caso real (rect 78,14,1232×694 sobre 1280×720 SAR 679:640) valida y se renderiza con el encuadre del editor.
- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

### Verificación empírica (antes de implementar)

Medios en el scratchpad y después en `test-media/` (`generateTestMedia.ts`): `testsrc2` 1280×720 + rejilla de 64 px + `setsar=679/640`, y el mismo remuxeado con `-display_rotation:v:0 90` (como T02).

- **ffprobe**: x264 no puede señalar 679:640 y escribe **87:82** (1,06098 frente a 1,06094). El tamaño de visualización es el mismo, 1358×720. En VP9/WebM sí queda 679:640 exacto. El test ffmpeg usa el de H.264 (87:82), y los tests puros usan 679:640.
- **Autorotate de ffmpeg** (`showinfo` tras el decodificador): sin rotar da `1280x720 sar:87/82`; rotado 90° da `720x1280 sar:82/87`. El transpose **invierte el SAR**, así que en una fuente rotada un cuarto de vuelta el factor se aplica al eje vertical del fotograma ya rotado. Con 180° no cambia.
- **Chromium (Electron de la app, bajo Xvfb, que sí decodifica H.264)**: se usó un script con `<video>`, `videoWidth`/`videoHeight` y `drawImage` a un canvas.

  | Fichero | `videoWidth×videoHeight` |
  |---|---|
  | `ana.mp4` (1280×720, 87:82) | 1358×720 |
  | `ana-rot.mp4` (+90°) | 720×1358 |
  | `ana.webm` (VP9, 679:640) | 1358×720 |
  | `sar89.mp4` (720×480, 8:9) | **720×540** |
  | `sar89-rot.mp4` (+90°) | 540×720 |

  - **Chromium agranda siempre una dimensión**: con SAR < 1 aumenta el alto, no reduce el ancho (`VideoAspectRatio::GetNaturalSize`). `getDisplaySize` sigue la misma regla.
  - **`drawImage(video, sx, sy, sw, sh, …)`** trabaja en esas coordenadas de visualización, también con rotación. Se comparó el recorte de un rectángulo de visualización (p. ej. 78,14 1232×694) con una referencia de ffmpeg que primero escala a visualización y después recorta.
    - El PSNR sale entre 22 y 33 dB en los cinco casos (el ruido de `testsrc2` y la matriz de color limitan el máximo). Recortando el rectángulo en píxeles codificados sale 11,7 dB.
    - Desplazar la referencia ±2–4 px empeora el resultado.
    - A simple vista, la rejilla coincide.
  - Conclusión: **la previsualización en vivo (T32) ya era coherente** y no necesita cambios.
- **Comportamiento antiguo**: `crop=1232:694:78:14` sobre 1280×720 no da error en ffmpeg 8 (recoloca `x` en silencio). El fallo que veía el usuario era la validación `max-rect-outside-frame`, porque la meta guardaba 1280×720.

### Cambios

- **`sampleAspect.ts`** (nuevo, puro):
  - `parseSampleAspectRatio`;
  - `getOrientedSar`: invierte el SAR en un cuarto de vuelta;
  - `getDisplaySize` y `getCodedSize`: regla de Chromium;
  - `toCodedRect`: divide el eje estirado entre el SAR, redondea los bordes a pares y, si recibe el fotograma, recorta dentro del tamaño codificado;
  - `normalizeSar`, `isSameSar`.
- **`types.ts`**: `MixSource.sar?: { num, den }`.
  - Es el **SAR del fotograma ya orientado**, tal como lo entrega ffmpeg tras el autorotate. Sin valor = píxeles cuadrados.
  - Guardarlo orientado hace que la conversión sea la misma con o sin rotación y evita guardar también la rotación.
  - Campo aditivo, sin cambio de versión. Se actualizó el comentario de `rectSchema` (píxeles de visualización).
- **`workspace.ts`**:
  - `getSourceMeta` aplica el SAR antes de la rotación (en la práctica, el SAR orientado sobre el tamaño orientado; es equivalente) y devuelve `sar`. Los píxeles cuadrados se devuelven como `{1,1}`, para poder sustituir un SAR guardado.
  - `isSourceMetaChanged` compara también el SAR.
- **Reducer `relinkSource`**:
  - normaliza el SAR (1:1 → no se guarda);
  - B2: si cambia el tamaño, reescala los rectángulos de los clips de esa fuente con `sourceResize.ts`.
  - `setSourceMeta` (`useMixProject`) solo amplía el tipo con `sar`. No se ha tocado ninguna acción de T36.
- **`sourceResize.ts`** (nuevo):
  - `getSourceFrameChange` devuelve `undefined` en tres casos:
    - la primera vez que se conoce el tamaño;
    - si el tamaño no cambia;
    - en la **migración implícita B1**: fuente sin `sar` cuyo tamaño guardado es el tamaño codificado de la nueva meta. Ese es el caso del usuario: 1280×720 → 1358×720 con 679:640 no escala nada, y los rectángulos ya dibujados en visualización pasan a ser válidos.
  - `rescaleClipRects`:
    - **Misma proporción** (tolerancia del 1 %): escalado uniforme con el fotograma.
    - **Proporción distinta**: escalado uniforme por el factor menor, alrededor del centro mapeado eje a eje, y ajuste al fotograma. Bordes pares, al menos `MIN_RECT_SIZE` y mín. ⊆ máx.
    - **Decisión**: se mantiene la proporción del recorte (un 9:16 sigue siendo 9:16) en vez de estirar cada eje por separado, que deformaría el encuadre. Esto se interpreta como "escalar proporcionalmente y ajustar al fotograma". Si el usuario prefiere el escalado eje a eje, se cambia solo en esta función.
- **Toast** (`useMixWorkspace`): cuando la meta cambia de proporción y la fuente tiene clips, se muestra "The video size of {{name}} changed proportion: check the frames of its clips." (traducido al español). No se avisa en la migración B1.
- **Render**:
  - `buildVideoGraph`/`buildRenderJob` reciben `sourceFrames` (tamaño y SAR por fuente; `useMixRender` pasa `project.sources`).
  - Los tres `crop` de la fuente (celda fija, pillarbox/letterbox y la unión U de la capa de columna) pasan por `toCodedRect`. No se escala el fotograma completo: los `scale` posteriores ya van a tamaño explícito con `setsar=1`.
  - **Relleno desenfocado**: `blurCover` recibe la proporción de visualización y calcula el tamaño de cobertura él mismo, porque `force_original_aspect_ratio` usa el tamaño codificado. Existe `reset_sar` en ffmpeg 8, pero no se depende de él.
  - Los rellenos que salen de otra columna ya tienen píxeles cuadrados.
  - Con píxeles cuadrados, o sin `sourceFrames`, el grafo es idéntico al de antes (hay un test) y los snapshots no cambian. `script/videomix/renderPlan.ts` pasa también `sourceFrames`.
- **Miniaturas**:
  - Los argumentos de ffmpeg pasan a `src/main/videomix/thumbnailArgs.ts` (puro, testeable sin Electron).
  - Con SAR ≠ 1, `getThumbnailCrop` (renderer) da el recorte codificado y la proporción de visualización, y la miniatura se escala a `W×160` explícito con `setsar=1`.
  - La clave de caché incluye el SAR solo si no es cuadrado: las miniaturas de siempre conservan su clave y las anamórficas antiguas (mal recortadas) se regeneran.
- **Editor con reproductor compat** (`ClipRectEditor`): el tamaño del stream aplica rotación y SAR con las mismas funciones.
- **Medios y documentación**:
  - `generateTestMedia.ts` añade `ana-1280x720-sar-6s.mp4` y `ana-rotated-6s.mp4`, documentados en 06-entorno-desarrollo.
  - 04-diseno §1.1 se actualiza a "píxeles de visualización".

### Tests

- **Unitarios**:
  - `sampleAspect.test.ts`, que incluye el caso real: 78,14 1232×694 → `crop=1160:694:74:14`, más casos con rotación, SAR < 1 y un fotograma impar;
  - `workspace.test.ts`: `getSourceMeta` con SAR, con SAR + rotación (side data y etiqueta) y con 180°;
  - `sourceResize.test.ts`: cambio de tamaño, migración B1, primera meta y el reducer;
  - `buildVideoGraph.test.ts`: recortes codificados validados por `verifyFilterGraph` contra 1280×720, capa de columna, igualdad con píxeles cuadrados y `blurCover`;
  - `thumbnails.test.ts`.
- **Con ffmpeg real** (`render/anamorphic.ffmpeg.test.ts`):
  - ffprobe → `getSourceMeta` da 1358×720 a 87:82 y 720×1358 a 82:87;
  - se renderiza el caso real y su versión rotada, y se comparan por píxeles con la referencia "escalar a visualización y recortar". La diferencia absoluta media es de 5,1 y 4,0, frente a 50 y 48 con el recorte desplazado 60 px;
  - un clip rígido en letterbox sobre su fondo desenfocado: primer plano con 10,4 frente a 52;
  - miniaturas de ambas fuentes: tamaño `W×160` correcto y encuadre igual a la referencia.
- **e2e**: nuevo escenario 11.
  - Añade la fuente anamórfica y comprueba `videoWidth` 1358×720.
  - Con N crea un clip, cuya etiqueta muestra "Max 1358×720".
  - Guarda el proyecto: la fuente tiene `width` 1358 y `sar` 87:82, y el `maxRect` es 1358×720.
  - Hace la previsualización renderizada (640×360) sin errores.
  - `e2e/run.ts` exige el nuevo medio.

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (837 tests) y `yarn build`: en verde.
  - En una primera pasada de la suite, dos tests del planificador superaron el tiempo límite de 5 s por la carga del agente paralelo. Al repetirla pasaron, y también por separado.
- `yarn test-e2e`: 12/12.
  - En una pasada, el test 10 (español) falló una vez con `evalWorker error Event` en consola, ajeno a este cambio (worker de expresiones de LosslessCut, bajo carga). Pasó al repetirlo solo (dos veces) y en la suite completa.

### Límites y dudas

- La meta (con el SAR) se refresca al **activar** la fuente, como antes. Un proyecto anterior a v3 con una fuente anamórfica que no se active en la sesión sigue con la meta antigua: la validación dará `max-rect-outside-frame` hasta activarla una vez. No se sondean todas las fuentes al abrir, porque no estaba en el alcance.
- Los rectángulos de proyectos antiguos se interpretan en píxeles de visualización, sin migrar nada (como pide la tarea). Si alguien los dibujó con el reproductor compat, que entonces usaba píxeles codificados, quedarán un ~6 % desplazados en el eje estirado. Es la opción conservadora; no hay forma de distinguir los dos casos.
- Las imágenes de los elementos superpuestos con SAR ≠ 1 no se han tocado: es raro y está fuera del alcance.
- Observación ajena: en las capturas e2e de la previsualización renderizada (también en la 08a de antes), el panel de la previsualización en vivo se pinta encima del diálogo modal.

## Revisión

- **Resultado**: aceptada. El caso real del usuario valida y se renderiza con el encuadre del editor, verificado por píxeles. `tsc`, `lint`, tests, `build` y `test-e2e` (12/12) en verde.
- **Se acepta**: al cambiar la proporción se conserva la proporción de cada recorte.
- **Seguimiento**: refrescar los metadatos de todas las fuentes al abrir y antes de renderizar (añadido a T39).
