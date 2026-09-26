# T56 · v6: modelo de bloques, plantillas y lógica pura

- **Hito**: M13 · **Modelo**: Opus · **Depende de**: — · **Estado**: hecha

## Objetivo

Modelo de datos y lógica pura de H1–H8, con contratos estables para la UI (T57) y exportar/importar (T58).

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§9 (overlays) y §14 (v6)**, [03-convenciones](../03-convenciones.md), [04-diseno](../04-diseno.md) (overlays, §1.2 modelo).
- `videomix/types.ts` (overlays, anclas `absolute | clip | element`, `linkedCountdownId`), `project.ts` (migraciones), `projectReducer.ts`, `overlayTimeline.ts`/`resolveOverlayTimes`, `overlayRemoval.ts`, `overlayStylePresets.ts` (formato de fichero exportado de B2 como precedente), y todos los consumidores de `project.overlays` (render `render/overlayFilters.ts`, audio, preview, vista Mix, validación).

## Especificación orientativa (decide y documenta)

- **Definición + instancia** (sugerido): `blockDefs` (contenido: overlays miembro con tiempos relativos al inicio del bloque, nombre, color) y `blocks` (instancias: `defId`, ancla, valores de variables, oculto, bloqueado, plegado). Un bloque normal es una definición con una sola instancia; las repeticiones (H5) comparten definición; "desvincular" clona la definición. Si eliges otra representación, justifícala.
- **Expansión pura**: una función convierte instancias en overlays concretos (ids deterministas por instancia, anclas internas y `linkedCountdownId` remapeados, variables sustituidas, ocultos excluidos) para que render, audio, preview y validación sigan trabajando con una lista de overlays sin enterarse de los bloques. Las anclas a un bloque/instancia (`element`) deben seguir funcionando.
- **Operaciones puras**: agrupar (hereda el ancla del primer overlay por tiempo; los tiempos quedan idénticos), desagrupar (idénticos), duplicar, desvincular, estirar (H6: escala tiempos y duraciones; fundidos y entradas fijos), repetir (H5: N cada X s, o anclado al inicio de cada clip), adaptar a otra proporción (H7), sustitución de variables `{{nombre}}` / `{{nombre|defecto}}` (H4).
- **Formato `.vmxblock`** (H2): serializar (JSON indentado, estricto) y parsear (JSON5, validación con zod con errores legibles: ruta del campo y motivo), con `format`, `version`, proporción de salida de origen, `originalStart`, tiempos relativos, anclas a clips convertidas a relativas con el nombre del clip como dato informativo, ficheros como rutas relativas al `.vmxblock`. **JSON Schema** generado o escrito a mano y comprobado en un test contra el esquema zod (p. ej. `docs/videomix/vmxblock.schema.json` o junto al código).
- **Modelo v7** con migración v6→v7 (aditiva, según la convención), validación (`validateMixProject`) de bloques y ciclos de anclas.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run` en verde; tests de cada operación (incluida la invariancia de tiempos al agrupar/desagrupar y la ida y vuelta exportar→importar), y que un proyecto sin bloques produce exactamente los mismos grafos de render que antes.
- Sección nueva en [04-diseno](../04-diseno.md) con el modelo y los contratos para T57/T58 en las notas.

## Notas de ejecución

### Resumen de cambios

| Fichero | Cambio |
|---|---|
| `videomix/types.ts` | `mixBlockDefSchema` / `MixBlockDef`, `mixBlockSchema` / `MixBlock`; `MixProject` v7 con `blockDefs` y `blocks`; `createEmptyMixProject` con ambos vacíos. |
| `videomix/project.ts` | Migración v6 → v7 aditiva (`blockDefs: []`, `blocks: []`). `validateMixProject` valida bloques (11 códigos nuevos, `MixProjectIssue.blockId` / `blockDefId`); las referencias de los overlays sueltos se comprueban contra la lista expandida; el contenido de un overlay se comprueba con `validateOverlayContent`, compartido con los miembros. |
| `videomix/blocks/expandBlocks.ts` (nuevo) | Ids expandidos, `shiftAnchor`, normalización de miembros, tiempos relativos (`getBlockDefTimes`, `getBlockDefDuration`), composición de anclas entre bloques (`composeBlockAnchors`, `findBlockCycleIds`), **`expandBlocks`** y **`resolveBlockTimes`**. |
| `videomix/blocks/blockVariables.ts` (nuevo) | `{{nombre}}` / `{{nombre\|defecto}}`: detección, defectos, sustitución, variables sin valor. |
| `videomix/blocks/blockOperations.ts` (nuevo) | Agrupar, desagrupar, borrar bloque/miembro (con desanclaje), duplicar, desvincular, repetir, estirar, adaptar a otra proporción, capas. |
| `videomix/blocks/vmxBlockFile.ts` (nuevo) | Esquema zod del `.vmxblock`, JSON Schema, parseo (JSON5 + errores con ruta), serialización, colocación e instanciación, datos de exportación de un bloque o de una selección. |
| `docs/videomix/vmxblock.schema.json` (nuevo) | JSON Schema draft-07 generado (test que lo compara con zod). |
| `videomix/projectReducer.ts` | 13 acciones de bloques (abajo); `removeClip` / `removeSource` / `removeOverlay` desanclan también bloques (`detachProjectReferences`). |
| `videomix/overlayRemoval.ts` | `resolveProjectTimes` (overlays expandidos + bloques en un mapa); `prepareOverlayRemoval` cubre `removeBlock`, `removeBlockMember` y añade los tiempos a `groupOverlays`; devuelve también `detachedBlocks`; `getBlocksDetachedBy`. |
| `videomix/projectFile.ts` | Ficheros de los miembros: relativos al guardar, resueltos al abrir; `MissingOverlayFile.blockDefId?`. |
| `hooks/useMixProject.ts` | `dispatch`: duraciones de sonidos de la lista expandida y aviso que cuenta también los bloques desanclados. |
| `hooks/useMixRender.ts` | Validación, ficheros, tiempos, grafo y audio con los bloques expandidos (nombres de miembros en los avisos). |
| `hooks/useMixOverlays.ts` | `resolved` sobre `expandBlocks(...).all`; devuelve además `expanded` y `blockTimes`. Los carriles siguen mostrando solo los sueltos. |
| `hooks/useMixLivePreview.ts` | Dibuja y reproduce `expanded.visible`. |
| `hooks/useMixWorkspace.ts` | `missingOverlayFiles` solo de sueltos (los de miembros llevan `blockDefId`). |
| Tests | `blocks/blocks.test.ts` (18), `blocks/blocksRender.test.ts` (2), `blocks/vmxBlockFile.test.ts` (6); `project.test.ts` (migración v6 → v7 y versiones), `projectFile.test.ts` (ficheros de miembros), `overlayRemoval.test.ts` (forma del resultado). |
| Docs | `04-diseno` §1.2 y **§11** nuevo; [ADR-004](../decisiones/ADR-004-bloques-overlays.md) (+ índice). |

### Modelo (resumen; detalle en 04-diseno §11 y ADR-004)

- **Definición + instancia**, como sugería la tarea. `MixBlockDef { id, name, color (índice de paleta), members: MixOverlay[] }`; `MixBlock { id, defId, anchor, variables?, hidden?, locked?, collapsed? }` (las banderas solo se guardan si son `true`; `variables` solo si hay alguna).
- En los miembros, `anchor.kind: 'absolute'` es el **tiempo relativo al inicio del bloque**; `element` y `linkedCountdownId` apuntan a otros miembros por su id de miembro. Así un miembro es un `MixOverlay` normal y T57 puede reutilizar fábricas, panel y validación.
- **Ids expandidos**: `getBlockMemberOverlayId(blockId, memberId)` = `` `${blockId}/${memberId}` ``; `parseBlockMemberOverlayId(id, blockIds?)` hace lo inverso. Son estables: la caché de sonoridad (por id de overlay) y las anclas externas sobreviven a las ediciones.
- **Capas**: todos los bloques van encima de los overlays sueltos, en el orden de `blocks` (`moveBlockLayer`).

### Contratos para T57 (UI)

- **Tiempos y lista para la vista Mix**: `useMixOverlays()` devuelve ya `expanded` (`{ all, visible, origins, anchors }`), `resolved` (con los ids expandidos y los sueltos) y `blockTimes: Map<blockId, ResolvedBlockTime>` (`start`, `end`, `rawStart`, `rawEnd`, `contentEnd`, `warnings`). La pieza del bloque va de `rawStart` a `max(rawEnd, contentEnd)`; al desplegar, los miembros son `expanded.all` filtrados por `origins.get(id)?.blockId`. Los carriles actuales (`layoutOverlayLanes(overlays, …)`) siguen recibiendo solo `project.overlays`: los bloques son trabajo de T57, igual que dibujar sus cajas en la mini vista (`getOverlayFrameBoxes` con `expanded.visible`).
- **Acciones** (`MixProjectAction`, un paso de deshacer cada una; ids siempre del llamante, p. ej. `nanoid()`):
  - `groupOverlays { overlayIds, blockId, defId, name, color, resolved? }`: `useMixProject().dispatch` añade `resolved` solo (como en los borrados). Solo overlays sueltos (no hay bloques anidados).
  - `ungroupBlock { blockId }`. Ojo: un bloque **oculto** pasa a verse al desagruparlo; recomiendo desactivar la acción o avisar.
  - `updateBlock { blockId, patch }` (`anchor`, `variables`, `hidden`, `locked`, `collapsed`; `false`/`{}` se eliminan). **Mover el bloque** = `updateBlock` con `shiftStoredAnchor(anchor, dt)` (o la misma lógica que `getOverlayMovePatch`: `time` si es absoluta, `offset` si no, sin bajar de 0 s con `rawStart`).
  - `updateBlockDef { defId, patch: { name?, color? } }`, `updateBlockMember { defId, memberId, patch: MixOverlayPatch }` (editar un miembro cambia **todas** las instancias: `isBlockLinked(project, blockId)` para el aviso), `removeBlockMember { defId, memberId }`, `removeBlock { blockId }` (los `resolved` los añade `dispatch`).
  - `duplicateBlock { blockId, newBlockId, newDefId, name? }` (copia independiente), `unlinkBlock { blockId, newDefId }`, `repeatBlock { blockId, newBlockIds, repeat: { kind: 'interval', interval } | { kind: 'clips', clipIds } }` (el original se queda: "N veces" = N − 1 ids nuevos; con `clips`, un id por clip), `stretchBlock { blockId, duration }` (usa `getBlockDefDuration` para mostrar la actual), `moveBlockLayer { blockId, to }`.
  - `addBlocks { defs, blocks, index? }` (también para T58).
- **Bloqueado** (`locked`) no lo impone el reducer: la UI debe impedir mover/editar.
- **Variables** (H4): `getBlockDefVariables(def)` (nombres y defectos), `getMissingVariables(def, values)`; guardar con `updateBlock { patch: { variables } }`.
- **Anclas en el panel**: un overlay suelto (o un bloque) puede anclarse a un bloque por su id o a un miembro por su id expandido; `canOverlayDependOn` no conoce los bloques. Para ofrecer solo destinos sin ciclos: aplicar el cambio en una copia y comprobar `findOverlayCycleIds(expandBlocks(copia).all)` y `composeBlockAnchors(copia)` (`cycle`), o comparar los avisos `block-cycle` / `overlay-cycle` de `validateMixProject`.
- **Textos de los avisos nuevos**: `renderDialogs.getIssueText` cae al mensaje en inglés para los códigos `block-*`, `duplicate-block-*` e `invalid-block-member-id`: faltan sus traducciones (i18n es de T57).
- **Ficheros de miembros que faltan**: `loadMixProject` los devuelve con `blockDefId`; `useMixWorkspace` los ignora de momento. Reenlazar = `updateBlockMember` con `{ path, absolutePath }` (o `{ font }`).

### Contratos para T58 (exportar, importar, biblioteca)

- **Exportar un bloque**: `getBlockExport(project, blockId, times)` → `{ def, aspect, originalStart, clipAnchor, variables }`; **exportar selección**: `getOverlaysExport(project, overlayIds, times, { name, color? })` (misma lógica que agrupar: el ancla a un clip queda como `clipAnchor` informativo con el nombre del clip). `times` = `resolveProjectTimes(project, getKnownSoundDurations(expandBlocks(project).all))` (overlayRemoval.ts).
- Después `createVmxBlockFile({ ...export, toFilePath: (file, kind, member) => ruta, schema? })` → objeto y `serializeVmxBlockFile(file)` → texto (JSON estricto con 2 espacios). `toFilePath` decide la ruta guardada: relativa al `.vmxblock` (con "/"), la de la carpeta de "Incluir ficheros" o absoluta. Los ficheros de cada miembro: `getOverlayFiles(member)` (projectFile.ts).
- **Importar**: `parseVmxBlockFile(texto, { resolveFile: (rutaGuardada, kind) => OverlayFile })` → `VmxBlockTemplate { name, color, aspect, originalStart, clipAnchor, variables (valores del fichero + defectos), variableNames, members, duration }` o lanza **`VmxBlockParseError`** con `issues: { path, message }[]` (p. ej. `members[2].box.width: Invalid input: expected number, received string`; sintaxis con línea y columna). No hay estado intermedio: si lanza, no se importa nada.
- **Colocar**: `instantiateVmxBlock(template, { defId, blockId, placement, variables?, adaptTo? })` → `{ def, block }` para `addBlocks`; `placement`: `{ kind: 'original' }`, `{ kind: 'shift', seconds }`, `{ kind: 'cursor', time }`, `{ kind: 'clip', clipId, edge, offset }` (`getVmxBlockPlacementAnchor`). `adaptTo` = proporción del proyecto cuando "Adaptar" está marcado y `template.aspect` es otra (H7, `adaptBlockDefToAspect`). **Importar desagrupado**: `batch` con `addBlocks` + `ungroupBlock` (un paso de deshacer).
- **Vista previa** (overlays, duración): `template.members`, `template.duration` (sin la cola de los sonidos; `getBlockDefDuration(def, { soundDurations })` para incluirla).
- **JSON Schema**: `docs/videomix/vmxblock.schema.json` (draft-07). Si se quiere copiar a la biblioteca o referenciarlo con `$schema`, `getVmxBlockJsonSchema()` lo genera en tiempo de ejecución.
- Extensión: `vmxBlockExtension = 'vmxblock'`; formato `VMXBLOCK_FORMAT`, `VMXBLOCK_VERSION = 1`.

### Decisiones (conservadoras) y dudas

1. **Capas**: los bloques van encima de todos los sueltos. Agrupar conserva tiempos y el orden relativo de los miembros, pero un suelto que estaba por encima de un miembro queda por debajo. Intercalar capas exigiría mantener una posición en cada edición de la lista de sueltos; se puede añadir después (aditivo). **Duda para el usuario** si importa.
2. **Duración del bloque** sin la cola de los sonidos (depende del fichero, no del proyecto): así es la misma para anclas al fin, estirar y la vista previa del `.vmxblock`. Un bloque solo de sonidos dura 0 s (se dibuja con `contentEnd`).
3. **Variable sin valor ni defecto**: se deja el marcador `{{nombre}}` visible y se avisa (`block-missing-variable`), en vez de dejar el texto vacío en silencio.
4. **Repetir "N veces"**: el original cuenta como una; cada copia copia el ancla del original desplazada (no se ancla al original, para que borrar una no mueva las demás). "Al inicio de cada clip": ancla al inicio con desfase 0.
5. **Estirar** actúa sobre la definición (todas las instancias enlazadas, coherente con H5). Escala inicios relativos, desfases internos y duraciones; fundidos, entradas y duración de los sonidos no cambian. Un contador estirado cuenta su nueva duración.
6. **Adaptar** (H7): altura relativa y centro conservados, dentro del fotograma; si no cabe a lo ancho, la caja se reduce entera (sin deformar) y `fontSize` con ella; bordes y sombras (px de referencia de la altura) no cambian. Cambiar la proporción en Ajustes **no** reajusta las imágenes de los miembros (solo las sueltas, como en T34); queda para T57/T59 si se quiere.
7. **Ocultos**: se resuelven (lo anclado a ellos no se mueve) pero ni se dibujan ni suenan; sus sonidos no se miden en el render (se usa la duración conocida por la UI para lo anclado a su fin).
8. **Referencias inválidas dentro de una definición** (ancla a clip, a algo de fuera, barra vinculada fuera): aviso y expansión como relativa en `max(0, offset)` / desvinculada, igual que los respaldos de T19. Los `.vmxblock` las rechazan con error.
9. **Validación de miembros**: el contenido (cajas, duraciones, colores…) una vez por definición, aunque no tenga instancias; una definición rota sin usar también bloquea el render (es un dato corrupto del fichero).

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (99 ficheros, 1210 tests) y `yarn build` en verde.
- Invariancia comprobada: sin bloques, `expandBlocks` devuelve el mismo array y el render recibe exactamente lo de antes; agrupar todos los overlays en un bloque da **los mismos grafos** de vídeo (todos los fragmentos) y de audio; agrupar y desagrupar conservan todos los tiempos (también de lo que depende de los miembros); ida y vuelta exportar → importar del `.vmxblock` idéntica.

## Revisión

- **Resultado**: aceptada (ADR-004). Decisiones 1–8 aceptadas; T57 se encarga de: avisar/impedir desagrupar un bloque oculto (6), respetar `locked` en la UI (7), reajustar las imágenes de los bloques al cambiar la proporción de salida (8), y de ofrecer "Traer al frente / Enviar atrás" para el orden de capas de los bloques (1).
- **Validación del orquestador**: tsc, lint, 1210 tests, e2e 25/25.
