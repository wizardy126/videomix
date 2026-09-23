# T32 · v2: previsualización en vivo (A1)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T26, T27, T29 · **Estado**: hecha

## Alcance

1. **Motor**:
   - en la pestaña Mix, el área del player muestra la composición en tiempo real según `renderTimeline` (columnas o filas, recortes, re-layouts con `smoothstep`, rellenos de color o desenfoque aproximado, separaciones, transiciones aproximadas con *fade*);
   - los overlays se dibujan en un canvas (PNG, textos con sus animaciones, contadores y barras), con los mismos cálculos de `overlayFrames`.
2. **Vídeos**:
   - un `<video>` por clip visible, más precarga del siguiente de cada columna;
   - sincronizados con un reloj maestro, corrigiendo la deriva;
   - fuentes no reproducibles por Chromium: se reutiliza el `previewFilePath` de html5ify si existe, o se muestra un marcador "no previsualizable".
3. **Audio** con WebAudio:
   - ganancias de normalización (cache de sonoridad) más `gainDb`;
   - lista de música con crossfade y ducking aproximado;
   - efectos de sonido.
4. **Controles**: reproducir, pausar, buscar (sincronizado con el cursor de la vista Mix), barra espaciadora y aviso "Aproximado; el render es la referencia".
5. **Rendimiento**: objetivo de 30 fps con 3 columnas a 1080p en un equipo medio. Se documentan los límites.
6. **Tests** de la lógica pura: planificación de qué vídeos cargar, reloj y cálculo de ganancias.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde. Instrucciones de prueba manual.

## Notas de ejecución

### Resumen

En la pestaña **Mix**, el área del player queda cubierta por la previsualización en vivo (`components/MixLivePreview.tsx`): un `<canvas>` ajustado a la proporción de la salida, una barra de controles (reproducir/pausar, tiempo, barra de búsqueda y fps medidos) y el aviso "Previsualización en vivo aproximada: el render es la referencia".

**Estructura** (`src/renderer/src/videomix/preview/`; lógica pura con tests salvo el motor y el canvas):

| Fichero | Qué hace |
|---|---|
| `previewClock.ts` | Reloj maestro (`performance.now`). `getDriftCorrection`: salta si la deriva supera 0,15 s (0,1 s por delante, `SEEK_LEAD`, para compensar lo que tarda el salto); por debajo, ajusta `playbackRate` hasta ±5 %; no hace nada por debajo de 0,03 s. En pausa, salta exacto (tolerancia 5 ms). |
| `previewSchedule.ts` | Qué `<video>` hacen falta en un instante: los clips en pantalla en ese fotograma (posición en la fuente = `clip.start + (t − f0/fps)`, como el render) y, pausados en su inicio, los que empiezan en los próximos 2 s. Igual para las pistas de música (`getMusicSchedule`). `assignPreviewPool` reparte las peticiones en un *pool* de elementos: se conserva el elemento de una petición, se reutiliza primero uno libre con el mismo fichero cargado (clips consecutivos de la misma fuente solo saltan) y se conservan como mucho 2 libres. |
| `previewDraw.ts` | Lista de dibujo de un fotograma con la geometría exacta del render: `getColumnsAtFrame` (re-layouts con `smoothstep`, columnas que crecen desde 0 o encogen), `getFillSpansAtFrame`, `getCellRect` (columnas o filas) y `getCropForAspect`; pillarbox/letterbox y columnas que colapsan como en `buildClipLayer`. Recortes de destino con `clipDrawToBounds` (sin `clip()` del canvas). |
| `previewOverlays.ts` | Overlays con los cálculos del render: `getOverlayFrames`, `getOverlayPixelBox`, `getCountdownTextAt`, `getProgressBarFraction`, `getTextLineCenters`, `getTypewriterCount`, `getSlideOffset`, `getTextOpacity`, `lengthPx` (exportado de `overlayFilters.ts`). |
| `previewAudio.ts` | Ganancias en cualquier instante: normalización (`getNormalizationGain`) + `gainDb`, fundidos `qsin` de `getPlacementFades`, compensación 1/√n (`getCompensationSteps` + `evaluateCompensation`, extraídos de `getCompensationExpr` sin cambiar la expresión: los *snapshots* siguen iguales), música (`getMusicSchedule`, fundidos cruzados, `afade` final de max(2 s, D)), *ducking*, efectos y fundido global. |
| `previewCanvas.ts` | Pinta la lista (DOM, sin Electron ni React). |
| `previewEngine.ts` | Aplica todo: *pool* de `<video>`/`<audio>`, grafo WebAudio, fuentes (`FontFace`), imágenes y bucle `requestAnimationFrame`. |

Integración: `hooks/useMixLivePreview.ts` (plan de `useMixOverlays`, sonoridad cacheada, duraciones de la música, sincronía con el cursor) y en `App.tsx` solo: el *hook*, el componente sobre el player, `mixPreviewActive` en las acciones `togglePlay*`/`play`/`pause` (barra espaciadora) y pausar el player de la fuente al entrar en Mix. `loudness.ts` gana `getCachedLoudness` (solo lee la caché, sin medir).

### Decisiones

- **Canvas con `drawImage`** en vez de `<video>` posicionados con CSS: es exacto con el recorte de la fuente (el mismo `getCropForAspect`), resuelve fundidos, rellenos y overlays en un único sitio y el orden de capas es trivial. El canvas se dimensiona en px de dispositivo, como mucho al tamaño de salida.
- **Transiciones**: todas se dibujan como fundido cruzado de opacidad (también el fundido final hacia el relleno). Los tipos con geometría (`wipe*`, `slide*`, `circleopen`…) solo se ven en el render.
- **Relleno desenfocado**: la columna más cercana que muestra un clip en ese fotograma (el render usa una que se reproduzca durante todo el bloque), dibujada a 1/12 en un canvas auxiliar con `blur(1.5px)` y escalada. Nunca toma como fuente la columna que se está rellenando.
- **Audio**: cada elemento → `MediaElementAudioSourceNode` → `GainNode` (ganancia recalculada en cada fotograma con `setTargetAtTime`, 15 ms) → ganancia maestra (volumen del player de la app) → `DynamicsCompressorNode` (umbral −2 dB, ratio 20, ≈ `alimiter`) → salida. Efectos: `AudioBuffer` decodificado (leído con `fs`, porque `fetch` no admite `file:`) y `AudioBufferSourceNode.start(when, offset, duration)` al reproducir o buscar.
- **Ducking aproximado**: baja `amountDb` mientras suena algún clip audible (intervalos fusionados), con rampas lineales de 50 ms (ataque) y 400 ms (relajación), en vez del compresor con la señal real.
- **Sonoridad**: solo la cacheada (`getCachedLoudness`); la previsualización nunca lanza el análisis. Los clips sin medida suenan con su `gainDb` y la vista avisa ("Los volúmenes no están normalizados…") hasta que una previsualización o un montaje llene la caché. Duración de las pistas sin medida: ffprobe (`getDuration`), una vez por sesión.
- **Fuentes no reproducibles**: se intenta el fichero original; si el `<video>` da error o no tiene vídeo (`videoWidth = 0`), se busca una copia *html5ified* existente (`findExistingHtml5FriendlyFile`, la del `previewFilePath` de html5ify, en `customOutDir` o junto a la fuente; las *dummy* no sirven) y, si no hay, se dibuja un marcador con el color y el nombre del clip.
- **Cursor**: hacer clic en los carriles mueve el cursor y la previsualización busca ahí; al reproducir, el cursor sigue a la previsualización cada 250 ms (cada actualización re-renderiza `App`, como el `timeupdate` del player); al pausar queda exacto. El fotograma se queda visible al pausar y, al llegar al final, se mantiene el último.

### Rendimiento (medido sin pantalla)

- **Parte pura** (Node, Xeon 2,1 GHz): plan de 80 clips (442 s, 3 columnas máx.) con 4 overlays; lista de dibujo + overlays + peticiones + *pool* + ganancias: **16 µs por fotograma** de media. Irrelevante frente a los 33 ms de 30 fps.
- **Motor completo** en el Chromium de Playwright (*headless*, **sin GPU**: canvas y decodificación por software, 4 vCPU), con los medios de T02 pasados a VP9 (ese Chromium no trae H.264):
  - 2 columnas 1080p en un canvas de 1280×720: ~60 fps (16–17 ms entre fotogramas; `tick` 15 ms de media). Deriva de los vídeos entre −0,05 y +0,04 s, sin saltos tras el arranque.
  - 3 columnas 1080p (plan escrito a mano): ~21 fps (45 ms por `tick`, casi todo en `drawImage`: convertir tres fotogramas YUV 1080p por software). No depende del tamaño del canvas (igual a 960 px de ancho).
  - Con aceleración por GPU (lo normal en Electron en un equipo medio), `drawImage` de un vídeo es una copia de textura y el coste por software desaparece: se espera ≥ 30 fps con 3 columnas 1080p, pero **no se ha podido comprobar aquí**. La barra de controles muestra los fps medidos para comprobarlo en la app.
- Capturas de la prueba: columnas con fundido cruzado, re-layout con el relleno izquierdo desenfocado apareciendo, fuente H.264 no reproducible mostrada como marcador, textos con borde/sombra y *typewriter*, contador, barra e imagen.

### Prueba manual

1. Abrir un proyecto con 5–10 clips de fuentes distintas (horizontales y verticales), música, *ducking* activado y overlays de cada tipo (imagen, texto con *typewriter*, contador, barra y sonido).
2. Pestaña **Mix**: el player se sustituye por la previsualización, con el aviso de "aproximada". El player de la fuente se pausa.
3. Barra espaciadora: reproduce/pausa. Al pausar, el fotograma queda visible y el cursor de la vista Mix queda en ese instante.
4. Clic en los carriles de la vista Mix: la previsualización salta ahí (en pausa, el fotograma cambia; reproduciendo, sigue desde ahí). La barra inferior de la previsualización también busca (clic y arrastre).
5. Comparar con **Previsualizar** (render): mismas columnas/filas, recortes, re-layouts, rellenos, separaciones, overlays y fundidos a negro; las transiciones con geometría se ven como fundido.
6. Audio: los clips suenan a volúmenes parecidos (tras haber previsualizado o montado una vez; antes sale el aviso de volúmenes sin normalizar); la música baja con los clips si hay *ducking* y hace fundido cruzado entre pistas; los efectos suenan en su sitio. El volumen del player de la app afecta a la previsualización.
7. Salida vertical 9:16 y cuadrada: filas apiladas a ancho completo.
8. Una fuente que Chromium no reproduzca (p. ej. HEVC sin soporte o un códec raro): sin copia *html5ified*, marcador con el nombre del clip; tras "Convertir a formato compatible" de esa fuente (pestaña Fuente), al volver a la pestaña Mix se usa la copia.
9. Volver a la pestaña **Fuente**: la previsualización se detiene y libera los vídeos; el player de la fuente vuelve a funcionar.
10. Rendimiento: con 3 columnas 1080p, comprobar los fps que muestra la barra (objetivo ≥ 30).

### Limitaciones conocidas y dudas

- **Audio en el build empaquetado**: `MediaElementAudioSourceNode` entrega silencio si Chromium considera el medio de otro origen (CORS). En desarrollo `webSecurity` está desactivado; en producción la página y los medios son `file://`, que Electron trata como mismo origen, pero **no se ha podido comprobar sin pantalla**. Si en el build no se oyen los clips, es esto.
- Los `<video>` no se añaden al DOM (se dibujan en el canvas). Chromium los reproduce igual; si alguna plataforma los suspendiera por no ser visibles, habría que colgarlos de un contenedor oculto.
- Con la pestaña Mix activa, la previsualización tapa también el control de volumen y el selector de pistas del player (el volumen sigue aplicándose).
- El marcador de fuente no reproducible se decide la primera vez que falla; una copia *html5ified* creada después se usa al volver a entrar en la pestaña Mix.
- Mientras se busca, un vídeo que aún no tiene fotograma deja ver el color de separación durante un instante.
- Cada edición del proyecto durante la reproducción vuelve a programar los efectos de sonido (puede cortar uno que esté sonando).
- La primera reproducción puede arrancar con una deriva de hasta ~0,1 s hasta que el ajuste de velocidad la absorbe.

## Revisión

- **Resultado**: aceptada. `tsc`, `lint`, tests (776) y `build` en verde. Rendimiento sin GPU: 2 columnas a ~60 fps y 3 columnas a ~21 fps (dibujo por software); con GPU está pendiente de verificar en la app.
- **Riesgo abierto**: el audio de WebAudio con `file://` en la app empaquetada. T33 lo comprueba en Electron real con un `AnalyserNode`, si puede ejecutar Electron.
