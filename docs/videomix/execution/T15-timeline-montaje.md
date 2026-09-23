# T15 · Timeline del montaje (vista del plan)

- **Hito**: M5 · **Modelo**: Sonnet · **Depende de**: T10, T13 · **Estado**: hecha

## Objetivo

Visualizar el `MixPlan` para que el usuario entienda qué va a salir antes de renderizar.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.6
- [04-diseno](../04-diseno.md) §3.1, §6.1, §6.6
- [02-as-built](../02-as-built.md) §7 (`Timeline.tsx`, como referencia de estilo y zoom)

## Alcance

1. **`videomix/components/MixPlanView.tsx`**:
   - Vista alternativa al timeline de la fuente activa (pestañas "Source" / "Mix").
   - Eje de tiempo del vídeo final y **carriles por columna**: bloques con el color y el nombre del clip, solapes de transición marcados, zonas de re-layout y de relleno sombreadas.
   - Encima, una **mini vista del fotograma** en el instante bajo el cursor: rectángulos con el color de cada clip y su ancho real (sin vídeo).
   - Clic en un bloque: selecciona el clip, lo que activa su fuente (reutiliza T07).
   - Los avisos del plan se muestran como iconos sobre los bloques.
2. El plan se recalcula con debounce cuando cambian los clips o los ajustes (el planificador es rápido).

## Criterios de aceptación

- Se ve el plan de un proyecto de ejemplo y coincide con el render de T13.
- `yarn tsc && yarn lint && yarn test run` en verde.
- Instrucciones de prueba manual en las notas.

## Notas de ejecución

### Ficheros

| Fichero | Cambio |
|---|---|
| `videomix/mixPlanLayout.ts` (+ `mixPlanLayout.test.ts`, 13 tests) | Nuevo, puro: `getLaneColumns` (orden de carriles por primera aparición en x), `getColumnExistenceSpans`/`getColumnFillSpans` (huecos de relleno de un carril), `timeToPercent` (eje de tiempo) y `getPlacementAt` (hit-testing de un clic sobre un carril). |
| `videomix/components/MixPlanView.tsx` | Nuevo: vista del `MixPlan`. Carriles por columna (uno por id de columna estable), bloques con el color y nombre del clip, marca de solape de transición de entrada/salida (degradado en los bordes del bloque), zonas de relleno del carril (rayado) y banda sombreada durante un re-layout. Mini vista del fotograma en el instante bajo el cursor. Aviso (▲) sobre un bloque si el plan tiene un warning de ese clip. Estado vacío si no hay clips. |
| `App.tsx` | Ver "Puntos de cambio". |
| `locales/en`, `locales/es` | `scan-i18n` + 6 textos nuevos en español. |

### Puntos de cambio en `App.tsx` (comentados con el porqué)

1. Import de `MixPlanView`.
2. Estado nuevo `showMixPlan` (booleano de sesión, no se guarda en el proyecto), justo tras `mixSettingsOpen`.
3. En el área inferior (antes solo `<Timeline>`): en modo VideoMix se añaden dos pestañas pequeñas "Source"/"Mix" que alternan `showMixPlan`, y el `<Timeline>` existente se envuelve en `videoMixMode && !showMixPlan ? <Timeline ...> : ...`; con `showMixPlan` activo se monta `<MixPlanView>` en su lugar, con las mismas props de clips/ajustes que ya usan `ClipList`/`MixRenderButtons` y `mixClips.userSelectClip` como `onSelect` (igual que "ir a la fuente" de T07: activa la fuente del clip y hace *seek*). El player, el overlay de rectángulos y el resto del layout no cambian.

### Decisiones

- **Geometría del render reutilizada tal cual**: la mini vista del fotograma usa `getRenderTimeline` + `getColumnsAtFrame`/`getFillSpansAtFrame` de `render/renderTimeline.ts` (mismo `fps`/`gap`/`transitionDuration` que el proyecto), así que coincide exactamente con lo que generaría T13 en ese instante, incluida la animación de un re-layout con `smoothstep`.
- **Cálculo del plan**: `planRender({ clips, settings }, { preview: false })` (el mismo helper de T13, sin escalar a la previsualización), con `clips`/`settings` pasados por `use-debounce` (300 ms) antes de recalcular, para no replanificar en cada tecla/arrastre de los ajustes o del rectángulo.
- **Carriles = columnas estables**, no posiciones visuales: un carril por `column` id, ordenados por la `x` de su primera aparición (`getLaneColumns`), así el orden no salta cuando el layout reordena columnas. Un carril sigue existiendo (y se pinta como relleno) mientras su columna esté en algún keyframe, aunque su último clip haya terminado (04-diseno §3.1, fin de vídeo).
- **Sin zoom horizontal**: a diferencia de `Timeline.tsx`, la vista del plan siempre encaja en el ancho disponible (porcentajes sobre `plan.duration`); se prefirió la sencillez a replicar el zoom, no lo pide el criterio de aceptación y los montajes de prueba son cortos.
- **Hit-testing en el contenedor del carril, no por bloque**: cada fila de carril tiene un único `onClick` que calcula el tiempo del clic y usa `getPlacementAt` (probado con vitest) para encontrar el `clipId`; un clic sobre una zona de relleno no hace nada.
- **Avisos por bloque**: `getPlacementWarnings` filtra `plan.warnings` por `clipId` (y por rango de tiempo para pillarbox/letterbox); los de tipo `fill` no son por clip y ya se ven como las zonas rayadas del carril, así que no generan icono.
- **Mini vista del fotograma**: mientras el cursor no está sobre los carriles se muestra el instante `t=0` (en vez de nada), para que la vista no aparezca vacía al entrar en la pestaña "Mix".

### Desviaciones

- **Miniaturas de fila** (mencionadas como opcionales en el alcance del orquestador): no implementadas. Los bloques muestran color + nombre del clip, como T07 dejó pendiente para T15; capturar un frame por clip tendría el mismo coste/caché que en T07, se deja como mejora futura.
- El toggle "Source"/"Mix" es solo un par de botones pequeños sobre el área inferior (no un componente de pestañas genérico ni un atajo de teclado nuevo): no estaba en los ficheros previstos y así el cambio en `App.tsx` queda mínimo.

### Tests

- `mixPlanLayout.test.ts`: orden de carriles (incluida una columna que aparece más tarde), huecos de relleno de un carril (entre dos clips y en un carril siempre cubierto), `timeToPercent` (proporcional, recorte a `[0,100]`, duración 0) y `getPlacementAt`/`getPlacementWarnings` (coincidencia por clip, por rango de tiempo y ausencia de coincidencia).
- `yarn tsc`, `yarn lint`, `yarn test run` (35 ficheros, 408 tests) y `yarn build` en verde.
- No se ha podido ejecutar la app (sin pantalla): la lógica pura está testeada; falta la prueba manual de la UI.

### Prueba manual (la app no se puede lanzar aquí)

Preparación: `yarn generate-test-media` (si no existen los medios de `test-media/`) y `yarn dev`.

1. **Sin clips**: crea un proyecto nuevo y pulsa la pestaña "Mix" (sobre el área del timeline, junto a "Source"). En vez del timeline sale el mensaje "Add clips to see the mix plan here." / "Añade clips para ver aquí el plan del montaje." Pulsa "Source": vuelve el timeline de LosslessCut normal.
2. **Con clips**: añade ≥ 4 fuentes de `test-media/` y crea ≥ 8 clips repartidos entre ellas (como en la prueba manual de T07/T13). Pulsa "Mix": aparecen los carriles con bloques de colores (uno por columna estable) y sus nombres; a la izquierda, la mini vista del fotograma.
3. **Coincide con el render**: mueve el ratón sobre los carriles en distintos instantes y compara la mini vista del fotograma (número de columnas, anchos, colores) con `Preview` de T13 en el mismo instante (usa el mismo vídeo de previsualización, pausado, comparando proporciones). Deben coincidir.
4. **Transiciones y re-layout**: en un punto donde un clip sustituye a otro en su columna, el bloque entrante muestra un degradado claro en su borde izquierdo (solape); si el plan hace un re-layout (columnas cambian de ancho), se ve una banda gris sutil sobre todos los carriles durante esa transición.
5. **Relleno**: si algún carril queda sin clip durante un tramo (más columnas configuradas que clips disponibles, o final del vídeo), ese tramo se ve rayado en el carril.
6. **Avisos**: si un clip tiene un rectángulo máx. muy pequeño (upscale > ×2, como en la prueba de T13), su bloque muestra un icono ▲ naranja; el tooltip del bloque explica el aviso.
7. **Selección**: clic en un bloque de un clip de otra fuente: se activa esa fuente (el player la carga) y el clip queda seleccionado (igual que al hacer clic en la lista de clips o "ir a la fuente"); el bloque queda resaltado con un borde. Selecciona el mismo clip desde la lista de la derecha: el bloque correspondiente se resalta también.
8. **Debounce**: con la pestaña "Mix" abierta, cambia un ajuste de montaje (p. ej. separación entre columnas) en "Mix settings...": el plan de la vista se actualiza solo (sin recalcular en cada pulsación), unos 300 ms después del último cambio.
9. **Idioma**: en español, las pestañas dicen "Fuente"/"Montaje" y el mensaje de estado vacío está traducido.

### Dudas y limitaciones

1. **Sin zoom ni scroll horizontal** en el eje de tiempo (a diferencia de `Timeline.tsx`): para montajes muy largos los bloques cortos pueden verse pequeños. Se puede añadir zoom en una tarea posterior si hace falta.
2. **Miniaturas de los bloques**: no implementadas (ver "Desviaciones"), igual que en T07.

## Revisión

- **Resultado**: aceptada. `tsc`, `lint`, tests (408) y `build` en verde. La mini vista reutiliza la geometría del render.
- **Backlog**: miniaturas de las filas y zoom horizontal del eje de tiempo.
