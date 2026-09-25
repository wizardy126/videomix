# T48 · v4: keyframes en render, previsualización y miniaturas (A9)

- **Hito**: M11 · **Modelo**: Opus · **Depende de**: T44, T44b · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- `getClipRectsAt` de T44 y sus notas. [ADR-001](../decisiones/ADR-001-render.md) (atención: **`crop` no admite tamaño variable** y `xfade` tampoco; sumas planas de escalones en lugar de `if()` anidados). `render/buildVideoGraph.ts` (capa de columna: `crop` + `scale eval=frame` + `overlay`), `sampleAspect.ts` (`toCodedRect`, SAR), `clipRotation.ts`, `planner/extendPlan.ts` (E7), `preview/previewDraw.ts`, `thumbnails.ts`.

## Alcance

1. **Render**: un clip con keyframes muestra el recorte animado (paneo y zoom, proporción fija), con las curvas smooth/linear/hold. Primero, un **mini-spike** con ffmpeg real para elegir la técnica (p. ej. `crop` fijo de la unión + `scale eval=frame` + `crop` con x/y por fotograma; o `zoompan`; o escalar el fotograma entero por fotograma y recortar a tamaño fijo) y medir su coste. Documentar la decisión (ADR-003 o ampliación de ADR-001). Debe convivir con: SAR (px codificados), giros, E7 (ampliación: se aplica sobre el recorte animado, dentro del fotograma), re-layouts animados, cadenas, transiciones y la caché incremental (la clave de bloque debe incluir los keyframes).
2. Tests de snapshot del grafo y **tests con ffmpeg real que comprueben píxeles** (p. ej. una rejilla o marca que debe estar en cierta posición en fotogramas concretos).
3. **Previsualización en vivo**: dibuja el recorte animado.
4. **Miniaturas**: usan el recorte en el instante de inicio del clip.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde; los tests con ffmpeg real pasan; clips sin keyframes producen exactamente el mismo grafo que antes (snapshots existentes sin cambios).

## Notas de ejecución

### Mini-spike y decisión ([ADR-003](../decisiones/ADR-003-keyframes-render.md))

- Script reproducible `script/videomix/spike/keyframeSpike.ts [celdaW celdaH]`: fuente sintética de puntos (sin pérdidas) para medir la **posición de cada punto en cada fotograma** frente a la exacta, y `h-1080p-10s.mp4` / una `testsrc2` 4K para el coste (`-f null`, menos un recorte estático).
- Resultados (celda 1280×720 / 1920×1080, fuente 1080p): **capa de columna** de ADR-001 +3–9 ms/fotograma, error medio 0,8–1 px, máximo ~3 px y **vibración** (cambio del error entre fotogramas) 1–1,6 px, que en un paneo lento se ve a saltos; **`perspective` lineal** +8–11 ms/fotograma, error medio **0,07–0,11 px**, máximo < 0,7 px, vibración **0,05 px**; `perspective` cúbica, el doble de coste sin mejora; `scale eval=frame` + `crop` fijo con `x`/`y` por fotograma funciona en esta versión pero depende de un comportamiento no documentado de `crop` (y redondea al px); `zoompan` descartado (su recorte tiene la proporción de la entrada, posiciones enteras). x264 medium cuesta 12,8 / 20,8 ms por fotograma. Con 4K, `perspective` cuesta ~31 ms; pre-escalando la unión cuando sobra al menos el doble de resolución, 6,6 ms (celda de 640).
- **Trampa**: `perspective` no tiene `t`; su `in` empieza en **1** (con `gte(in,m)` el recorte iba un fotograma tarde: 17 px de error en el zoom).
- **Elegido**: columnas de ancho constante → `crop` de la unión → (giro) → (pre-escala si `k ≤ 0,5`) → `perspective` (`sense=source`, `eval=frame`, esquinas reales por fotograma como suma plana de escalones sobre `in`) → el `scale` / pillarbox del camino estático. Re-layouts → capa de columna con el recorte animado de cada fotograma (su cuantización de 2 px ya estaba aceptada). Clip animado quieto durante un bloque → camino estático con el encuadre redondeado a pares.

### Cambios

- **`animatedCrop.ts`** (nuevo, puro): `getAnimatedCellCrop({ clip, aspect, time, frame, extendedMaxRect })` = el recorte estático de los rectángulos base (`getExtendedCropForAspect`, con tolerancia T44b y E7) movido y escalado con la transformación del keyframe limitada al fotograma par (`clampTransform`), en números reales. Sin keyframes devuelve exactamente el estático. **E7**: ampliación `extra · escala` en el mismo eje, centrada en el máx. animado y desplazada dentro del fotograma (como `extendMaxRect`), recorte centrado en el recorte del límite y desplazado dentro de ella (como `getExtendedCropForAspect`); si no cabe, se corta en el borde (estiramiento dentro de la tolerancia o pillarbox/letterbox en ese fotograma).
- **`render/buildVideoGraph.ts`**: `RenderClip` admite `keyframes`. En `buildClipLayer`, para clips animados: recorte por fotograma con `getAnimatedCellCrop` (tiempo de la fuente = `seek + n/fps`, fotograma girado del clip); columna estable → estático si no cambia, `perspective` si mantiene encaje y proporción, capa de columna si no; columna variable → capa de columna con esos recortes. Unión `U` crecida a pares y dentro del fotograma (`getEvenUnion`; idéntica a la de antes para recortes pares). Con SAR/giro, las esquinas se refieren a lo que muestra de verdad el recorte codificado (bordes pares vueltos a px de visualización y girados). Nuevos `frameStepExpr` (exportado) y `PERSPECTIVE_PRESCALE_MAX = 0,5`. El camino estático se ha factorizado (`pushCell`) sin cambiar su salida.
- **Previsualización** (`preview/previewDraw.ts`): `getClipCellDraw` usa `getAnimatedCellCrop` en el tiempo real de la fuente (`clip.start + (f − p.f0)/fps`); `createPreviewDrawModel(tl, clips, settings, sources?)` calcula el fotograma de cada clip para limitar el encuadre (`useMixLivePreview` le pasa las fuentes).
- **Miniaturas** (`thumbnails.ts`, `hooks/useClipThumbnails.ts`): `getThumbnailMaxRect(clip, source)` = `getClipRectsAt(clip, clip.start, getClipFrame(...)).maxRect`; entra en la clave de caché y en el recorte. Sin keyframes, `clip.maxRect` (las claves existentes no cambian).
- **Caché de render**: la clave ya es el contenido del grafo, que incluye los recortes animados: no hace falta tocar `renderCache.ts` ni `RENDER_CACHE_VERSION`. Test nuevo: añadir keyframes a un clip cambia solo los bloques en los que su encuadre difiere del base, y cambiar la curva también cambia la clave.
- **Docs**: ADR-003 nuevo (y en el índice de decisiones), 04-diseno §4.1 y §10.3.

### Decisiones (conservadoras)

1. **Recorte animado = recorte estático transformado**, en vez de recalcular `getCropForAspect` sobre los rectángulos pares de `getClipRectsAt` por fotograma: da el mismo resultado salvo el redondeo (test: ≤ 4 px de fuente en 300 casos aleatorios, lejos de los límites de la tolerancia) y evita que el paneo vibre. La previsualización usa la misma función; las miniaturas, `getClipRectsAt` (pares), como decía el contrato de T44.
2. **Re-layout + keyframes** con la capa de columna (cuantizada), no con `perspective`: el tamaño de la celda cambia por fotograma y la animación dura `D` (0,5 s); es lo ya aceptado en ADR-001. Medido en el test real: error medio 0,4 px, máximo 2,9 px.
3. **Clip quieto en un bloque**: camino estático con el encuadre redondeado a pares alrededor de su centro (≤ 1 px de fuente frente al sub-píxel). Si el corte de bloque cae justo donde empieza el movimiento, puede verse un salto de ≤ 1 px de fuente; es barato y solo pasa en ese caso.
4. **Pre-escala solo con `k ≤ 0,5`**: añade un remuestreo; por encima de la mitad el ahorro es moderado (4K en celda de 1280: 30 → 22 ms) y se prefiere no tocar la calidad.
5. **Interpolación lineal de `perspective`**: la cúbica cuesta el doble sin mejora medible (el `scale` bicúbico posterior hace el cambio de tamaño principal).

### Validación

- `yarn tsc`, `yarn lint` y `yarn build` en verde.
- `yarn test run`: 1129 tests en verde (incluidos los de ffmpeg real) y **2 fallos en `clipSegments.test.ts` ajenos a esta tarea**: vienen de los cambios en curso de otro agente (T47, `clips.ts`/`useMixClips.ts`: `createClip` pasa de `frameSize` a `maxRect`); no toco esos ficheros.
- **Snapshots existentes sin cambios** (clips sin keyframes = mismo grafo); solo se añade uno nuevo (grafo de un clip animado).
- Tests nuevos:
  - `animatedCrop.test.ts`: identidad sin keyframes; transformación del recorte (proporción, centro, sub-píxel); contraste aleatorio con `getClipRectsAt` + `getExtendedCropForAspect`; dentro del fotograma; E7 horizontal (zoom, borde, sin sitio → pillarbox) y vertical.
  - `buildVideoGraph.test.ts`: `frameStepExpr`; cadena `crop → perspective → scale` y valores de las esquinas por fotograma (incluido que `in` empieza en 1); clip quieto → estático (y keyframe en la transformación base → grafo idéntico); pillarbox con la proporción del recorte en el fondo; pre-escala; giro + anamórfico (esquinas en px de la imagen codificada); re-layout con capa de columna; 6 proyectos aleatorios con keyframes (y giros) validados con `verifyFilterGraph`.
  - `previewDraw.test.ts` (mismo recorte que el render en el tiempo de la fuente; límite del fotograma), `thumbnails.test.ts` (`getThumbnailMaxRect`), `renderCache.test.ts` (clave).
  - **ffmpeg real** `render/keyframes.ffmpeg.test.ts` (fuente sintética de puntos creada por el test; se omite sin ffmpeg): posición de cada punto en cada fotograma frente a la calculada solo con el modelo (`getKeyframeTransformAt` + `clampTransform`), con bloques de 1 s que cortan la animación, paneo lineal lento, zoom suave y un salto *hold*: **error medio 0,056 / 0,077 / 0,057 px, máximo 0,23 / 0,37 / 0,23 px, vibración 0,05 px** (px cuadrados / fuente anamórfica 2:1 / clip girado 90°); el salto cae en su fotograma exacto. Re-layout simultáneo (capa de columna): error medio 0,41 px, máximo 2,88 px. Con `VIDEOMIX_KEYFRAMES_FRAMES_DIR` escribe fotogramas PNG (revisados).

### Dudas para el orquestador

- Ninguna bloqueante. A revisar si se quiere: el umbral de pre-escala (0,5) y el uso de la capa de columna (cuantizada) cuando un clip animado coincide con un re-layout (decisiones 2 y 4).

## Revisión

- **Resultado**: aceptada. Técnica `perspective` (ADR-003), error < 0,4 px en los tests con ffmpeg real; decisiones conservadoras 1–3 aceptadas. Validación: lint en sus ficheros, 356 tests de render/preview/miniaturas; los 2 fallos de `clipSegments.test.ts` eran del trabajo en curso de T47.
