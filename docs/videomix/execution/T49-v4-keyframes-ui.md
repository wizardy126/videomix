# T49 · v4: edición de keyframes (A9)

- **Hito**: M11 · **Modelo**: Opus · **Depende de**: T44, T45, T48 · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- Helpers de keyframes de T44, notas de T45 (barra del editor) y T48. `RectOverlay.tsx`, `RectOverlayToolbar.tsx`, `ClipRectEditor.tsx`, timeline heredado (marcas del clip activo), atajos.

## Alcance

1. Botón **"Animar"** (cronómetro) por clip: activa los keyframes (crea el primero en el instante actual con el encuadre actual). Desactivarlo borra los keyframes, con confirmación.
2. **Auto-key**: con el clip animado, el editor muestra el recorte interpolado en el instante del cursor; mover o escalar el recorte (proporción bloqueada) crea o actualiza el keyframe de ese instante (un paso de historial por gesto). Con el clip animado, el tirador del mín. y los que cambian la proporción se comportan de forma coherente (decide y documenta; p. ej. editar la proporción solo sin animar, o aplicar a todos los keyframes).
3. **Marcas** de keyframes en la línea de tiempo del clip; **anterior / siguiente** (con atajos) y **borrar** el del instante actual.
4. **Interpolación por keyframe**: suave (por defecto), lineal, mantener; selector en la barra cuando el cursor está sobre un keyframe.
5. Compatibilidad: el indicador de encaje (T45) y el imán siguen funcionando (la proporción no cambia); copiar/pegar (T46) según la decisión de T44.
6. **Barra del editor** (preexistente desde T06, empeorado al crecer en T45): cuando el máx. toca el borde superior del fotograma, la barra tapa la etiqueta de tamaño y los tiradores superiores (captura `13a-turned-clip-editor.png`). Recolocarla para que nunca tape tiradores ni etiquetas (p. ej. fuera del área de la imagen o en la parte libre), sin romper los e2e.
7. i18n (en + es).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde; e2e: activar Animar, mover el recorte en dos instantes, comprobar las marcas y que la previsualización en vivo cambia entre ellos.

## Notas de ejecución

### Resumen

- **Lógica pura** (`clipKeyframes.ts`, con tests): `getAnimatedRectsEdit({ clip, time, shown, edited })` traduce una edición del overlay sobre un clip animado a su cambio (keyframe del instante o mín. base) y `limitKeyframesToRect(maxRect, keyframes, bounds)` mete todos los keyframes en un rectángulo (para "Quitar bandas negras").
- **Auto-key** (`ClipRectEditor.tsx`): con keyframes, el overlay muestra `getClipRectsAt(clip, cursor, fotograma)`; cada paso de un arrastre (o cada pulsación de flecha) se convierte con `getAnimatedRectsEdit` y va por el mismo camino transitorio + commit que los rectángulos (un paso de historial por gesto; las flechas repetidas se agrupan como antes). El instante del gesto (y el clip y los rectángulos mostrados) se congelan en su primer paso, así que un arrastre durante la reproducción no siembra keyframes; `RectOverlay` avisa del final del arrastre con `onDragEnd` (nuevo, también si se cancela o no cambia nada). Los manejadores de `useMixClips` (`handleRects*`) reciben ahora un `MixClipPatch` en vez de `ClipRects`.
- **Barra** (`RectOverlayToolbar.tsx`): botón **Animar** (cronómetro, `animate-toggle`, `aria-pressed`, ámbar si está activo) y, con el clip animado: keyframe anterior / siguiente (`keyframe-prev`/`keyframe-next`, desactivados si no hay), **añadir** (`keyframe-add`, con el encuadre que se ve: sirve para "quedarse quieto hasta aquí") o **borrar** (`keyframe-remove`) el del cursor, y el selector de **interpolación** (`keyframe-interpolation`: Suave / Lineal / Mantener) cuando el cursor está sobre un keyframe.
- **Acciones** (`hooks/useClipKeyframes.ts`, nuevo; un paso de historial cada una): activar/desactivar (con confirmación, `askForStopAnimating` en `dialogs.ts`), añadir, borrar, interpolación e ir al anterior/siguiente (`seekAbs`).
- **Marcas** en la línea de tiempo heredada (`Timeline.tsx`, prop nueva `clipKeyframeTimes`): rombos ámbar abajo del todo (`clip-keyframe-mark`), sin eventos de puntero; los tiempos ya son de la fuente.
- **Atajos** nuevos (`KeyboardAction`, `configStore.ts`, `KeyboardShortcuts.tsx`, `App.tsx`): `Mayús+,` / `Mayús+.` keyframe anterior / siguiente (junto a `,`/`.`, fotograma anterior/siguiente) y `Mayús+Retroceso` borrar el del cursor. Ninguno estaba usado por otro atajo ni acelerador de menú. "Añadir keyframe" y "Animar" sin atajo por defecto (como las demás acciones nuevas).
- **Barra fuera de la imagen (punto 6)**: `ClipRectEditor` monta la barra con un portal en una franja encima del reproductor (`hooks/useMixToolbarSlot.ts`, `data-testid="rect-toolbar-slot"`, fondo `--gray-3`, prop `docked` de la barra sin fondo propio); el área del reproductor (`no-user-select`) empieza debajo (`top` = alto medido de la franja, 0 si está vacía) y `useMixPlayerTurn` observa ahora esa área (ref nueva) en vez de todo el contenedor. Con la onda grande (`bigWaveformEnabled`) la barra vuelve a su sitio anterior, oculto con el reproductor. En la vista Mix la previsualización en vivo tapa la franja como antes tapaba la barra.
- i18n (en + es), [04-diseno](../04-diseno.md) §10.3 (edición) y manual (párrafo "Animar el encuadre" y fila de atajos).

### Decisiones (conservadoras)

1. **Solo paneo y zoom mientras está animado**: los tiradores del máx. escalan con la proporción del máx. base bloqueada (se pasa como `aspectLock` al overlay, lo que además desactiva el imán sobre el máx., como ya hacía T45 con una proporción fija). La escala del keyframe es la media geométrica de ambos ejes (`getTransformFromMaxRect`), así el redondeo a pares nunca acumula deriva de proporción.
2. **Mín. de un clip animado**: moverlo o redimensionarlo cambia el **mín. base** (su posición relativa dentro del máx.), es decir, en todos los keyframes; el imán sigue actuando sobre él (la proporción de la celda se conserva al escalar). No se anima el mín. por separado (A9: máx. y mín. juntos).
3. **Acciones de la barra sobre un clip animado** (duda 3 de T44): proporción, "Ajustar a", "Rellenar fotograma", "Añadir mín." y "Mín. = Máx." editan los rectángulos **base**; cada keyframe conserva su centro y su escala relativa (con "Ajustar a" y la proporción, que conservan el alto en columnas, cada keyframe conserva su alto y su centro y cambia su ancho). No se deshabilitan: sería obligar a desactivar Animar (y perder los keyframes) para cambiar la proporción. El encaje se sigue calculando sobre la base, así que los chips y la lista reflejan el cambio al instante. El selector de proporción sigue mostrando el bloqueo guardado; mientras el clip está animado el overlay usa siempre la proporción base.
4. **"Quitar bandas negras" en un clip animado**: recorta la base igual que sin animar y además limita cada keyframe a la zona con imagen (`limitKeyframesToRect`, escala y luego centro, como `clampTransform` con el fotograma). Como los bordes se mueven linealmente con el mismo peso entre keyframes, toda la animación queda dentro. El aviso "no hay bandas" solo sale si no cambia ni la base ni ningún keyframe.
5. **Pegar el encuadre** (T46): sin cambios, lo que fijó T44: sustituye máx., mín., giro y keyframes del destino; pegar un encuadre sin animar sobre un clip animado le quita la animación (un paso de deshacer).
6. **Desactivar Animar / borrar el último keyframe**: el clip se queda con el encuadre **que se ve en el cursor** (`getClipRectsAt`), no con los rectángulos base (que podrían no haberse visto nunca). Desactivar pide confirmación; borrar el último no (es un paso normal que se deshace).
7. **Instante de los keyframes**: el del cursor (`relevantTime`, tiempo de la fuente) con la tolerancia de `KEYFRAME_TIME_EPSILON` (1 ms): tras "anterior/siguiente" el cursor queda exactamente en el keyframe. No se limita al tramo del clip: un keyframe fuera del tramo es válido en el modelo (T44) y actúa como extremo; sus marcas se ven igual en la línea de tiempo.
8. **Durante la reproducción** el overlay de un clip animado se actualiza con `relevantTime` (≈ 4 veces por segundo, `timeupdate`); es orientativo, la previsualización en vivo es la referencia.
9. **Barra**: una franja propia encima del reproductor en vez de colocarla "en la parte libre": con un máx. a pantalla completa no hay parte libre garantizada. El reproductor pierde el alto de la franja (una línea con el ancho habitual, dos si se estrecha) solo mientras hay un clip seleccionado.

### Observaciones

- Con la imagen ocupando todo el área del reproductor, los tiradores que caen justo en el borde siguen viéndose solo a medias (el `svg` recorta lo que sale del área); era así antes en los lados (los e2e ya lo tenían en cuenta) y ahora también arriba, pero ya no los tapa nada.
- Los usuarios con los atajos guardados de una versión anterior no ven los nuevos hasta restablecerlos (lo mismo que en T46).

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (93 ficheros, 1136 tests), `yarn build` y `yarn test-e2e` (22/22) en verde; `yarn scan-i18n` y `yarn generate-docs` sin cambios pendientes.
- Tests nuevos en `clipKeyframes.test.ts` (`editing an animated clip in the overlay (T49)`): mover/escalar el máx. añade o actualiza el keyframe (conserva su interpolación) y lo mostrado es exactamente el máx. editado; editar el mín. cambia el mín. base; sin cambios devuelve lo que había; `limitKeyframesToRect` (escala, centro, sin cambios y toda la animación dentro).
- **e2e 19** (`VideoMix (framing keyframes)`, fuente 1280×720 de barras SMPTE, fijas): la barra queda encima de los tiradores superiores y de la etiqueta; "Ajustar a 1/2" (640×720); Animar a 1 s (1 marca, interpolación "smooth"); arrastrar el máx. al borde izquierdo a 1 s y al derecho a 3 s (2 marcas, 640×720 conservado); Ctrl+Z / Ctrl+Mayús+Z de un gesto; a 2 s el editor muestra el punto medio (suave); "anterior" lleva a 1 s y con "Mantener" a 2 s sigue a la izquierda; "siguiente" lleva a 3 s; la **previsualización en vivo** (sin E7) cambia entre 2 s y 3,5 s (proporción de verde 0,40 → 0,14: barras de la izquierda / de la derecha); desactivar Animar pide confirmación, quita las marcas y deja 640×720.
- Capturas revisadas: `19a-keyframes` (barra en su franja en dos líneas, rombos en la línea de tiempo), `19b`/`19c` (previsualización con la mitad izquierda / derecha), `13a-turned-clip-editor` (máx. a toda la altura: la barra ya no tapa la etiqueta ni los tiradores superiores), `16*` y `18*` sin cambios de comportamiento.

## Revisión

- **Resultado**: aceptada (captura 19a revisada). Decisiones 1–7 sobre clips animados aceptadas.
- **Validación del orquestador**: tsc, lint, 1136 tests, e2e 22/22.
