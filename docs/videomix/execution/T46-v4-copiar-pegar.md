# T46 · v4: copiar y pegar el encuadre (A5)

- **Hito**: M11 · **Modelo**: Sonnet · **Depende de**: T44 · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- Lógica de pegado de T44 y sus notas. Selección múltiple de la lista de clips (A4, `useMixClipPins.ts`), menú del clip (`getClipMenu`), atajos (`src/main/configStore.ts`, `KeyboardShortcuts.tsx`).

## Alcance

1. "Copiar encuadre" y "Pegar encuadre" en el menú del clip y con atajos (propuesta: Ctrl+Mayús+C / Ctrl+Mayús+V; comprobar que no chocan con atajos existentes).
2. Pegar se aplica al clip activo o a **todos los seleccionados**, en **un solo paso de historial**. Portapapeles interno de la app (no el del sistema).
3. Aviso (toast) cuando alguna fuente de destino tiene otra proporción y el encuadre se ha ajustado.
4. i18n (en + es), manual.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde; e2e: copiar de un clip y pegar en dos seleccionados de otra fuente.

## Notas de ejecución

### Resumen

- La lógica pura (A5) ya la dejó T44 en `clipFraming.ts` (`copyClipFraming`, `getPasteFramingAction`), incluidos los keyframes (se copian, escalados y desplazados en el tiempo) y el `aspectChangedClipIds` para el aviso. Esta tarea es la UI: el portapapeles interno, el menú del clip, los atajos y el aviso.
- **Portapapeles interno** (`useMixClipPins.ts`): estado de React (`framing: ClipFraming | undefined`), no el proyecto ni el portapapeles del sistema, así no es undoable y sobrevive a cambiar de clip o de fuente. `userCopyFraming(clipId)` llama a `copyClipFraming`; si la fuente del clip no tiene tamaño conocido, no hace nada (mismo criterio que T44 documentó para "Copiar"). `userPasteFraming(clipId)`: si el clip está en la selección múltiple, pega en toda la selección (`[...selectedClipIds]`); si no, solo en él. Llama a `getPasteFramingAction` y despacha su `action` (un solo `dispatchStep`, un paso de historial); si `aspectChangedClipIds` no está vacío, `getSwal().toast.fire({ icon: 'warning', … })` (mismo patrón que el aviso de "Ajustar a" de T45).
- **Menú del clip** (`getClipMenu` en `useMixClipPins.ts`, ya compartido por `ClipList` y la vista Montaje): dos entradas nuevas, "Copiar encuadre" (activa solo si la fuente del clip tiene tamaño conocido) y "Pegar encuadre" (activa solo si hay algo copiado).
- **Atajos**: `Ctrl/Cmd+Mayús+C` (`copyClipFraming`) y `Ctrl/Cmd+Mayús+V` (`pasteClipFraming`), nuevos en `KeyboardAction` (`src/common/types.ts`), con sus bindings por defecto en `configStore.ts` y su entrada en `KeyboardShortcuts.tsx`. No chocan con nada existente: el único atajo con `KeyC`/`KeyV` es `Ctrl/Cmd+Alt+C` (`copySegmentsToClipboard`, de LosslessCut); `Ctrl/Cmd+Mayús+C/V` estaban libres. Cableados en `App.tsx` (`mainActions`) sobre `mixClipPins.userCopyFraming`/`userPasteFraming` con `mixClips.selectedClipId`.
- **`useMixClipPins` recibe `sources`** (antes solo `clips`/`settings`), necesario para `copyClipFraming`/`getPasteFramingAction`; único cambio de firma, propagado al único call site (`App.tsx`).
- i18n (en + es) y manual (`docs/videomix/manual-usuario.md`: párrafo en la sección de rectángulos, fila nueva en la tabla de atajos de §9).

### Decisiones

- **Dónde vive el portapapeles**: en `useMixClipPins` (no un hook nuevo), porque ya es el hook que construye `getClipMenu` para la lista y la vista Montaje y ya tiene `dispatchStep`/`selectedClipIds`; así el menú y los atajos comparten el mismo estado sin pasar callbacks entre hooks.
- **Aviso**: solo se muestra si `aspectChangedClipIds` no está vacío (no por cada clip destino sin tamaño de fuente conocido, que simplemente se omite en silencio, igual que documentó T44 para el pegado). El texto usa el recuento (`{{count}}`) para diferenciar singular/plural.
- **Sin botones en la barra del editor**: el alcance pide "menú del clip y atajos"; no hay una barra propia para esto (a diferencia de F2 en T45), así que no se añadió ningún botón nuevo a `RectOverlayToolbar`.

### Validación

- `yarn tsc`, `yarn lint` y `yarn test run` (93 ficheros, 1132 tests) en verde; `yarn build` en verde.
- `yarn test-e2e`: 21/21 en verde, incluido el nuevo **e2e 17** (`VideoMix (copy/paste framing)`), que copia el encuadre (recortado a mano) de un clip de una fuente 1920×1080, lo pega con `Ctrl+Mayús+V` en dos clips seleccionados con Ctrl-clic de una fuente 1280×720 (misma proporción: sin aviso, escalado ×2/3, revertido en un solo `Ctrl+Z`) y luego en un clip de una fuente 1080×1920 (otra proporción: aparece el toast con "another proportion" y el rectángulo pegado conserva la proporción copiada, ajustado dentro del fotograma).
- Durante la ejecución, `yarn tsc`/`yarn test run`/`yarn test-e2e` mostraron en algún momento fallos transitorios ajenos a esta tarea, causados por el trabajo en curso de T47/T48 sobre ficheros compartidos (`clips.ts`, `clipSegments.ts`, `useMixClips.ts`, `App.tsx`): confirmado con `git diff` (no son ficheros que esta tarea toque) y con reintentos posteriores, que salieron en verde.

## Revisión

- **Resultado**: aceptada. Validación del orquestador (junto con T47): tsc, lint, 1132 tests, e2e 21/21.
