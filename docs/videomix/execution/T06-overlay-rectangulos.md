# T06 · Overlay de rectángulos máx./mín.

- **Hito**: M2 · **Modelo**: Opus · **Depende de**: T03 · **Estado**: hecha

## Objetivo

Componente que dibuja y permite editar los rectángulos **máx.** y **mín.** de un clip sobre el vídeo, en coordenadas de la fuente.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.2
- [04-diseno](../04-diseno.md) §1.1, §2, §6.4
- [02-as-built](../02-as-built.md) §6: `<video>` con `object-fit: contain` en `App.tsx`, `MediaSourcePlayer` y rotación
- `geometry.ts` (T03)

## Alcance

1. **`videomix/overlayMath.ts`** (puro, con tests):
   - `getVideoContentBox(containerSize, videoSize)`, con el cálculo de `object-fit: contain`;
   - `toSourceCoords` y `toScreenCoords`;
   - aplicación de un arrastre (mover o redimensionar por tirador) con restricciones: `min ⊆ max ⊆ frame`, tamaño mínimo de 16 px, proporción fija opcional para el máx. y el mín. empujado o recortado cuando el máx. encoge.
2. **`videomix/components/RectOverlay.tsx`**:
   - SVG absoluto encima del `<video>` (mismo contenedor);
   - máx. con borde sólido del color del clip y el exterior oscurecido (máscara);
   - mín. con borde discontinuo;
   - 8 tiradores por rectángulo y arrastre interior para mover;
   - puntero y teclado: las flechas mueven 2 px y con Shift 10 px;
   - los rectángulos se ajustan siempre a valores pares (ver 04-diseno §2.4);
   - etiqueta con `w×h`, proporción y orientación;
   - props controladas `{ maxRect, minRect, onChange(transient), onCommit, aspectLock, videoSize, … }`;
   - no interfiere con el clic del vídeo fuera de los rectángulos, ni con la rueda (seek/zoom).
3. **Barra de herramientas mínima**:
   - presets de proporción del máx.: libre, 9:16, 3:4, 1:1, 4:3, 16:9;
   - "Mín. = Máx." (borrar el mín.);
   - "Rellenar fotograma".
4. **Tamaño real del vídeo**: `videoWidth` / `videoHeight` del elemento, que ya tienen en cuenta la rotación de metadatos en Chromium; hay que verificarlo.
   - Con el reproductor compat y la **rotación manual** de LosslessCut (`rotation` en `App.tsx`), documenta el comportamiento.
   - Propuesta: en VideoMix se ignora o desactiva la rotación manual.
5. Monta el overlay en `App.tsx` solo cuando hay un clip seleccionado o en edición. La integración real de los datos la hace T07. En esta tarea, basta una integración mínima con estado local o de prueba.

## Fuera de alcance

- La creación y persistencia de clips (T07).

## Criterios de aceptación

- Tests de `overlayMath` que cubran:
  - contenedores más anchos y más altos que el vídeo (bandas laterales y superiores);
  - redondeo;
  - restricciones de arrastre y proporción fija.
- `yarn tsc && yarn lint && yarn test run` en verde.
- Instrucciones de prueba manual en las notas.

## Notas de ejecución

### Cambios

- **`videomix/overlayMath.ts`** (puro, sin React) + **`overlayMath.test.ts`** (29 tests):
  - `getVideoContentBox(container, videoSize, cssRotation?)`: caja de `object-fit: contain` centrada. Con `cssRotation` de 90/270° reproduce lo que hace el reproductor compat (ver abajo).
  - `toSourceCoords` / `toScreenCoords`, `getFrameRect` (fotograma encogido a pares si la fuente es impar).
  - `applyRectDrag({ start, target, handle, dx, dy, videoSize, aspect })`: mover o redimensionar (8 tiradores) el máx. o el mín. a partir del estado inicial del arrastre y el desplazamiento total en px de la fuente (sin deriva acumulada). Garantiza bordes **pares**, `min ⊆ max ⊆ frame` y lados ≥ `MIN_RECT_SIZE` (16). Con `aspect` bloquea la proporción del máx. (±1 px por el redondeo a pares): en las esquinas manda el eje que más se ha movido y la esquina opuesta queda fija; en los lados crece el otro eje centrado y se desplaza para no salirse del fotograma.
  - Acciones de la barra: `applyAspect` (preset: conserva la altura, reduce si no cabe, centra y, si puede, mantiene el mín. dentro), `fillFrame`, `createDefaultMin` (mitad del máx., centrado).
  - `formatAspect` ("16:9", "9:16"… con 1 % de tolerancia; si no, "1.85:1"), `getStreamRotation` (etiqueta `rotate` o `side_data_list[].rotation`) y `getOrientedSize`.
- **`videomix/components/RectOverlay.tsx`**: SVG absoluto sobre el `<video>` (mismo contenedor, después del `MediaSourcePlayer`).
  - Máx. con borde sólido del color del clip y exterior oscurecido (path `evenodd`, sin eventos); mín. discontinuo; 8 tiradores por rectángulo; arrastre interior para mover.
  - El SVG tiene `pointer-events: none` y solo los rectángulos/tiradores los reciben: el clic fuera llega al vídeo (play/pausa) y la rueda burbujea al contenedor (seek/zoom) también encima de los rectángulos.
  - Arrastre con `setPointerCapture`; `onChange` en cada paso (transitorio) y `onCommit` al soltar (solo si ha cambiado); `pointercancel` restaura el estado inicial.
  - Teclado: al pulsar un rectángulo el overlay toma el foco y ese rectángulo queda **activo** (borde más grueso). Flechas: 2 px; con Shift: 10 px; cada pulsación hace `onCommit`. Se para la propagación para que no salten los atajos globales (seek). `Esc` quita el foco.
  - Los tiradores del rectángulo activo se dibujan encima (donde se solapan, ganan). Van con `key` por posición para que React no mueva nodos DOM al cambiar el activo, lo que perdería la captura del puntero.
  - Etiqueta: `Máx. w×h · proporción · orientación` y, si hay mín., `Mín. w×h · proporción`. Va encima del máx. si cabe; si no, dentro.
  - Props controladas: `{ maxRect, minRect, videoSize, color, aspectLock, cssRotation, onChange, onCommit }`.
- **`videomix/components/RectOverlayToolbar.tsx`**: select de proporción del máx. (Libre, 9:16, 3:4, 1:1, 4:3, 16:9), "Mín. = Máx." (borra el mín.) / "Añadir mín." y "Rellenar fotograma". Solo emite eventos; la lógica está en `overlayMath`.
- **`videomix/components/RectOverlayDemo.tsx`** (temporal, lo sustituye T07): estado local de los rectángulos, tamaño real del vídeo y barra de herramientas. Solo se activa con un flag de `localStorage` (ver prueba manual).
- **`App.tsx`**: un import y una línea delimitada con comentario tras `<MediaSourcePlayer>`; T07 la sustituye por la integración real.
- **i18n**: `yarn scan-i18n` (en) y traducciones en `locales/es` de los 11 textos nuevos. El scan añadió también 5 claves de T04 al `en`, que se hacía en paralelo.

### Decisiones

- **Mover el máx. no mueve el mín.**: el mín. marca contenido de la fuente. Si el máx. lo alcanza, lo **empuja**, y si encoge por debajo de su tamaño, lo **recorta** (`clampRect`).
- **Crear un mín.**: la especificación solo pide "Mín. = Máx.", pero hace falta una forma de crearlo. Se ha añadido "Añadir mín." (la mitad del máx., centrado), que alterna con "Mín. = Máx." en el mismo sitio.
- **Proporción fija** solo para el máx. (el mín. siempre es libre). Al elegir un preset se aplica en el acto (`applyAspect`) y queda bloqueado para los arrastres; "Rellenar fotograma" vuelve a "Libre".
- En una fuente de tamaño impar, el fotograma editable pierde 1 px (p. ej. 1081 → 1080) para que todo sea par, coherente con 04-diseno §2.4.
- Cada pulsación de flecha es un `onCommit`: T07 puede agrupar pulsaciones seguidas en el historial si hace falta.

### Tamaño real y rotación

- **Reproductor normal (`<video>`)**: Chromium aplica la matriz de rotación, y `videoWidth`/`videoHeight` ya vienen orientados. No se ha podido comprobar aquí (sin pantalla); está en la prueba manual con `v-rotated-9s.mp4` (T02).
- **Reproductor compat (`MediaSourcePlayer`)**: el `<video>` maestro puede ser un vídeo *dummy*, así que el tamaño se saca del stream de ffprobe (`width`/`height` intercambiados si la rotación es de 90/270°, leyendo `tags.rotate` o `side_data_list[].rotation`). Hay dos casos:
  - Rotación en la etiqueta antigua `rotate`: `effectiveRotation` la recoge, y el compat decodifica con `-noautorotate` y gira el elemento con CSS `rotate()`. Ahí `object-fit: contain` se aplica al fotograma **sin rotar** y después se gira, así que la escala es `min(cw/vh, ch/vw)`. El overlay recibe `cssRotation` y lo tiene en cuenta (test incluido). Riesgo sin verificar: que el sentido del giro CSS coincida con el autorotate de ffmpeg. Si no coincide, la caja sigue siendo correcta, pero la imagen del preview estaría girada 180° respecto al render y los rectángulos no corresponderían.
  - Rotación solo en *side data* (ffmpeg moderno, como `v-rotated-9s.mp4`): `effectiveRotation` es `undefined`, ffmpeg autorrota y no hay giro CSS. El overlay usa el tamaño orientado del stream.
- **Rotación manual de LosslessCut** (`rotation`/`isRotationSet`): cambia lo que se ve en el compat, pero no la fuente que decodifica el render (ffmpeg con autorotate). Las coordenadas no corresponderían al render. **En la demo el overlay se oculta si hay rotación manual.** Propuesta (pendiente de decisión del orquestador/T07/T16): en modo VideoMix, desactivar u ocultar la acción de rotar.

### Prueba manual

1. `yarn dev`. En DevTools (consola del renderer): `localStorage.setItem('videomix.rectOverlayDemo', '1')` y recargar (Ctrl+R). Para desactivarla: `localStorage.removeItem('videomix.rectOverlayDemo')`.
2. Abrir `test-media/` (T02) de 16:9. Debe verse el máx. = fotograma completo con la etiqueta `Máx. 1920×1080 · 16:9 · Horizontal` y la barra arriba.
3. Arrastrar tiradores y el interior: los valores de la etiqueta siempre son pares, no se sale del fotograma y no baja de 16 px. Probar con la ventana más ancha y más alta que el vídeo (bandas laterales y superiores): el rectángulo debe coincidir con la imagen.
4. Preset 9:16: queda 608×1080 centrado. Redimensionar por esquinas y lados: mantiene 9:16 (±1 px). "Rellenar fotograma" vuelve a libre y a 1920×1080.
5. "Añadir mín.": aparece discontinuo. Encoger el máx. contra él: lo empuja y luego lo recorta. Mover el mín.: no sale del máx. "Mín. = Máx." lo borra.
6. Pulsar un rectángulo y usar las flechas (2 px) y Shift+flechas (10 px): no debe moverse el cabezal de reproducción. Pulsar fuera, en el vídeo: play/pausa y las flechas vuelven a hacer seek. La rueda encima del vídeo y de los rectángulos sigue haciendo seek/zoom.
7. `v-rotated-9s.mp4`: la etiqueta con "Rellenar fotograma" debe decir `1080×1920 · 9:16 · Vertical` (confirma que `videoWidth` ya viene rotado). Repetir forzando el compat (p. ej. eligiendo una pista en el selector de reproducción, o con un fichero que lo necesite): el rectángulo debe seguir coincidiendo con la imagen.
8. Con el botón de rotación manual de LosslessCut: el overlay desaparece (comportamiento previsto).
9. En la consola, cada soltar o flecha muestra `RectOverlay commit {…}` con los valores en px de la fuente.

### Validación

`yarn tsc`, `yarn lint` (sin errores; los avisos "TSSatisfiesExpression could not be resolved" ya salían antes) y `yarn test run` (17 ficheros, 200 tests) en verde.

## Revisión

- **Resultado**: aceptada. `tsc`, `lint` y tests en verde (29 tests nuevos).
- **Decisión del orquestador**: en VideoMix se desactiva la rotación manual de LosslessCut (se hará en T07/T16).
- **Pendiente para T07**:
  - agrupar las pulsaciones de teclado repetidas en un solo paso de undo;
  - sustituir `RectOverlayDemo` por la integración real.
- **Pendiente de validación manual por el usuario**: comportamiento con `v-rotated-9s.mp4` en el reproductor normal y en el compat.
- **Proceso**: se recuerda a los agentes que no usen `git stash` (el árbol se comparte con otros agentes).
