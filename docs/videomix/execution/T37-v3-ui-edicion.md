# T37 · v3: contador, "Nuevo clip desde aquí", duración estimada y máxima en UI (E1, E3, E4, E6)

- **Hito**: M9 · **Modelo**: Sonnet · **Depende de**: T36 · **Estado**: hecha

## Alcance

1. **E1 · Contador de duración**:
   - Con un inicio marcado (marcador sin fin), se muestra inicio → cursor como etiqueta junto al cabezal en el `Timeline` y como texto en `BottomBar`.
   - Con un clip seleccionado, se muestra su duración y "→ m:ss si el fin fuera el cursor".
   - Formato según el ajuste de timecode del usuario. Se actualiza durante la reproducción sin coste apreciable.
2. **E6 · "Nuevo clip desde aquí"**:
   - `KeyboardAction` nueva con atajo por defecto (propuesta: Shift+I; comprueba conflictos) y botón en `BottomBar`.
   - Crea un marcador de inicio en el cursor **aunque el cursor esté dentro de otro clip**, sin modificar ese clip. "Marcar fin" (O) lo cierra como clip nuevo.
   - Revisa cómo se comportan hoy I/O dentro de un clip (T16 dice que I crea un marcador) y documenta la diferencia.
3. **E3 · Duración estimada**:
   - "≈ m:ss" en `MixRenderButtons` (barra inferior), visible en ambas pestañas;
   - calculada con `planRender` y *debounce*, reutilizando el plan de `useMixOverlays` si ya existe; ojo, ese plan solo se calcula con la pestaña Mix abierta;
   - tooltip con el número de clips.
4. **E4 · UI de la duración máxima**:
   - en `MixSettingsDialog`, sección Salida: interruptor más campo m:ss;
   - si la estimación supera el límite, el indicador de E3 se muestra resaltado con "→ se corta en m:ss".
   - El corte real y el aviso previo al render se hacen en T39.
5. **i18n**: español.
6. **Tests** de la lógica pura (formateo, cálculo del contador).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde, y `yarn test-e2e` sigue en verde.

## Notas de ejecución

### Ficheros

| Fichero | Cambio |
|---|---|
| `videomix/cursorDuration.ts` (+ test, 8 tests) | Nuevo, puro: `getCursorDurationInfo(segment, cursorTime)` (marcador → duración transcurrida; clip → su duración y la que tendría si el fin fuera el cursor, ambas con recorte a 0 si el cursor está antes del inicio) y `formatCursorDurationLabel` (E1). |
| `videomix/durationEstimate.ts` (+ test, 7 tests) | Nuevo, puro: `formatEstimatedDuration` ("≈ m:ss"), `exceedsMaxDuration` y `formatMaxDuration` (E3/E4). |
| `videomix/hooks/useMixDuration.ts` | Nuevo: estimación de E3 con *debounce* (300 ms, igual que `useMixOverlays`), reutilizando `mixOverlays.plan` cuando ya existe (pestaña Mix abierta) y calculando el suyo con `planRender` en caso contrario (pestaña Source, o antes de que el de Mix se calcule). |
| `videomix/clipSegments.test.ts` | Test nuevo (E6): un segmento nuevo que solapa un clip existente se convierte en su propio clip sin generar ninguna acción sobre el clip solapado. |
| `videomix/components/MixRenderButtons.tsx` | "≈ m:ss" con tooltip del número de clips (clave `{{count}} clips`, ya existente); si se supera `maxDuration`, el texto se resalta en rojo y se añade "→ {{cut at time}}". |
| `videomix/components/MixSettingsDialog.tsx` | Sección Salida: interruptor "Limit the length of the mix" + campo de texto "m:ss" (con `formatDuration`/`parseDuration`, borrador local hasta `blur`/Enter; Escape descarta). Por defecto 1:00 al activar el interruptor si no había valor previo. |
| `Timeline.tsx` | Prop `cursorDurationLabel` opcional; si hay etiqueta, una pequeña cápsula junto al cabezal (dentro de la banda de 36 px, no la recorta el `overflow` del scroller). |
| `BottomBar.tsx` | Prop `cursorDurationLabel` opcional; texto junto al tiempo/fotogramas de la esquina derecha. |
| `App.tsx` (mínimo y comentado) | Import de `useMixDuration` y de `cursorDuration`; `cursorDurationLabel` (memo de `getCursorDurationInfo(currentCutSeg, relevantTime)` + `formatCursorDurationLabel`) justo tras `mixClips`; `mixDuration` justo tras `mixOverlays`; acción `newClipFromCursor` en `mainActions` (reutiliza `checkFileOpened`/`addSegment`, ya en las dependencias); props nuevas: `cursorDurationLabel` en `Timeline` y `BottomBar`, `estimate`/`maxDuration` en `MixRenderButtons`, `newClipFromCursor={videoMixMode ? mainActions.newClipFromCursor : undefined}` en `BottomBar`. |
| `common/types.ts`, `main/configStore.ts`, `components/KeyboardShortcuts.tsx` | `KeyboardAction` `newClipFromCursor`; atajo por defecto `Shift+I` (sin conflicto: no hay ningún otro binding en `ShiftLeft+KeyI`); entrada en la categoría "Project" del diálogo de atajos. |
| `videomix/components/NewClipFromCursorButton.tsx` | Nuevo: botón de `BottomBar` para E6 (variante "+" del icono de "Marcar inicio": `FaHandPointUp` espejado con una insignia `FaPlus`), sin atar al color del segmento actual (no lo edita). |
| `e2e/videomix.e2e.ts` | Escenario nuevo "9b" (E6): con el cursor a 1 s dentro del clip `h-1080p-10s #1` (0–2 s), el **botón** de la barra inferior (`data-testid="new-clip-from-cursor-button"`) crea un marcador (la lista sigue con 3 clips y el clip #1 no cambia); `O` a los 2 s lo cierra como clip nuevo (`h-1080p-10s #2`, 1–2 s), y el clip #1 sigue intacto; se deshace. Al final, se repite la creación del marcador con el atajo `Shift+I` para comprobar también ese camino. |
| `locales/en`, `locales/es` | `scan-i18n` + 5 traducciones al español. |

### E1 · Contador de duración

- **Fuente del "cursor"**: `relevantTime` (ya se pasaba a `Timeline`; es lo que usan `setCutStart`/`setCutEnd` y sigue reproduciéndose sin *hover*), no `displayTime` (que en el timeline incluye el punto bajo el ratón). Como en VideoMix `startTimeOffset` está fijo a 0 (T16: `setStartTimeOffset` es una acción retirada), no hace falta sumarlo.
- **Lógica pura** en `cursorDuration.ts`, sin depender de VideoMix ni de React: solo mira si el segmento actual (`currentCutSeg`, un marcador o un clip) tiene fin. Los componentes solo formatean.
- **Colocación**: en `Timeline.tsx`, una cápsula pequeña junto al cabezal (posición absoluta en `commandedTimePercent`, dentro de la banda de 36 px de los segmentos: fuera de ahí la recortaría el `overflow-y: hidden` del contenedor con scroll). En `BottomBar.tsx`, texto junto al tiempo/fotogramas de la esquina derecha (ya existente).
- **Formato**: reutiliza `formatDuration({ shorten: true, showFraction: false })` (mismo `m:ss` usado en `ClipList`, `MixPlanView`, etc.), no el ajuste de timecode del usuario (`formatTimecode`, que da `hh:mm:ss.mmm` completo): la mayoría de montajes duran segundos o pocos minutos y ese formato ya es el que se usa en el resto de la UI de VideoMix para duraciones (frente a posiciones absolutas, que sí usan `formatTimecode`). Documentado aquí como desviación menor del alcance ("formato según el ajuste de timecode del usuario"); si el usuario lo prefiere con su formato completo, es un cambio de una línea (`formatTimecode` en vez de `formatDuration`).

### E6 · "Nuevo clip desde aquí"

- **Comportamiento actual de I/O dentro de un clip** (revisado en `useSegments.setCutStart`/`setCutTime`): con el cursor dentro del segmento actual (`currentCutSeg.end != null && relevantTime < currentCutSeg.end`), `I` **no crea un marcador**: mueve el **inicio** de ese mismo segmento (`setCutTime('start', …)`), como en LosslessCut clásico (útil para reajustar un corte). Solo crea un marcador nuevo si no hay segmento actual, o si el cursor está en o después de su fin (`addSegment()`, vista T16: "en vista avanzada, I crea un marcador"). Esa nota de T16 es cierta solo en ese caso; con un clip seleccionado y el cursor dentro, I edita el clip.
- **La función `addSegment()`** (ya existente, sin tocar) es justo lo que pide E6: añade siempre un marcador nuevo al final de la lista de segmentos y lo hace el segmento actual, **sin mirar en absoluto el segmento actual anterior** (a diferencia de `setCutStart`, que solo la llama como *fallback*). Con al menos un clip ya en la fuente, `isInitialSegment` es `false`, así que nunca sustituye nada: solo añade.
- **`newClipFromCursor`** en `App.tsx` es entonces una línea: `() => { if (checkFileOpened()) addSegment(); }` (mismo guard que usa `setCutStart`). No hizo falta tocar `useSegments.tsx` ni `clipSegments.ts`: la sincronización de ADR-002 ya trata un marcador nuevo como un clip nuevo en cuanto tiene fin (paso 2 de `getSyncStep`/`getClipActionsFromSegments`), y como no filtra por solape con otros clips de la fuente, un marcador o clip nuevo que solape a otro no genera ninguna acción sobre el clip solapado (verificado con el test nuevo de `clipSegments.test.ts` y con el escenario e2e "9b").
- **"Marcar fin" cierra el marcador nuevo, no el clip solapado**: como `addSegment()` deja el marcador nuevo como **segmento actual** (`setCurrentSegIndex(cutSegmentsNew.length - 1)`), `O` (`setCutEnd` → `setCutTime('end', …)`) actúa sobre ese índice, no sobre el clip bajo el cursor. La "lógica de selección" que pedía revisar el orquestador es exactamente esa: `currentSegIndex`, no una búsqueda por el tiempo del cursor.
- **Botón en `BottomBar`** (corregido tras la revisión del orquestador: el usuario pidió explícitamente atajo **y** botón): `videomix/components/NewClipFromCursorButton.tsx`, montado en `BottomBar.tsx` justo después del botón "Marcar fin", solo en modo VideoMix (`videoMixMode && newClipFromCursor != null`). Icono: una variante "+" del de "Marcar inicio" (`FaHandPointUp` espejado, como `SetCutpointButton`, con una insignia `FaPlus` en la esquina); no está atado al color del segmento actual porque, a diferencia de `SetCutpointButton`, no edita ese segmento. *Tooltip* con `actionTitle(t('New clip from here'), 'newClipFromCursor')`, que añade el atajo automáticamente (p. ej. "New clip from here (Shift+I)"), reutilizando la clave ya traducida al español para la entrada del diálogo de atajos. `data-testid="new-clip-from-cursor-button"` para el e2e.
- **Atajo**: `Shift+I` (`ShiftLeft+KeyI`) no choca con ningún otro *binding* por defecto (comprobado en `configStore.ts`) ni con ningún acelerador de menú.

### E3 · Duración estimada

- **`useMixDuration`** recibe `mixOverlays.plan` (solo calculado con la pestaña Mix abierta) y lo reutiliza tal cual cuando existe; si no (pestaña Source, o justo tras abrir Mix antes de que su plan pase el *debounce*), calcula el suyo con el mismo `planRender` y el mismo *debounce* de 300 ms que usa T22, así nunca tarda más que si lo hiciera siempre por su cuenta. Nunca llama a `planRender` dos veces para el mismo `clips`/`settings`: el `useMemo` de su propio plan está condicionado a `mixPlan == null`.
- El texto "≈ m:ss" y "→ {{cut at m:ss}}" no lleva traducción propia para los símbolos (igual que otras duraciones formateadas de la UI, p. ej. `MixLivePreview`); solo el tooltip ("{{count}} clips", clave reutilizada de T22) y "cut at {{time}}" (con su `es`) llevan `t(...)`.
- **Tooltip**: `title` con `t('{{count}} clips', { count: estimate.clipCount })` sobre el texto "≈ m:ss" completo (incluida la parte "→ cut at …" si aparece).

### E4 · UI de la duración máxima

- Interruptor + campo de texto "m:ss" en la sección Salida de `MixSettingsDialog`, con el mismo patrón de borrador local que otros campos de texto de la app (p. ej. `CutTimeInput` de `BottomBar.tsx`): valor mostrado = borrador si se está editando, si no `formatDuration(settings.maxDuration)`; se aplica en `blur` o Enter (`parseDuration`, se ignora si no es un número positivo) y Escape descarta sin aplicar.
- **Valor por defecto al activar el interruptor** sin un `maxDuration` previo: 1:00 (`DEFAULT_MAX_DURATION = 60`), un punto de partida razonable y fácil de cambiar; no estaba especificado en el alcance ni en T36.
- El resaltado de E3 (`MixRenderButtons`) y el texto "→ cut at {{time}}" son solo la lectura del ajuste ya guardado por T36 (`settings.maxDuration`); el corte real del plan y el aviso previo al render (criterio de aceptación de T36/T38) quedan, como dice el alcance, para T39.

### Tests

- `cursorDuration.test.ts` (8) y `durationEstimate.test.ts` (7): la lógica pura de formateo y cálculo de E1/E3/E4 (recorte a 0, "≈"/"→", límites).
- `clipSegments.test.ts`: test nuevo de la sincronización con un solape real (E6): el clip existente no recibe ninguna acción, el segmento solapado se convierte en su propio clip con nombre/color siguientes.
- `yarn test-e2e`: escenario "9b" nuevo (ver arriba), 13/13 en verde con Xvfb.

### Validación

- `yarn tsc`, `yarn lint` y `yarn test run` en verde **en los ficheros de esta tarea** (855 tests antes de mis cambios, sin ninguno roto; 8 nuevos de `cursorDuration`/`durationEstimate` + 1 de `clipSegments`). Durante la ejecución, la rama compartida con T38 (`planner/**`, en paralelo) tuvo errores de tipos y tests en rojo (`planMix.ts`, `plannerInput.ts`, `linksLimit.test.ts`…) que no tocan ningún fichero de esta tarea; confirmado con `git status` que esos ficheros no están entre los míos.
- `yarn build`: en verde.
- `yarn test-e2e`: 13/13 en verde con Xvfb (12 anteriores de T33/T35 + el escenario "9b" nuevo).
- `yarn scan-i18n` ejecutado; 5 claves nuevas traducidas a mano en `locales/es/translation.json`.

### Dudas y desviaciones

1. **Formato de E1** con `formatDuration` (m:ss corto) en vez de `formatTimecode` (el ajuste de timecode del usuario, pensado para posiciones absolutas hh:mm:ss.mmm): ver justificación en "E1" arriba. Aceptado por el orquestador.
2. **Valor por defecto de `maxDuration`** al activar el interruptor (1:00): no especificado en el alcance ni en T36; elegido por ser un punto de partida razonable. Aceptado por el orquestador.

(La desviación inicial de no añadir un botón de "Nuevo clip desde aquí" en `BottomBar` fue corregida tras la revisión del orquestador: el usuario había pedido explícitamente atajo **y** botón. Ver "E6" arriba.)

## Revisión

- **Resultado**: aceptada tras una iteración.
  - Se ha añadido el botón "Nuevo clip desde aquí" en la barra inferior, como pidió el usuario.
  - Se aceptan `formatDuration` para el contador y 1:00 por defecto para la duración máxima.
- Validado en un árbol limpio: `tsc`, `lint` y tests. `test-e2e` 13/13.
