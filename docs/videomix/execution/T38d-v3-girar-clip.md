# T38d · v3: girar un clip (E9)

- **Hito**: M9 · **Modelo**: Opus · **Depende de**: T38c, T35b · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §11 (E9)
- Notas de T06 y T07 (overlay y editor de rectángulos; la rotación manual de LosslessCut se desactivó en VideoMix), T35 (píxeles de visualización, SAR y rotación de metadatos), T29, T31 (miniaturas), T32 (previsualización en vivo) y T38b (ampliar más allá del máx.)

## Alcance

1. **Modelo**:
   - `MixClip.rotation?: 0 | 90 | 180 | 270`, en grados en sentido horario (aditivo; sin definir = 0);
   - validación;
   - al duplicar un clip se copia la rotación.
2. **Geometría**:
   - los rectángulos del clip están en el **fotograma de la fuente girado** por su `rotation`, además de la rotación de metadatos y el SAR (T35);
   - función pura para transformar rectángulos al cambiar el giro, de modo que se conserva el encuadre: el mismo contenido pasa a la nueva orientación;
   - el tamaño del fotograma girado se usa en la validación, el planificador (intervalos de proporción y orientación) y T38b (material disponible).
3. **Render**:
   - `transpose` / `hflip,vflip` antes del `crop` (o convertir el recorte a coordenadas sin girar y girar después, lo que sea más eficiente);
   - coherente con el SAR (T35);
   - test con ffmpeg real en los 4 giros, comparando por píxeles con una referencia.
4. **Miniaturas y previsualización en vivo**: aplican el giro. En la previsualización, se rota en el canvas.
5. **Editor**:
   - con un clip girado seleccionado, el reproductor muestra la imagen girada (transformación CSS del `<video>`, o el reproductor compat con rotación) y el overlay de rectángulos trabaja en ese espacio;
   - acciones "Girar +90°", "Girar −90°" y "Girar 180°" en el menú del clip de `ClipList` y en la barra del editor de rectángulos, con atajos si no chocan;
   - indicador de giro en la fila.
6. **i18n**: español.
7. **Tests**: transformación de rectángulos (ida y vuelta en 4 giros, pares, dentro del fotograma), validación, planificador con clips girados y un escenario e2e (girar un clip y renderizar la previsualización).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

### Resumen

- **Modelo** (`types.ts`): `MixClip.rotation?: 0 | 90 | 180 | 270` (`mixClipRotations`, `z.literal`), giro horario sobre la rotación de metadatos. Aditivo, sin cambio de versión; solo se guarda un giro (0 = sin campo, `clipOptionalKeys`). Duplicar y dividir un clip lo copian (`structuredClone`).
- **Geometría** (`clipRotation.ts`, nuevo, puro):
  - `rotateRect` / `unrotateRect` (exactas, enteras), `rotateSize`, `addRotation`, `getClipRotation`;
  - `rotateClipRects(rects, fuente, de, a)`: gira máx. y mín. con la imagen para conservar el encuadre; exacta y par con fotograma par; con fotograma impar ajusta a pares (±1 px) y mantiene mín. ⊆ máx.;
  - `getClipFrame(clip, fuente)`: el fotograma de los rectángulos (visualización de la fuente, T35, girado);
  - `getUnrotatedCrop` + `getRotationFilter`: lo que usan render y miniaturas.
- **Reducer**: acción `rotateClip { clipId, rotation }` (giro absoluto; no hace nada si no se conoce el tamaño de la fuente). B2 (`relinkSource`): el cambio de tamaño se aplica en el fotograma girado de cada clip (`rotateFrameChange`).
- **Validación** (`max-rect-outside-frame`), **planificador** (`getPlannerInput` → `extendBeyondMax.frame`, T38b) y orientación: usan el fotograma girado. El intervalo de proporciones y la orientación ya salían del máx., que vive en el fotograma girado.
- **Render** (`buildVideoGraph`): `RenderClip` admite `rotation`. Los tres `crop` (celda fija, pillarbox/letterbox y la unión U de la capa de columna) pasan por `getUnrotatedCrop` → `toCodedRect` (T35) y van seguidos del giro: `transpose=clock`, `transpose=cclock` o `hflip,vflip`, antes de cualquier `scale`. Sin giro el grafo es idéntico (snapshots sin cambios).
- **Miniaturas**: `getThumbnailCrop(maxRect, fuente, giro)` devuelve el recorte sin girar y el filtro `rotation`, que `getThumbnailArgs` pone entre el `crop` y el `scale`. La clave de caché incluye el giro solo si lo hay (las miniaturas de siempre conservan su clave).
- **Previsualización en vivo**: las operaciones `video`/`blur` de `previewDraw` llevan `rotation` (solo si el clip está girado); `previewCanvas.drawImageTurned` dibuja el rectángulo sin girar del `<video>` (tamaño `videoWidth`/`videoHeight`) girado alrededor del centro del destino (también en la copia a 1/12 del relleno desenfocado).
- **Editor**:
  - `useMixVideoSize` (sale de `ClipRectEditor`): tamaño de visualización del vídeo, con el compat incluido.
  - `useMixPlayerTurn` + `overlayMath.getTurnedVideoView`: con un clip girado seleccionado, un envoltorio nuevo en `App.tsx` alrededor del `<video>` y de `MediaSourcePlayer` recibe `transform: rotate(giro) scale(k)`, con `k` para que la imagen girada quepa (contain). Funciona igual con el reproductor compat, que conserva su propio `rotate` CSS de la etiqueta `rotate` dentro del envoltorio. Sin clip girado, el envoltorio no tiene `transform` (mismo aspecto que antes; el `<video>` no se vuelve a montar al girar).
  - `RectOverlay` recibe `clipRotation` y el fotograma girado como `videoSize`; `getVideoContentBox(…, clipRotation)` da la caja de la imagen girada. El overlay no se gira: etiquetas y tiradores quedan derechos.
  - Barra del editor: botones −90°, +90° y 180° (con el atajo en el título) y el giro actual. Al girar un cuarto, el bloqueo de proporción del clip se invierte (16:9 → 9:16).
  - Menú del clip (lista y vista Mix, `useMixClipPins.getClipMenu`): "Girar +90°", "Girar −90°", "Girar 180°". Fila de `ClipList`: indicador `⟳ 90°` junto al de orientación.
  - Atajos: `R` (+90°), `Mayús+R` (−90°) y `Alt+R` (180°), acciones `rotateClipClockwise`, `rotateClipCounterclockwise` y `rotateClip180`. `R` era `increaseRotation` de LosslessCut, retirada en VideoMix (sin tecla por defecto); `Mayús+R` y `Alt+R` no los usa nada más. Como en tareas anteriores, solo llegan a configuraciones nuevas o restablecidas.
- **i18n**: 8 claves (`scan-i18n`) y su traducción en `locales/es`.
- **Documentación**: 04-diseno §1.1, §1.2, §2.6 (nuevo) y §4.1; manual de usuario (rectángulos y atajos).

### Decisión: dónde va el giro en la cadena de ffmpeg

- **Recortar en coordenadas sin girar y girar solo el recorte** (`crop` codificado → `transpose` → `scale` + `setsar=1`), en vez de girar el fotograma entero y recortar después:
  - se transponen menos píxeles (el recorte, no el fotograma completo);
  - la conversión a píxeles codificados de T35 (`toCodedRect`) sigue en el mismo sitio y con el mismo SAR (el del fotograma orientado por los metadatos), sin tener que razonar sobre el SAR invertido por un `transpose` intermedio;
  - el `transpose` sí invierte el SAR del recorte, pero el `scale` a tamaño explícito + `setsar=1` que ya venía detrás lo ignora, y el fondo desenfocado recibe la proporción de visualización girada (`blurCover`).
- Medido en un 1080p (9 s, un hilo): 1,50–1,53 s frente a 1,48–1,61 s con el giro antes del `crop`: la diferencia está en el ruido (manda la decodificación), así que se elige por simplicidad y coherencia con T35.

### Verificación con ffmpeg real

`render/clipRotation.ffmpeg.test.ts` (se omite sin ffmpeg o sin los medios): tres fuentes —`h-720p-25fps-8s.mp4` (píxeles cuadrados), `v-rotated-9s.mp4` (rotación de metadatos) y `ana-rotated-6s.mp4` (anamórfica 87:82 y rotación de metadatos)— en los 4 giros, con un rectángulo descentrado del fotograma girado. Cada render se compara por píxeles con una referencia hecha "a lo lento" (escalar el fotograma a visualización, girarlo entero y recortar):

| Fuente | 0° | 90° | 180° | 270° | Con el giro opuesto |
|---|---|---|---|---|---|
| h | 0,64 | 1,35 | 0,65 | 1,60 | 75–86 |
| vrot | 0,67 | 0,51 | 2,21 | 1,74 | 243–244 |
| anarot | 3,23 | 3,55 | 4,49 | 4,13 | 225–226 |

(diferencia absoluta media, 0–255). También un clip en pillarbox sobre su fondo desenfocado (anamórfica girada 90°: 5,45 frente a 223 con el giro opuesto) y las miniaturas en los 4 giros (0–1,25 frente a 75–226). Con `VIDEOMIX_ROTATION_FRAMES_DIR` escribe los fotogramas; los revisé (render y referencia coinciden; el fondo desenfocado también sale girado).

### Tests

- `clipRotation.test.ts`: giro de un píxel en sentido horario, composición de giros, ida y vuelta pares y dentro del fotograma en los 4 giros, `rotateClipRects` (todas las combinaciones de/a, mín. ⊆ máx., fotograma impar), reducer (`rotateClip`, sin tamaño, duplicar y dividir, B2), esquema (los 4 giros; 45 y −90 fallan), validación con el fotograma girado y planificador con clips girados (un horizontal girado es vertical, la ampliación E7 se limita al fotograma girado, `validatePlan` sin problemas).
- `buildVideoGraph.test.ts` (recortes y filtros de giro en los 3 caminos, SAR + giro, verificados con `verifyFilterGraph`), `thumbnails.test.ts`, `previewDraw.test.ts`, `overlayMath.test.ts` (`getTurnedVideoView`, también con el giro CSS del compat).
- **e2e**, escenario 13: crea un clip de una fuente 1920×1080, lo gira con `R`, con los botones de la barra y con `Mayús+R`; comprueba la etiqueta ("Max 1080×1920 · 9:16 · Vertical"), el indicador de la fila, el `transform` del reproductor, que el máx. se dibuja alto sobre la imagen girada, la miniatura alta y el `.vmx` guardado (`rotation: 90`, máx. 1080×1920). En la pestaña Mix, el canvas de la previsualización en vivo tiene la barra roja arriba y la cian abajo (giro horario de las barras de color). La previsualización renderizada (640×360) se compara con la fuente girada en los dos sentidos (franja central del clip). Capturas `13a` (editor), `13b` (en vivo) y `13c` (render), revisadas.
- **Reproductor compat**: comprobado aparte en la app real (Xvfb) con un MPEG-2 que Chromium no reproduce ("FFmpeg-assisted playback"): con el clip girado, la imagen del compat sale girada y los tiradores coinciden con sus esquinas. No se deja como e2e (necesitaría un medio nuevo).

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (78 ficheros, 962 tests; las pruebas de rendimiento no cambian), `yarn build` y `yarn test-e2e` (15/15): en verde. Snapshots sin cambios.

### Límites y dudas

- Con el reproductor compat, su contenedor negro gira con la imagen: fuera de la imagen se ve un rectángulo negro girado sobre el fondo gris muy oscuro del reproductor. Es cosmético.
- Con un clip de otra fuente seleccionado no aplica (el editor solo existe para la fuente activa, como antes).
- Si no se conoce el tamaño de la fuente, girar no hace nada y se avisa ("The size of the video of this clip is not known yet"); en la práctica se conoce siempre desde T35b.
- Las fuentes de tamaño de visualización impar se giran con un ajuste a pares de ±1 px (render incluido); con tamaños pares todo es exacto.

## Revisión

- **Resultado**: aceptada. Se ha verificado por píxeles en los 4 giros con fuentes normales, con rotación de metadatos y anamórficas. `tsc`, `lint`, tests (962), `build` y `test-e2e` (15/15) en verde. Con giro 0, los snapshots no cambian.
- **Se aceptan**: los atajos R / Shift+R / Alt+R y la limitación estética del reproductor compat.
