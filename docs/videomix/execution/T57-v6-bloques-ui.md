# T57 · v6: bloques en la interfaz (H1, H5, H6, H8)

- **Hito**: M13 · **Modelo**: Opus · **Depende de**: T56 · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§9 (overlays) y §14 (v6)**, [03-convenciones](../03-convenciones.md), [04-diseno](../04-diseno.md) (overlays, §1.2 modelo).
- Notas de T56 (contratos), T22 (pistas de overlays en la vista Mix y panel de propiedades), T53 (filas y zoom de la vista Mix), T51 (atajos y deshacer).

## Alcance

1. **Selección múltiple** de overlays (Ctrl/Mayús+clic) en la vista Mix y donde se listen.
2. **Agrupar en bloque**, desagrupar, renombrar, color, duplicar, borrar; el bloque se ve como una pieza en su pista y **se arrastra entero**; plegar/desplegar; **editar un miembro dentro** (panel de propiedades del miembro, con aviso si es una instancia enlazada: cambia todas).
3. **Repetir** (H5): diálogo "N veces cada X s" o "al inicio de cada clip seleccionado"; indicador de instancia enlazada; **Desvincular**.
4. **Estirar** (H6): "Duración del bloque…".
5. **Ocultar / bloquear** (H8).
6. **Variables** (H4): editar los valores de una instancia en su panel.
7. **Pendientes de T56**: orden de capas de los bloques ("Traer al frente / Enviar atrás", `moveBlockLayer`); desagrupar un bloque oculto (avisar o impedir); respetar `locked` (no mover ni editar); reajustar las imágenes de los bloques al cambiar la proporción de salida en Ajustes, igual que las sueltas; destinos de ancla que conozcan los bloques (`canOverlayDependOn`); traducción de los códigos `block-*` de validación; mostrar ficheros de miembros que faltan.
8. Deshacer en un paso por acción; i18n (en + es); e2e.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde; capturas revisadas.

## Notas de ejecución

### Resumen de cambios

| Fichero | Cambio |
|---|---|
| `videomix/blocks/blockUi.ts` (nuevo, + test, 13 tests) | Lógica pura de la UI: carril de bloques (`layoutBlockLane`), arrastre de un bloque (`getBlockMoveAnchor`), selección múltiple (`getSelectionMode`, `getNextSelection`), `isBlockDefLocked`, `getBlockLabel`, destinos de ancla sin ciclos que conocen los bloques (`getAnchorTargets`, `wouldCreateAnchorCycle`) y `getRepeatClipIds`. |
| `videomix/hooks/useMixOverlays.ts` | Selección múltiple (sueltos y bloques) y miembro editado; acciones de bloques (`userGroupSelection`, `userRemoveSelection`, `userUngroupBlock`, `userRemoveBlock`, `userDuplicateBlock`, `userUnlinkBlock`, `userRepeatBlock`, `userStretchBlock`, `userMoveBlockLayer`, `userUpdateBlock`, `userUpdateBlockDef`, `userUpdateBlockMember`, `userRemoveBlockMember`, `userChooseBlockMemberFile`) con las comprobaciones de bloqueo. Devuelve también `project`. |
| `videomix/components/MixPlanView.tsx` | Carril "Bloques" con piezas arrastrables (`BlockPiece`), plegar/desplegar, miembros seleccionables/arrastrables, Ctrl/Mayús+clic en carriles y mini vista, cajas de los miembros visibles en la mini vista (arrastre = `updateBlockMember`), contorno de la selección múltiple. `data-testid`: `block-lane`, `block-piece` (`data-block-id`, `data-selected`, `data-hidden`, `data-locked`), `block-collapse`; `overlay-block` gana `data-overlay-id` y `data-selected`. |
| `videomix/components/OverlaySelectionPanel.tsx` (nuevo) | Elige el panel: overlay suelto, bloque, miembro o selección múltiple ("Agrupar en bloque", "Borrar"). |
| `videomix/components/BlockPanel.tsx` (nuevo) | Panel del bloque: nombre, color, enlazado + "Desvincular", Oculto/Bloqueado, duplicar, repetir, duración, desagrupar, borrar, capas, avisos (tiempos, ficheros de miembros, variables sin valor), ancla, duración, variables de la instancia y lista de miembros. |
| `videomix/components/BlockDialogs.tsx` (nuevo) | Diálogos "Repetir…" y "Duración del bloque…". |
| `videomix/components/OverlayPanel.tsx` | Modo miembro (`member`): edita la definición, aviso de bloque enlazado, "Volver al bloque", "Quitar del bloque", sin duplicar/capas, "Tiempo en el bloque", sin clips en el ancla, pista de variables en los textos; `fieldset disabled` si está bloqueado. `AnchorFields` exportado y con `targets` (destinos calculados fuera). |
| `videomix/hooks/useMixWorkspace.ts` | Conserva los ficheros que faltan de los miembros; `userLocateOverlayFile` / `clearMissingOverlayFile` con `blockDefId` opcional. |
| `videomix/hooks/useMixProject.ts`, `projectReducer.ts` (+ test) | `updateSettings` con `memberImageSizes`: al cambiar la proporción de salida se reajustan también las imágenes de los bloques. |
| `videomix/renderDialogs.tsx`, `hooks/useMixRender.ts` | Textos traducidos de los 11 códigos `block-*` / `duplicate-block-*` / `invalid-block-member-id` (4.º parámetro `blockName`); los avisos de contenido de un miembro llevan delante "Bloque "…":". |
| `App.tsx` | Un solo punto: `OverlayPanel` → `OverlaySelectionPanel` (condición `hasOverlaySelection`), con `selectedClipIds`. |
| `locales/en`, `locales/es` | `scan-i18n` (incluye textos de T58 en curso) y 73 traducciones al español de los textos de T57. |
| `e2e/videomix.e2e.ts` | Escenario **24** (`describe` propio). |
| `MixPlanView.tsx` (encargo del orquestador, detectado por T58) | El eje de tiempos pegajoso (`zIndex: 2`, T53) se dibujaba **encima de los diálogos** altos (captura `25-block-import`). Arreglo de raíz: `isolation: 'isolate'` en la raíz de la vista Mix, así sus `z-index` internos (eje, clip arrastrado) quedan en su propio contexto de apilamiento y los diálogos y menús (fijos, después en el documento) siempre van encima. El e2e 24 lo comprueba (con "Ajustes" abierto, lo que hay en el centro del eje no es el eje); sin el arreglo, falla. |
| `04-diseno` §11.6 | Resumen de la interfaz. |

### Contrato para T58 (selección)

- `useMixOverlays()` devuelve `selectedLooseOverlayIds` y `selectedBlockIds` (en orden de capas), `selectedIds` (orden de clic), `selectedBlock`, `selectedMember` (`{ block, def, member, overlayId }`), `hasOverlaySelection`, `selectOverlayItem(id, mode?)`, `selectBlockMember(blockId, memberId)`, `clearOverlaySelection()` y `setSelectedOverlayId(id)` (selecciona solo ese). Tras importar un bloque, T58 puede seleccionarlo con `selectOverlayItem(blockId)`.
- Seleccionar un bloque (clic en su pieza) deja `selectedBlockIds = [id]` (también mientras se edita uno de sus miembros): "Exportar bloque…" exporta el bloque entero. El e2e 24 lo comprueba con la acción de menú `exportBlock` (el diálogo dice "Export block", no "Export selection…").
- La selección múltiple se muestra en `MultiSelectionPanel` (`OverlaySelectionPanel.tsx`); si T58 quiere un botón "Exportar selección" ahí, basta añadirlo junto a "Agrupar en bloque".

### Decisiones (opción conservadora)

1. **Selección**: Ctrl/Cmd+clic alterna, Mayús+clic añade (en overlays no hay un orden evidente para un rango). Un clic con modificador sobre un miembro actúa sobre su bloque. Sin arrastre múltiple: arrastrar mueve solo lo pulsado.
2. **Dónde se ven los bloques**: un carril propio "Bloques" debajo de los tres de overlays (los bloques mezclan tipos). Plegado = solo la pieza. El plegado se guarda en el proyecto (`collapsed`, modelo de T56), así que es un paso de deshacer.
3. **Agrupar** solo si todo lo seleccionado son overlays sueltos (no hay bloques anidados). Nombre "Bloque #n", color: el menos usado de la paleta.
4. **Bloqueado** (H8): impide mover, editar, borrar, desagrupar, repetir y cambiar la capa; se permiten ocultar, plegar, duplicar y desbloquear. El **contenido** compartido no se edita si **cualquier** copia enlazada está bloqueada (si no, editar una copia libre cambiaría la bloqueada); "Desvincular" la copia libre permite editarla. Borrar una selección múltiple conserva los bloques bloqueados.
5. **Oculto**: no se puede desagrupar (botón desactivado con explicación y aviso si se intenta): sus overlays aparecerían de golpe.
6. **Repetir al inicio de cada clip**: los clips seleccionados (lista o vista Mix) en orden del vídeo, sin el clip en cuyo inicio ya está el bloque (sería una copia encima). "N veces" cuenta el bloque (N − 1 copias), como T56. Intervalo por defecto: la duración del bloque (mín. 1 s).
7. **Variables**: un campo por variable con el defecto como marcador; vacío = sin valor (se usa el defecto). Se aplica al salir o con Intro (un paso).
8. **Nombre y color** son de la definición: renombrar una copia enlazada renombra todas (la lista muestra "Nombre (i/N)").
9. **Destinos de ancla**: se ofrecen overlays sueltos, bloques y miembros (expandidos) sin crear **ningún** ciclo nuevo; la "Vinculación a cuenta atrás" de una barra suelta sigue ofreciendo solo contadores sueltos.
10. **Miembros en la mini vista**: pulsar la caja de un miembro lo selecciona para editarlo (si el contenido no está bloqueado, se arrastra: cambia todas las copias).
11. **Ficheros que faltan de miembros**: si se agrupa un overlay cuyo fichero faltaba, el aviso (guardado como suelto) se pierde hasta volver a abrir el proyecto; al reabrir aparece en el bloque.

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (101 ficheros, 1234 tests) y `yarn build` en verde (con el trabajo de T58 en curso en el árbol).
- `yarn test-e2e`: **27/27** en verde (dos pasadas completas). En una tercera pasada, lanzada a la vez que otra actividad en la máquina, falló una vez el **21** (T51: el arrastre del deslizador CRF justo al abrir "Ajustes"; la caja del deslizador se lee mientras el diálogo aún se anima) y pasó en las dos repeticiones aisladas y en la pasada completa siguiente: fragilidad de tiempos del escenario, no relacionada con esta tarea.
- e2e **24**: dos clips; contador y texto con `{{team|Blue}}`; Ctrl+clic → "2 selected" → "Agrupar en bloque" (1 pieza, 2 miembros en el carril; guardado: sin sueltos, 1 definición y 1 instancia en 0 s); deshacer/rehacer del agrupado; variable "Red"; arrastre de la pieza (ancla > 0,5 s, los miembros la siguen) y deshacer en un paso; plegar/desplegar; repetir 3 veces cada 4 s (3 piezas, 1 definición, anclas 0/4/8); editar la duración del contador desde el panel del miembro con el aviso "sus 3 copias"; desvincular (2 definiciones); duración del bloque → 10 s; oculto (desagrupar desactivado); bloqueado (nombre y borrar desactivados, el arrastre no mueve); desagrupar (2 sueltos seleccionados, texto "Go Red!"). Capturas `24a`–`24c` revisadas.

## Revisión

- **Resultado**: aceptada. Validación del orquestador (T57 + T58 juntas): tsc, lint, 1234 tests, e2e 27/27 dos veces.
