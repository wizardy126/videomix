# T22 · Overlays: pistas en la vista Mix y panel de propiedades

- **Hito**: M7 · **Modelo**: Opus · **Depende de**: T19 · **Estado**: hecha

## Objetivo

Crear y editar imágenes, contadores, barras y sonidos desde la vista "Mix".

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §9.2 y §9.3
- [04-diseno](../04-diseno.md) §8.4
- Notas de T15 (`MixPlanView`, mini vista del fotograma), T06 (`overlayMath`: arrastre de rectángulos) y T04 (ediciones *transient* y undo)
- Modelo y reducer de T19

## Alcance

1. **Carriles nuevos en `MixPlanView`**: Imágenes, Contadores/barras y Sonidos.
   - Los bloques se colocan en su tiempo resuelto.
   - Arrastrar mueve el inicio: cambia el `offset` si el elemento está anclado o `time` si es absoluto. Arrastrar el borde derecho cambia la duración (no aplica a los sonidos).
   - Cada arrastre es un único paso de undo.
2. **Añadir**: botones o menú "Add image… / Add countdown / Add progress bar / Add sound…". Por defecto se colocan en el cursor de la vista Mix, con tiempo absoluto. Los diálogos de fichero filtran por tipo: PNG; wav, mp3, m4a, ogg, flac; ttf, otf.
3. **Panel de propiedades** del elemento seleccionado, con todos los campos del modelo:
   - anclaje: tipo, clip o elemento, borde y desplazamiento;
   - cajas y presets de posición;
   - colores, fuente, decimales, dirección, etc.;
   - duplicar, borrar y subir o bajar de capa.
   - Para la barra, "vincular a contador".
4. **Colocación visual**: los elementos visuales se arrastran y redimensionan sobre la mini vista del fotograma (reutiliza `overlayMath` en coordenadas 0..1). Si T20 ya dibuja las cajas en la mini vista, se integran; si no, las dibuja esta tarea. Coordínalo leyendo el árbol.
5. **Avisos** de `resolveOverlayTimes` visibles: ciclo, referencia borrada o fuera de duración.
6. **Borrar un clip** del que dependen elementos: convierte esos anclajes en absolutos (acción de T19) y avisa con un toast.
7. **i18n** con claves en inglés y traducción al español.

## Criterios de aceptación

- Se puede crear cada tipo, anclarlo a un clip y a otro elemento, moverlo y deshacer.
- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.
- Instrucciones de prueba manual en las notas.

## Notas de ejecución

### Ficheros

| Fichero | Cambio |
|---|---|
| `videomix/overlayTimeline.ts` (+ test, 19 tests) | Nuevo, puro: carriles (`getOverlayLane`, `layoutOverlayLanes` con sub-filas para bloques solapados), arrastre de bloques (`pixelsToSeconds`, `getOverlayMovePatch`, `getOverlayResizePatch`), cambio de tipo de anclaje (`getAnchorOfKind`), cajas visibles en la mini vista (`getOverlayFrameBoxes`), arrastre de cajas (`applyOverlayBoxDrag`, que reutiliza `overlayMath.applyRectDrag` en px de salida), caja de una imagen con su proporción (`getImageBox`), texto del contador para la mini vista (`formatCountdownText`) y colores con alfa (`splitOverlayColor`/`joinOverlayColor`). |
| `videomix/overlayRemoval.ts` (+ test, 6 tests) | Nuevo, puro: qué borra una acción (también en `batch` y por fuente), qué elementos se desanclan y `prepareOverlayRemoval`, que añade `resolved` (plan + `resolveOverlayTimes` calculados en el momento). |
| `videomix/overlayTexts.ts` | Nuevo: textos traducidos de tipos, carriles y avisos de `resolveOverlayTimes`. |
| `videomix/hooks/useMixOverlays.ts` | Nuevo: plan (con *debounce*, solo con la vista "Mix" abierta), tiempos resueltos (sin *debounce*), selección, cursor de la vista "Mix", añadir (diálogos filtrados: PNG; wav/mp3/m4a/ogg/flac; ttf/otf), reemplazar ficheros, duplicar, borrar y capas. |
| `videomix/hooks/useOverlaySoundDurations.ts` | Nuevo: duración de los sonidos con `getDuration` (ffprobe), perezosa y en caché de memoria por ruta. |
| `videomix/components/MixPlanView.tsx` | Carriles Imágenes / Contadores y barras / Sonidos, bloques arrastrables (mover y borde derecho), cursor rojo, botones de añadir y cajas de los elementos en la mini vista (más grande: 108 px de alto) con arrastre y 8 tiradores. |
| `videomix/components/OverlayPanel.tsx` | Nuevo: panel de propiedades. |
| `hooks/useMixProject.ts` | `dispatch` pasa por `prepareOverlayRemoval` y muestra el toast de elementos desanclados. |
| `hooks/useMixWorkspace.ts` | `missingOverlayFiles` filtrado por elementos existentes y toast al abrir si faltan ficheros de elementos. |
| `renderDialogs.tsx` | `getIssueText` traduce los códigos nuevos de T19 (tercer parámetro opcional `overlayName`). |
| `App.tsx` | 3 puntos comentados: imports; `useMixOverlays` tras `showMixPlan`; en la barra derecha, `OverlayPanel` en lugar de `ClipList` si hay un elemento seleccionado en la vista "Mix"; y 3 props nuevas de `MixPlanView`. |
| `locales/en`, `locales/es` | `scan-i18n` y 95 traducciones al español (el resto de claves sin traducir son antiguas de LosslessCut). |
| `04-diseno` §8.4 | Resumen de la UI y de las dos decisiones siguientes. |

### Decisiones

- **`resolved` en todos los borrados, centralizado**: en vez de tocar cada punto de llamada (`useMixClips.userRemoveClip`, el `batch` de `clipSegments` al borrar segmentos en el timeline, `userRemoveSource` y el borrado de elementos), `useMixProject.dispatch` detecta cualquier `removeClip`/`removeSource`/`removeOverlay` (también anidados en `batch`) de los que dependa algún elemento, calcula el plan y los tiempos en ese momento (el planificador es rápido) y añade `resolved`. Después muestra un toast con el número de elementos que pasan a tiempo absoluto. Si nada depende de lo borrado, la acción no cambia y no se planifica.
- **Duración de los sonidos en la UI**: ffprobe (`getDuration`) la primera vez que aparece cada ruta; se guarda en memoria (también los fallos, como desconocida) para no volver a lanzar ffprobe en cada paso de un arrastre. Mientras no se conoce, el bloque se dibuja estrecho con aviso "duración desconocida". No depende de T21 (que la saca de la medida de sonoridad para el render).
- **Panel en la barra derecha**: el área inferior es baja, así que el panel ocupa el sitio de la lista de clips mientras hay un elemento seleccionado **y** la pestaña "Mix" está activa. Se cierra con la ✕, haciendo clic en una zona vacía de un carril de elementos o volviendo a "Source".
- **Cursor de la vista "Mix"**: la vista no tenía cursor; ahora un clic en cualquier punto de los carriles lo mueve (línea roja) y se muestra su tiempo. Los elementos nuevos se añaden ahí con tiempo absoluto. La mini vista muestra el instante bajo el ratón o, si no, el del cursor (antes, `t = 0`).
- **Arrastres**: mover cambia `offset` si el elemento está anclado y `time` si es absoluto, sin bajar de 0 s; el borde derecho cambia la duración (mínimo 0,1 s; no en sonidos). Tiempos redondeados a 1/100 s. Una barra vinculada a un contador no se puede mover ni redimensionar (toma los tiempos del contador). Cada arrastre es un paso de undo (`transient` + `commitTransient` al soltar; `pointercancel` lo deshace). Antes de empezar se confirma cualquier edición *transient* pendiente para no mezclarlas.
- **Cajas en la mini vista**: se dibujan en orden de capas con un contenido aproximado (la imagen real, el texto del contador con su color y tamaño en `cqh`, la barra con su relleno en ese instante). El elemento seleccionado se muestra siempre (semitransparente y con borde discontinuo si no está visible en ese instante) para poder colocarlo; sus tiradores van encima de todo. Las imágenes mantienen la proporción al redimensionar salvo con Mayús; el resto al revés.
- **Imagen nueva**: se lee su tamaño con `readFileFfprobeMeta` para ajustar el alto de la caja a su proporción (si falla, se queda la caja de la fábrica).
- **Cambio de tipo de anclaje**: a "En un instante" conserva el inicio actual; a clip o elemento empieza en el inicio del primer destino válido con desplazamiento 0. Los destinos de tipo elemento y los contadores para "Vincular a cuenta atrás" se filtran con `canOverlayDependOn` (no se ofrecen los que crearían un ciclo).
- **Campos numéricos**: se aplican al salir del campo o con Enter (Escape descarta), así escribir "12.5" es un solo paso de undo; las flechas del campo se aplican al momento. Los colores son *transient* mientras se elige y se confirman al salir del selector. Los colores con alfa (relleno y fondo de la barra) tienen un campo de opacidad en %.
- **Nombres**: "Countdown #1", "Progress bar #1"… con `getNextNumberedName` de los clips; al duplicar, `getDuplicateClipName`. Imágenes y sonidos toman el nombre del fichero.

### Coordinación con T20 y T21

- La mini vista y las cajas son de esta tarea. T20 ha añadido en paralelo `overlays/overlayFrames.ts` (`getVisibleOverlayBoxes`, formato del contador por fotogramas); no se usa aquí porque estaba a medias. El texto del contador de la mini vista (`formatCountdownText`) es solo orientativo; se puede unificar con el de T20 en T23.
- **Pendiente fuera de mis ficheros**: `useMixRender` (de T20/T21) llama a `getIssueText(issue, clipName)`; para que los avisos de elementos muestren el nombre y no el id, debe pasar como tercer argumento el nombre del elemento (`issue.overlayId`). No lo he tocado.

### Tests

- `overlayTimeline.test.ts` (19) y `overlayRemoval.test.ts` (6, con el planificador real: el elemento anclado a un clip borrado queda en su inicio actual y la barra vinculada a un contador borrado conserva inicio y duración).
- `yarn tsc`, `yarn lint`, `yarn test run` (44 ficheros, 525 tests) y `yarn build` en verde.
- No se ha podido lanzar la app (sin pantalla).

### Prueba manual

Preparación: `yarn dev`, un proyecto con ≥ 2 fuentes de `test-media/` y ≥ 4 clips; un PNG con transparencia, un wav/mp3 corto y un TTF/OTF cualquiera. Pulsa la pestaña "Mix".

1. **Carriles y cursor**: bajo los carriles de columnas aparecen "Images", "Countdowns and bars" y "Sounds" (vacíos). Haz clic en un punto de los carriles: la línea roja se mueve y "Cursor: …" muestra el tiempo; con el ratón fuera, la mini vista enseña ese instante.
2. **Añadir cada tipo**: "Add image…" (el diálogo solo deja elegir PNG) → bloque azul de 5 s en el cursor, caja centrada con la proporción de la imagen y la imagen en la mini vista; se abre el panel en la barra derecha. "Add countdown" → bloque naranja de 10 s y el número arriba a la derecha. "Add progress bar" → bloque verde y barra abajo. "Add sound…" (wav/mp3/m4a/ogg/flac) → bloque morado; al poco toma la duración del fichero (antes, estrecho con ▲ "duración desconocida").
3. **Mover y deshacer**: arrastra un bloque: se mueve en vivo; suelta y pulsa deshacer (Ctrl+Z): vuelve entero a su sitio en un solo paso; rehacer lo repite. Arrastra el borde derecho de la imagen: cambia la duración (el de los sonidos no existe). Arrastra un bloque hacia la izquierda más allá de 0: se queda en 0.
4. **Anclar a un clip**: en el panel, "Start" → "Anchored to a clip", elige un clip, "Edge" → "End", "Offset" → `1` (Enter). El bloque se coloca 1 s después del fin de ese clip. Cambia el orden de los clips o un ajuste del montaje: el bloque sigue al clip. Arrástralo: cambia el "Offset" (no pasa a absoluto).
5. **Anclar a otro elemento**: selecciona el sonido → "Anchored to an overlay" → el contador, "Edge" → "End". El sonido empieza al acabar el contador; mueve el contador y el sonido lo sigue. Selecciona el contador → "Anchored to an overlay": el sonido no aparece en la lista (crearía un ciclo).
6. **Barra vinculada**: selecciona la barra → "Link to countdown" → el contador: el bloque se alinea con el del contador, desaparecen inicio y duración del panel y el bloque ya no se arrastra. Vuelve a "None": recupera su tiempo propio.
7. **Colocación en la mini vista**: arrastra la caja del contador y sus tiradores; los valores de "Position and size" cambian; Ctrl+Z deshace cada arrastre de una vez. Una imagen mantiene la proporción (con Mayús, libre). Prueba los presets ↖ ↗ ↙ ↘ ● ⛶. La caja no sale del fotograma.
8. **Propiedades**: cambia colores (el selector aplica en vivo; un solo undo al cerrarlo), fuente ("Choose a font" solo TTF/OTF; ✕ vuelve a la fuente por defecto), decimales, ceros a la izquierda, alineación, borde, sombra, *fades*, dirección y modo de la barra, opacidad del fondo de la barra, volumen del sonido. Renombra el elemento (Enter). Todo se deshace paso a paso.
9. **Capas y duplicar**: con dos imágenes solapadas, "Bring forward"/"Send backward"/"Bring to front"/"Send to back" cambian cuál se ve encima en la mini vista. "Duplicate" crea "… #2" encima y lo selecciona.
10. **Avisos**: mueve un elemento más allá del final del vídeo: ▲ en el bloque y en el panel "Outside the video…"; a medias, "Partly outside the video…".
11. **Borrar con dependientes**: con la imagen anclada a un clip, borra ese clip (lista de clips o borrando su segmento en el timeline de la fuente): toast "1 overlay(s) anchored to what was removed now start at a fixed time" y la imagen queda en el mismo sitio, ahora "At a time". Ctrl+Z restaura el clip y el anclaje. Igual al borrar el contador (el sonido anclado y la barra vinculada conservan su tiempo) y al quitar la fuente del clip.
12. **Ficheros que faltan**: guarda el proyecto, cierra, renombra el PNG y abre el `.vmx`: toast de ficheros de elementos no encontrados (si no faltan fuentes). Selecciona la imagen: ▲ "File not found" con "Locate..."; elige el PNG: desaparece el aviso. Borra un elemento con fichero perdido: ya no cuenta.
13. **Idioma**: en español, carriles "Imágenes / Cuentas atrás y barras / Sonidos", botones "Añadir imagen…" etc. y el panel traducido.

### Dudas y limitaciones

- Sin zoom horizontal (como T15): en montajes largos los bloques cortos son estrechos (mínimo 1 % del ancho).
- La mini vista es aproximada para el contador (fuente del sistema, borde como sombra suave) y no aplica *fades*; la previsualización real es la de T20.
- Si la barra derecha está oculta, el panel no se ve (ocupa el sitio de la lista de clips).
- "Replace…" en el panel no borra un aviso de "File not found" pendiente (sí lo hace "Locate..."); se ve hasta volver a abrir el proyecto.

## Revisión

- **Resultado**: aceptada. `tsc`, `lint`, tests (525) y `build` en verde. Falta la prueba manual del usuario.
- **Se acepta**: centralizar `resolved` en `dispatch`.
- **Pendientes para T23**:
  - pasar `overlayName` a `getIssueText` desde `useMixRender`;
  - unificar el texto del contador de la mini vista con `overlayFrames.getCountdownTextAt` (T20);
  - que "Replace…" limpie el aviso de fichero no encontrado.
