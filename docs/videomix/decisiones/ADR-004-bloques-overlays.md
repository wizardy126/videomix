# ADR-004 · Bloques de overlays: definición + instancia y expansión

- **Tarea**: T56 · **Estado**: aceptada
- **Afecta a**: modelo del proyecto (v7), resolución de tiempos, render, audio, previsualización en vivo, validación, `.vmxblock` (T58), UI de bloques (T57)

## Contexto

v6 (01-requisitos §14) agrupa overlays en **bloques** (H1) que se mueven como una pieza, con su propia ancla y tiempos relativos, se repiten como **instancias enlazadas** que comparten el contenido (H5), llevan **variables** por instancia (H4), se ocultan (H8) y se exportan a plantillas `.vmxblock` (H2). Todo el pipeline existente (resolución de tiempos, render de vídeo y audio, previsualización en vivo, validación) trabaja sobre una lista plana `project.overlays`.

## Opciones evaluadas

1. **Miembros dentro de `project.overlays` con un `blockId`** y el ancla del bloque aparte. Poco cambio en los consumidores, pero las repeticiones enlazadas obligan a duplicar el contenido y sincronizarlo en cada edición, y las variables por instancia no tienen dónde vivir.
2. **Definición + instancia** (`blockDefs` con el contenido; `blocks` con ancla, variables y estado) y una **expansión pura** que convierte las instancias en overlays concretos. Un bloque normal es una definición con una instancia; repetir es añadir instancias; desvincular es clonar la definición.
3. Un nuevo tipo de overlay `block` dentro de `project.overlays`: todos los consumidores tendrían que conocerlo.

## Decisión

Opción 2.

- `MixProject.blockDefs: MixBlockDef[]` (`id`, `name`, `color`, `members: MixOverlay[]`) y `MixProject.blocks: MixBlock[]` (`id`, `defId`, `anchor`, `variables?`, `hidden?`, `locked?`, `collapsed?`). Los miembros son overlays normales cuyo ancla `absolute` es un tiempo **relativo al inicio del bloque** y cuyas anclas `element` / `linkedCountdownId` apuntan a otros miembros.
- `expandBlocks(project) → { all, visible, origins, anchors }`: ids deterministas `bloque/miembro`; los tiempos relativos pasan a ser el ancla del bloque desplazada (así siguen al clip o elemento del bloque); las referencias internas se remapean; las variables se sustituyen. `all` incluye los bloques ocultos (para resolver tiempos y que lo anclado a ellos no se mueva); `visible` no. **Sin bloques, `all` y `visible` son el mismo array `project.overlays`**: nada cambia para los proyectos existentes.
- **Anclas a un bloque**: un overlay u otro bloque puede anclarse a un bloque por su id (inicio o fin) o a un miembro por su id expandido. La expansión compone el ancla (ancla del bloque + desfase, + la duración del bloque si es el fin), así `resolveOverlayTimes` no conoce los bloques.
- **Duración de un bloque** = el fin más tardío de sus miembros **sin la cola de sus sonidos** (depende del fichero): la misma en todas partes (anclas al fin, estirar, vista previa del `.vmxblock`). `resolveBlockTimes` da además `contentEnd` (con los sonidos conocidos) para dibujarlo.
- **Capas**: los bloques se dibujan **encima de todos los overlays sueltos**, en el orden de `blocks`, y dentro de cada uno sus miembros en orden.

## Consecuencias

- Render, audio, previsualización y validación reciben `expandBlocks(...).visible` / `.all` y no cambian por dentro. Un test comprueba que agrupar todos los overlays en un bloque produce **exactamente los mismos grafos** de vídeo y audio.
- Agrupar conserva los tiempos, pero un overlay suelto que estaba **por encima** de un miembro queda por debajo del bloque. Si hiciera falta intercalar capas, se puede añadir más adelante una posición de capa opcional en `MixBlock` (aditivo).
- No hay bloques anidados: se agrupan overlays sueltos.
- Los sonidos de los bloques ocultos no se miden en el render; su duración solo importa a lo anclado a su fin (se usa la conocida por la UI, si la hay).
- Detalle y contratos: [04-diseno §11](../04-diseno.md#11-bloques-de-overlays-y-plantillas-v6-t56) y notas de [T56](../execution/T56-v6-bloques-modelo.md).
