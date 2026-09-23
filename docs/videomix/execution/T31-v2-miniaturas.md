# T31 · v2: miniaturas (A2)

- **Hito**: M8 · **Modelo**: Sonnet · **Depende de**: T29 · **Estado**: hecha

## Alcance

1. **Generación**:
   - miniatura por clip: fotograma de `start` recortado al máx., ~160 px de alto, JPEG;
   - generada con ffmpeg (`captureFrameToFile` o equivalente, con `crop`);
   - caché en `userData/videomix-thumbs/`, con clave de ruta, mtime, `start` y `maxRect`;
   - cola con concurrencia limitada.
2. **Uso**: miniatura en las filas de `ClipList` y en los bloques de la vista Mix (si el bloque es lo bastante ancho).
3. Se regeneran al cambiar `start` o `maxRect`, con *debounce*, y hay limpieza de las antiguas.
4. **Tests** de la clave y de la cola.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

**Generación (main)**: `src/main/videomix/thumbnails.ts` (`captureThumbnail`), función nueva (no se reutiliza
`captureFrameToFile` porque no admite filtro `crop`): `-ss <start> -i <file> -frames:v 1 -vf
"crop=W:H:X:Y,scale=-2:160" -q:v <getFfmpegJpegQuality> -y <outPath>`. Sin `-noautorotate`: ffmpeg autorota antes del
`crop`, así que `crop` usa las mismas coordenadas orientadas que `MixClip.maxRect` (geometry.ts). Verificado a mano
con el ffmpeg de `ffmpeg/linux-x64` (`LD_LIBRARY_PATH=ffmpeg/linux-x64/lib`) sobre `h-1080p-10s.mp4`,
`v-1080x1920-12s.mp4` y `v-rotated-9s.mp4` (rotación 90° por *display matrix*): las miniaturas salen con la
orientación y el recorte correctos (recortes asimétricos del fotograma de test confirman que `x`/`y` caen donde
se espera en coordenadas ya rotadas). Expuesta en `remoteApiLegacy.videomix.captureThumbnail` (src/main/index.ts).

**Caché y cola (puro)**: `src/renderer/src/videomix/thumbnails.ts`:
- `getThumbnailCacheKey` — `sha1(absolutePath + mtime + size + start + maxRect)`, mismo esquema que
  `getLoudnessCacheKey` (loudness.ts); también es el nombre del fichero de caché, así que un fichero existente ya es
  el acierto de caché.
- `ThumbnailQueue` — cola con concurrencia limitada; encolar de nuevo bajo una clave que aún no ha empezado a
  ejecutarse sustituye su tarea en vez de añadir una segunda (una miniatura reencolada varias veces antes de que le
  toque turno solo ejecuta la última).
- `captureThumbnail` (wrapper) — mismo patrón que loudness.ts/encoders.ts, vía `@electron/remote`.
- Tests en `thumbnails.test.ts` (clave estable/sensible a cada campo; cola: límite de concurrencia, sustitución de
  una tarea aún en espera, reentrada de una clave ya ejecutada, una tarea que falla no bloquea el resto).

**Hook**: `src/renderer/src/videomix/hooks/useClipThumbnails.ts`. Por clip: *debounce* (400 ms) sobre un "spec"
(ruta + `start` + `maxRect`, para no reaccionar a cambios ajenos como el nombre o el color) → `fs.stat` → clave →
si el fichero de caché ya existe se usa directamente, si no se encola la generación. Limpieza del directorio (y de
las entradas ya no referenciadas del estado) tras un *debounce* propio (3 s) posterior a cada generación/acierto.
Concurrencia 2. Se llama una sola vez desde `App.tsx` (no en `ClipList`/`MixPlanView`) y el mapa resultante
(`clipId → file URL`) se pasa a ambos como prop, para no generar la misma miniatura dos veces cuando ambas vistas
están visibles a la vez (pestaña Mix sin overlay seleccionado).

**Uso**:
- `ClipList.tsx`: miniatura fija (30×30, `object-fit: cover`) en la fila, junto al asa de arrastre; mientras no está
  lista se reserva el hueco con un `<div>` vacío del mismo tamaño (sin salto de layout). Prop nueva `thumbnailUrls`
  en `ClipList`/`ClipRow`.
- `MixPlanView.tsx`: miniatura de fondo (con una capa del color del clip encima, para no perder la identificación
  por color) en el bloque de `Block`, mostrada solo si el bloque es lo bastante ancho. Esto se resuelve con una
  *container query* CSS (`MixPlanView.module.css`, nuevo) en vez de medir el ancho en JS, porque el ancho del bloque
  ya se expresa en % dentro de un carril cuyo ancho en px no se rastreaba en ningún estado; `Block` gana
  `containerType: 'inline-size'`. Prop nueva `thumbnailUrls` en `MixPlanView`.
- `App.tsx`: llama a `useClipThumbnails` una vez y pasa `thumbnailUrls` a ambos componentes.

**Desviaciones**: el criterio de "bloque lo bastante ancho" se implementa con una *container query*, no con una
medición en JS del ancho del carril; es más simple aquí y evita añadir un `ResizeObserver` a `MixPlanView`. El
umbral (40 px) es una elección razonable, no un valor especificado por el requisito.

**Nota para el orquestador**: al terminar la tarea, `yarn tsc` y `yarn lint` fallan con un error preexistente y
ajeno a T31 en `src/renderer/src/videomix/mixPlanLayout.ts` / `planner/units.ts` (trabajo en curso de T30 sobre
`planner/**`, compartido). No se ha tocado nada de `planner/**`; los ficheros de T31 pasan `tsc`/`lint` limpios por
separado. `yarn test run` (710 tests) y `yarn build` están en verde.

## Revisión

- **Resultado**: aceptada. Miniaturas revisadas, incluida la fuente rotada. Validado en un árbol limpio sin los cambios de T30.
