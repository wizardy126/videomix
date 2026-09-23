# T07 · Clips: creación, sincronización y lista

- **Hito**: M2 · **Modelo**: Opus · **Depende de**: T05, T06 · **Estado**: hecha

## Objetivo

Crear y editar clips (tiempo + rectángulos + ajustes) y mostrarlos todos en el panel derecho.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.2, §4.4, §5 (mute y ganancia por clip), §7
- [04-diseno](../04-diseno.md) §6.3, §6.5
- [02-as-built](../02-as-built.md) §5 (`useSegments`, `loadCutSegments`, `segId`), §7 (`SegmentList`, dnd-kit, virtualización)

## Alcance

1. **Sincronización clips ↔ segmentos de la fuente activa** (04-diseno §6.3):
   - implementa la estrategia recomendada o la alternativa;
   - **registra la decisión en `docs/videomix/decisiones/ADR-002-clips-segmentos.md`**, con el razonamiento y cómo queda el undo/redo.
   - Requisitos:
     - editar inicio/fin en el timeline actualiza el clip;
     - los segmentos sin `end` (marcadores) no son clips;
     - undo/redo coherente;
     - cambiar de fuente no pierde nada.
2. **Crear clip**:
   - acción "Add clip" (botón en BottomBar o en la barra VideoMix, más un atajo) desde el segmento actual o desde la selección inicio/fin;
   - nombre por defecto `<fuente sin extensión> #n`, color siguiente de la paleta y `maxRect` igual al fotograma completo.
3. **Clip seleccionado**:
   - el overlay (T06) edita sus rectángulos con commit al historial al soltar;
   - al seleccionar un clip de otra fuente, se activa esa fuente, se hace seek a `start` y se selecciona.
4. **`videomix/components/ClipList.tsx`** (panel derecho, sustituye a `SegmentList` en el layout):
   - todos los clips, virtualizados y reordenables con dnd-kit (patrón `SegmentList`);
   - por fila: número, color (selector de la paleta), nombre editable, fuente, `start`–`end`, duración, icono de orientación (horizontal/vertical según el máx.), mute, ganancia en dB (−20…+20) y avisos: clip más corto que 2 × transición, mín. no definido (informativo);
   - menú contextual: duplicar, eliminar, ir a la fuente;
   - miniatura: frame de `start` recortado al máx. Si es costosa, déjala como mejora opcional y documéntalo. Puede reutilizar `captureFrame`.
5. **Atajos**: nuevas `KeyboardAction` para añadir, eliminar y duplicar clip, sin conflictos.

## Fuera de alcance

- El plan de montaje y el render.

## Criterios de aceptación

- Flujo completo:
  1. añadir 2 fuentes;
  2. crear 3 clips en cada una con rectángulos distintos;
  3. reordenar, cambiar de fuente, deshacer y rehacer;
  4. guardar y abrir: todo se conserva.
- Tests de la lógica pura de sincronización y de numeración y nombres.
- `yarn tsc && yarn lint && yarn test run` en verde.
- Instrucciones de prueba manual en las notas.

## Notas de ejecución

### Ficheros

| Fichero | Cambio |
|---|---|
| `videomix/clips.ts` (+ `clips.test.ts`, 12 tests) | Nuevo, puro: nombres (`getDefaultClipName`, `getDuplicateClipName`, `getNextNumberedName`), color (`getNextClipColor`), `createClip` (máx. = fotograma completo, par), `getNewClipRange` ("Add clip"), `getSplitClipAction`, `getClipWarnings`, valores de ganancia (−20…+20 dB). |
| `videomix/clipSegments.ts` (+ `clipSegments.test.ts`, 21 tests) | Nuevo, puro: la sincronización clips ↔ segmentos (`clipToSegment`, `buildSourceSegments`, `isSegmentsInSync`, `getClipActionsFromSegments`, `isTimeOnlyEdit`, `getSyncStep`). |
| `videomix/hooks/useMixClips.ts` | Nuevo: aplica la sincronización en un efecto, clip seleccionado, acciones de clip (añadir, duplicar, eliminar, dividir, seleccionar, editar, reordenar), agrupación de pasos de undo y los manejadores del overlay. |
| `videomix/components/ClipList.tsx` | Nuevo: panel derecho con todos los clips (virtualizado, dnd-kit), sustituye a `SegmentList` en VideoMix. |
| `videomix/components/ClipRectEditor.tsx` | Nuevo: overlay + barra de T06 conectados al clip seleccionado. Sustituye a `RectOverlayDemo.tsx` (**borrado**). |
| `videomix/projectReducer.ts` (+ test) | Acción `batch` (varias acciones en un solo paso de undo). |
| `videomix/components/RectOverlay.tsx` (T06) | `onCommit(rects, { keyboard: true })` en las flechas, para agrupar pulsaciones. |
| `videomix/hooks/useMixWorkspace.ts` (T05) | Si el fichero del player deja de ser una fuente (p. ej. deshacer "Añadir vídeos"), se descarga. Al añadir vídeos se carga siempre el primero nuevo (antes solo si no había ninguno activo, porque cambiar de fuente perdía el timeline). |
| `hooks/useSegments.tsx` | Devuelve también `setCutSegments` (setter crudo). |
| `util/colors.ts` | Exporta `segColorsCount` (tamaño de la paleta). |
| `BottomBar.tsx` | Oculta el botón de rotación en VideoMix. |
| `common/types.ts`, `main/configStore.ts`, `components/KeyboardShortcuts.tsx` | Acciones `addClip` (`N`), `duplicateCurrentClip` (`Ctrl/Cmd+D`), `removeCurrentClip` (`Supr`, `Cmd+Retroceso`), categoría "Proyecto". |
| `App.tsx` | Ver "Puntos de cambio". |
| `locales/en`, `locales/es` | `scan-i18n` + 17 textos nuevos en español. |
| Docs | [ADR-002](../decisiones/ADR-002-clips-segmentos.md), enlazado desde 04-diseno §6.3 y `decisiones/README.md`. |

### Puntos de cambio en `App.tsx` (comentados con el porqué)

1. Imports: `ClipRectEditor`, `ClipList`, `useMixClips` en lugar de `RectOverlayDemo`.
2. Desestructuración de `useSegments`: `+ setCutSegments`.
3. `onDurationChange`: en VideoMix no se crea el segmento *placeholder* de todo el fichero.
4. `increaseRotation`: no hace nada en VideoMix (teclado `R`, menú y botón, que además se oculta en `BottomBar`).
5. Tras `useMixWorkspace`: `const mixClips = useMixClips({...})`.
6. `mainActions`: `splitCurrentSegment` → `mixClips.userSplitClip`; `undo`/`redo` → historial del proyecto; `addClip`, `duplicateCurrentClip`, `removeCurrentClip`; `mixClips` en las dependencias.
7. Layout: `ClipRectEditor` en lugar de `RectOverlayDemo` (solo con clip seleccionado); `ClipList` en el panel derecho (respeta `showRightBar`); `SegmentList` solo si `!videoMixMode`.

### Decisiones (resumen de ADR-002)

- **Sincronización bidireccional** con el proyecto como fuente de verdad: el timeline muestra los clips de la fuente activa como segmentos (`segId = clip.id`, color = color del clip). Las ediciones del timeline pasan al proyecto; los cambios del proyecto (undo/redo, lista) reescriben el timeline. Lógica pura con tests (incluido uno de ida y vuelta sin bucles).
- **Todo segmento con fin es un clip**; los marcadores no (viven solo en el timeline y se pierden al cambiar de fuente). Por eso no hay *placeholder*. "Marcar inicio" (`I`) crea un marcador y "Marcar fin" (`O`) lo convierte en clip.
- **Undo/redo** = historial del proyecto (incluye fuentes, clips y ajustes). Un arrastre de punto de corte o de rectángulo es un paso; las pulsaciones seguidas de flechas del overlay sobre el mismo clip se agrupan en un paso (1 s sin pulsar); I/O seguidos sobre el mismo clip, también (0,7 s).
- **Clip seleccionado** = segmento actual del timeline si es un clip. Al elegir un clip de otra fuente en la lista: se activa la fuente, se selecciona y se hace *seek* a su inicio cuando el vídeo está listo.
- **"Add clip"** (`N` o `+`): del marcador actual al cabezal o, si no hay marcador, 5 s desde el cabezal.
- **Dividir** (`B`) en VideoMix divide el clip conservando rectángulos, mute y ganancia en las dos partes.
- **Nombres**: `<fuente sin extensión> #n`, con `n` = máximo + 1 del prefijo en todo el proyecto. Duplicar: siguiente número del mismo prefijo ("Intro" → "Intro #2").
- **Color**: el menos usado de la paleta (19); en empate, el de menor índice. Se cambia con el número de la fila.
- **Rotación manual** de LosslessCut desactivada.

### Desviaciones y pendientes

- **Miniatura** de la fila (frame de `start` recortado al máx.): **no implementada**. Capturar un frame por clip con ffmpeg (`captureFrame`) para fuentes que no están cargadas es costoso y habría que cachearlo (y reinvalidarlo al editar `start`/`maxRect`). Queda como mejora opcional; encaja con las miniaturas del timeline del montaje (T15).
- **Botón "Add clip"**: está en la barra inferior de la lista de clips, junto a duplicar y eliminar, no en `BottomBar`.
- **Vista simple** de LosslessCut (activada por defecto): "Marcar inicio" (`I`) sin segmento actual crea directamente un segmento de 10 s (comportamiento heredado de `addSegment`), que ya es un clip; `O` ajusta su fin. En la vista avanzada, `I` crea un marcador y `O` lo convierte en clip. No lo he cambiado; T16 puede decidir si VideoMix fuerza uno de los dos.
- **Aviso de upscale** (04-diseno §6.5): depende del plan (T10/T15); la fila muestra solo "clip corto" y "sin mínimo".
- **Bloqueo de proporción** del máx.: estado de la sesión por clip (no se guarda en el `.vmx`; el modelo no tiene ese campo).
- Las operaciones de segmentos heredadas que crean segmentos nuevos (detectar escenas, generar N segmentos, duplicar segmento, etc.) crean clips con los rectángulos por defecto. La limpieza de menús que no aplican es de T16.
- **Atajos nuevos**: como en T05, si ya existe un `config.json` de VideoMix, no aparecen hasta restablecer los atajos.
- **Dudas para el orquestador**:
  - ¿Duración por defecto de "Add clip" sin marcador (5 s)? Alternativa: hasta el siguiente clip o el final.
  - ¿Los clips nuevos deben ir al final de la lista (actual) o detrás del último clip de la misma fuente?

### Validación

- `yarn tsc`: sin errores en mis ficheros (solo el de T09: `script/videomix/spike/renderSpike.ts(646)`).
- `yarn lint`: sin errores en mis ficheros (solo `script/videomix/spike/renderSpike.ts`, T09).
- `yarn test run`: 24 ficheros, 281 tests en verde (34 nuevos).
- `yarn build`: OK.
- No se ha podido ejecutar la app (sin pantalla): la integración está razonada y la lógica, testeada; falta la prueba manual.

### Prueba manual (usuario)

Requisitos: `yarn generate-test-media` y `yarn dev`. Restablece los atajos (diálogo de atajos → restablecer) para tener `N`, `Ctrl+D` y `Supr`.

1. **Fuentes**: arrastra `test-media/h-1080p-10s.mp4` y `test-media/v-1080x1920-12s.mp4` al panel de fuentes. Se carga la primera. El timeline está **vacío** (sin el segmento de todo el fichero) y la lista de la derecha, "Clips", muestra el texto de ayuda. Ya no hay botón de rotación en la barra inferior y `R` no hace nada.
2. **Clip con I/O**: en `h-1080p` ve a 1 s y pulsa `I`, ve a 3 s y pulsa `O`. (Con la vista simple, la de defecto, `I` ya crea un clip de 1 a 10 s y `O` lo acorta; con la avanzada, `I` crea un marcador y `O` lo convierte en clip.) Queda el clip `h-1080p-10s #1` en la lista (color 1, `0:01.000 – 0:03.000`, duración, icono horizontal, ⓘ "sin mínimo"). Sobre el vídeo, el máx. = fotograma completo con la barra de proporciones.
3. **Clip con N / +**: ve a 4 s y pulsa `N`: clip `#2` de 4 a 9 s, con otro color, seleccionado. Pon el cabezal en 9,5 s y pulsa `+` en la lista: clip `#3` de 5 a 10 s (retrocede para caber).
4. **Rectángulos distintos**: con `#1` seleccionado (clic en la fila o en su segmento del timeline), elige 9:16 en la barra; en `#2`, "Añadir mín." y arrastra el máx.; en `#3`, arrastra una esquina. Al cambiar de clip en la lista, el overlay muestra los rectángulos de cada uno.
5. **Timeline → clip**: con Mayús pulsada, arrastra en el timeline el inicio de `#2`: la fila de la lista actualiza tiempos y duración. Pulsa `Ctrl+Z` **una vez**: vuelve el inicio anterior (todo el arrastre es un paso). `Ctrl+Shift+Z` lo rehace.
6. **Flechas**: pulsa sobre el máx. de `#3` y mueve con flechas 5 veces. `Ctrl+Z` una vez (tras 1 s): deshace las 5.
7. **Segunda fuente**: pulsa `v-1080x1920-12s` en el panel izquierdo. El timeline muestra sus clips (ninguno); **los 3 clips de la primera siguen en la lista**. Crea 3 clips (I/O y `N`) con rectángulos distintos (p. ej. 1:1, 3:4 y con mín.). Los nombres son `v-1080x1920-12s #1…#3`; el icono de la fila es vertical.
8. **Seleccionar en otra fuente**: pulsa en la lista `h-1080p-10s #2`: se activa `h-1080p`, el timeline muestra sus 3 clips, `#2` queda como actual (overlay con su mín.) y el cabezal va a su inicio (4 s). Clic derecho en una fila de la otra fuente → "Ir a la fuente": igual.
9. **Reordenar**: arrastra filas por el asa ⋮⋮ (p. ej. el último arriba). Los números de la lista cambian; `Ctrl+Z` deshace el reordenado.
10. **Lista**: renombra un clip (clic en el nombre, escribe, Enter; Escape cancela); el segmento del timeline muestra el nombre nuevo. Cambia el color con el número de la fila (paleta). Silencia uno (icono de altavoz) y pon +6 dB en otro. Cada cambio se deshace con `Ctrl+Z`.
11. **Duplicar / eliminar / dividir**: `Ctrl+D` duplica el clip seleccionado (`… #4`, justo detrás, mismos rectángulos). `Supr` lo elimina. Con el cabezal dentro de un clip, `B` lo divide en dos que conservan rectángulos, mute y ganancia. En el timeline, `Retroceso` (quitar punto de corte) convierte el clip actual en marcador y **elimina el clip**; `Ctrl+Z` lo recupera.
12. **Aviso de clip corto**: crea un clip de menos de 1 s (I/O muy juntos): la fila muestra ⚠ "no dura más que dos transiciones".
13. **Deshacer fuentes**: añade `sq-1080-6s.mp4` (se carga) y pulsa `Ctrl+Z`: la fuente desaparece y el player se descarga. `Ctrl+Shift+Z` la vuelve a añadir.
14. **Cambiar de fuente no pierde nada**: alterna varias veces entre las fuentes y comprueba que clips, tiempos y rectángulos se mantienen. Los marcadores (I sin O) sí se pierden al cambiar (no son clips).
15. **Guardar y abrir**: `Ctrl+S` → `test-media/t07.vmx`. Cierra la app, vuelve a abrirla y abre `t07.vmx`: están las 2 fuentes y los 6 clips, en el mismo orden, con nombres, colores, tiempos, rectángulos, mute y ganancia. En el `.vmx` (JSON5) se ven `clips[].maxRect/minRect/muted/gainDb`.
16. **Idioma**: en español, "Clips", "Añadir clip", "Duplicar clip", "Eliminar clip", "Ir a la fuente", etc.

## Revisión

- **Resultado**: aceptada. `tsc`, `lint`, tests (281) y `build` en verde. Falta la prueba manual del usuario.
- **Decisiones del orquestador sobre las dudas**:
  - Se mantienen 5 s para "Add clip" sin marcador.
  - Los clips nuevos van al final de la lista.
  - La vista simple de LosslessCut se revisa en T16.
  - Las miniaturas de las filas se valoran junto a T15.
