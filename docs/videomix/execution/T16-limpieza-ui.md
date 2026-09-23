# T16 · Limpieza de la UI heredada de LosslessCut

- **Hito**: M5 · **Modelo**: Sonnet · **Depende de**: T13 · **Estado**: hecha

## Objetivo

Ocultar o retirar la UI de LosslessCut que no tiene sentido en VideoMix, **sin romper** la infraestructura reutilizada.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §3 (P1, P2)
- [02-as-built](../02-as-built.md) §2 (menú), §4 (layout)

## Alcance

1. **Inventario** (en las notas de ejecución) de cada elemento de menú, botón de TopMenu y BottomBar y diálogo, con la decisión para cada uno: **mantener**, **ocultar** o **eliminar**.
   - Criterio: se mantiene lo que sirve para marcar tiempos y reproducir (seek, zoom, keyframes, forma de onda, miniaturas, captura de frame, ajustes generales, atajos).
   - Se oculta o elimina lo que sirve para exportar segmentos lossless, concat, EDL import/export, detección de escenas o silencio, tracks/streams, etiquetas o expresiones de segmentos, batch, etc.
   - **Presenta el inventario antes de borrar** si hay casos dudosos: el orquestador lo revisa.
2. Se prefiere **ocultar desde el layout o el menú** a borrar código profundo (menos riesgo). El código muerto evidente y aislado (componentes que ya nadie monta) se puede eliminar.
3. Revisa los atajos de teclado por defecto: quita los que apunten a acciones retiradas.

## Backlog técnico incluido

- `getAnimatedColumn` (planner): con una separación > 0, una columna que aparece o desaparece sin vecina derecha usa x = W. Se ve una barra de un fotograma del ancho de la separación. Hay que usar x = W + gap y mantener coherentes el planificador, `validatePlan` y el render (ver T11, dudas).

- Render (T13): en VideoMix, ignorar `enableOverwriteOutput` (la confirmación la da el diálogo nativo) y limpiar al arrancar los temporales `videomix-*` huérfanos del directorio temporal.

## Criterios de aceptación

- No quedan botones ni menús que lleven a flujos de LosslessCut incompatibles con el proyecto VideoMix.
- `yarn tsc && yarn lint && yarn test run` en verde. Los tests de las partes eliminadas se eliminan con ellas.

## Notas de ejecución

### Enfoque

- **Ocultar, no borrar.** El flag `videoMixMode` pasa a `src/common/videomix/legacyUi.ts` (antes en `videomix/workspace.ts`, que ahora lo reexporta) para que también lo usen main (menú y atajos por defecto) y el renderer.
- **Una sola lista de acciones retiradas**, `retiredKeyboardActions` (mismo fichero), con `isKeyboardActionRetired(action)`. Se usa en cuatro sitios:
  1. `configStore.ts`: los atajos por defecto de esas acciones no se crean (`allDefaultKeyBindings` → `defaultKeyBindings` filtrado).
  2. `App.tsx` (`mainActions`): en VideoMix esas acciones son un no-op con `console.warn`. Así no hacen nada aunque un `config.json` antiguo aún las tenga asignadas, ni si llegan por IPC o por la API HTTP.
  3. `KeyboardShortcuts.tsx`: no se listan. Siguen en `actionsMap` para que el diálogo no borre sus asignaciones como "inválidas".
  4. El menú (`menu.ts`) oculta los items equivalentes con `llcOnly([...])`.
- `importEdlFile`, `exportEdlFile` y `promptDownloadMediaUrl` (acciones IPC con argumentos, fuera de `mainActions`) no se registran en VideoMix.
- **Código muerto**: no hay componentes aislados que ya nadie monte. `BatchFilesList`, `SegmentList`, `ExportConfirm`, `ConcatDialog`, `StreamsSelector`, `WhatsNew`… siguen montados en la rama `!videoMixMode` (compilan y se comprueban con `tsc`). No se ha borrado nada (T05 decía "lo borra T16"; se ha preferido ocultar, como pide el orquestador).

### Inventario

Decisión: **M** = mantener, **O** = ocultar en VideoMix (el código sigue para el modo LosslessCut), **E** = eliminar. No hay ningún caso **E**.

#### Menú (`src/main/menu.ts`)

| Menú | Elemento | Decisión | Motivo |
|---|---|---|---|
| Archivo | Abrir (Ctrl+O) | M | En VideoMix añade fuentes o abre un `.vmx` (T05). |
| Archivo | Abrir carpeta | M | Añade como fuentes los ficheros de la carpeta (recursivo). Ver dudas. |
| Archivo | Abrir URL | O | Descarga y carga un fichero que no es fuente del proyecto. |
| Archivo | Cerrar (Ctrl+W) | M | Descarga la fuente del reproductor. |
| Archivo | Cerrar lote | O | No hay lote. |
| Archivo | Importar/Exportar proyecto (LLC), Importar proyecto ▸ (CSV, EDL, XML, CUE, PBF, SRT, OTIO…), Exportar proyecto ▸ (CSV, TSV, SRT, capítulos de YouTube) | O | EDL / `.llc`; el proyecto es el `.vmx`. |
| Archivo | Convertir a un formato compatible | M | Solo crea un fichero de previsualización para reproducir (no cambia la fuente). |
| Archivo | Corregir duración incorrecta, Diezmar vídeo | O | Cargan una copia que no es fuente del proyecto. |
| Archivo | Ajustes, Salir | M | |
| Proyecto | Todo | M | VideoMix (T05, T13). |
| Editar | Deshacer … Seleccionar todo (roles nativos) | M | Para campos de texto. |
| Editar | Pistas ▸ (Extraer todas, Editar pistas/metadatos) | O | Pistas/streams. |
| Segmentos | Todo el menú | O | Generar/ordenar/combinar/invertir/desplazar/alinear/borrar segmentos. "Dividir segmento en el cursor" sigue en su atajo (B), que en VideoMix divide el clip. |
| Ver | Todo | M | |
| Herramientas | Unir/concatenar, Desfase/timecode inicial, Detectar negro/silencio/cambios de escena, Crear segmentos desde fotogramas clave | O | Concat, timecode, detección. |
| Herramientas | Leer todos los fotogramas clave, Últimos comandos de ffmpeg, Herramientas de desarrollo | M | |
| Ayuda | Cómo usar, FAQ, Solución de problemas, Atajos, Más información, Informar de un error, Fichero de configuración, Fichero de registro, Código fuente, Licencias, Acerca de | M | Ver dudas (varios enlazan a LosslessCut). |
| Ayuda | Solicitar una función, Donar | O | Son para el proyecto LosslessCut. |

#### Barra superior (`TopMenu.tsx`)

| Elemento | Decisión | Motivo |
|---|---|---|
| Pistas (n/m), Filtro de pistas, Aplicar filtro | O | Pistas. |
| Directorio de trabajo | O | Solo afecta a capturas y conversiones; sigue en Ajustes → "Directorio de trabajo". |
| Formato de salida, candado de formato, modo de exportación | O | Export de LosslessCut. |
| Modo oscuro | M | Ahora siempre visible (antes solo en vista avanzada). |
| Ajustes | M | |

#### Barra inferior (`BottomBar.tsx`)

| Elemento | Decisión | Motivo |
|---|---|---|
| Forma de onda, miniaturas, fotogramas clave | M | |
| Saltos de segmento/inicio/fin, marcar inicio/fin, tiempos de corte editables, fotograma anterior/siguiente, fotograma clave anterior/siguiente, reproducir | M | Marcar tiempos y reproducir. |
| Yin-yang (conservar/quitar segmentos) | O | Los clips siempre se conservan; además `invertCutSegments` se fuerza a `false`. |
| Botón vista simple / "Cambiar a vista avanzada" | O | VideoMix fuerza la vista avanzada (ver abajo). |
| Zoom, velocidad de reproducción | M | |
| Cambiar FPS (velocidad de salida) y FPS del vídeo | O | Solo afecta al export de LosslessCut. |
| Rotación | O | Ya oculto desde T07. |
| Cerrar fichero y limpiar (papelera) | O | Enviaría a la papelera una fuente del proyecto. |
| Capturar fotograma y formato de captura | M | |
| Reproducir segmentos seleccionados | M | Reproduce los clips de la fuente activa. |
| Controles de export | — | Ya sustituidos por Ajustes / Vista previa / Renderizar (T13). |

#### Paneles, pantallas y diálogos

| Elemento | Decisión | Motivo |
|---|---|---|
| `BatchFilesList`, `SegmentList` | — | Ya sustituidos por `SourceList` y `ClipList` (T05, T07). |
| `NoFileLoaded`: línea "vista simple/avanzada" | O | |
| `NoFileLoaded`: enlace promocional de LosslessCut (`loadMifiLink`) | O | Tampoco se hace la petición de red. |
| `ExportConfirm`, `ConcatDialog` | O | No se montan. |
| Diálogo de pistas (`StreamsSelector`) | O | Sigue montado, pero ya nada lo abre. |
| `WhatsNew` | O | Son las notas de versión de LosslessCut. |
| Ajustes, atajos, últimos comandos, `ValueTuners`, Working, errores, `GenericDialog` | M | |
| `PlaybackStreamSelector`, volumen, reproductor compatible (FFmpeg) | M | Solo reproducción. |

#### Ajustes (`Settings.tsx`)

| Fila | Decisión |
|---|---|
| Idioma, mostrar ajustes avanzados, FFmpeg personalizado, buscar actualizaciones, varias instancias | M |
| Mostrar la pantalla de opciones de exportación | O |
| Guardar automáticamente el proyecto, guardar el `.llc` en el directorio de trabajo | O |
| Encabezado "Opciones que afectan a los ficheros exportados", modo de corte (conservar/quitar), fecha de modificación de salida y de origen, corte por fotograma clave, limpiar ficheros tras exportar, pistas no procesables | O |
| Directorio de trabajo | M (queda sin su encabezado, al final del bloque general) |
| Capturas y extracción de fotogramas, teclado y ratón, interfaz, notificaciones, confirmar al cerrar, HEVC, `-hwaccel` | M |
| Cargar el timecode como desfase | O (y en VideoMix no se aplica aunque esté activado) |
| Preguntar qué hacer al abrir otro fichero, importar capítulos a segmentos | O (VideoMix no pregunta ni importa) |

#### Atajos por defecto y acciones retiradas

`retiredKeyboardActions` (62 acciones), por grupos:

- **Segmentos** (sustituidos por clips o sin sentido): `addSegment`, `duplicateCurrentSegment`, `removeCurrentSegment` (los tres tienen equivalente en "Añadir/Duplicar/Eliminar clip"), `editCurrentSegmentTags`, `copySegmentsToClipboard`, `reorderSegsByStartTime`, `invertAllSegments`, `fillSegmentsGaps`, `shiftAllSegmentTimes`, `alignSegmentTimesToKeyframes`, `combineOverlappingSegments`, `combineSelectedSegments`, `shuffleSegments`, `clearSegments`.
- **Generación y detección**: `createSegmentsFromKeyframes`, `createFixedDurationSegments`, `createNumSegments`, `createFixedByteSizedSegments`, `createRandomSegments`, `detectBlackScenes`, `detectSilentScenes`, `detectSceneChanges`.
- **Selección, etiquetas y expresiones**: `selectSegmentsAtCursor`, `selectOnlyCurrentSegment`, `toggleCurrentSegmentSelected`, `deselectAllSegments`, `selectAllSegments`, `invertSelectedSegments`, `removeSelectedSegments`, `selectAllMarkers`, `selectSegmentsByLabel`, `selectSegmentsByExpr`, `labelSelectedSegments`, `mutateSegmentsByExpr` y `extractSelectedSegmentsFramesAsImages`. La lista de clips no tiene selección y un segmento deseleccionado se renderizaría igualmente.
- **Pistas**: `toggleStreamsSelector`, `showStreamsSelector`, `extractAllStreams`, `showIncludeExternalStreamsDialog` y `toggleStrip*` (6).
- **Export lossless**: `toggleKeyframeCutMode`, `captureSnapshotAsCoverArt`, `exportYouTube`.
- **Lote y concat**: `batchPreviousFile`, `batchNextFile`, `batchOpenPreviousFile`, `batchOpenNextFile`, `batchOpenSelectedFile`, `closeBatch`, `concatBatch`, `convertFormatBatch`.
- **Ficheros**: `cleanupFilesDialog`, `fixInvalidDuration`, `decimate`.
- **Otros**: `increaseRotation`, `setStartTimeOffset`, `makeCursorTimeZero`.

**Atajos por defecto que desaparecen**: `Mayús+=` (añadir segmento), `Mayús+Z` (cursor a cero), `Ctrl/Cmd+Alt+C` (copiar segmentos), `D` (cerrar y limpiar), `R` (rotación), `T` / `Mayús+T` (pistas), `Mayús+↑/↓`, `Ctrl+Mayús+↑/↓` y `Mayús+Intro` (lote).

**Se mantienen** los atajos de reproducción, búsqueda, zoom, `I`/`O`, `B` (dividir clip), `Retroceso` (quitar punto de corte), `Intro` (etiquetar = renombrar el clip, que se sincroniza), saltos de segmento (clips de la fuente activa), captura, deshacer/rehacer, pantalla completa, `E` (renderizar) y los de VideoMix.

En el diálogo de atajos, `export` se llama "Render mix" en VideoMix.

### Vista simple / avanzada (punto 1 del orquestador)

- En VideoMix, `useUserSettingsRoot` expone `simpleMode: false` (y `invertCutSegments: false`) sea cual sea el valor guardado. El valor guardado no se toca.
- Resultado: siempre la vista avanzada.
  - `I` sin clip actual crea un **marcador** y `O` lo convierte en clip (no el segmento de 10 s de la vista simple).
  - La barra inferior muestra todos los controles de tiempo y el botón de modo oscuro está siempre visible.
  - Sin confeti al capturar.
- Se ocultan el conmutador de vista (barra inferior y pantalla inicial) y el yin-yang, y la fila "modo de corte" de Ajustes.

### Render (punto 2)

- `useMixRender` ya no recibe `enableOverwriteOutput`. La confirmación de sobrescritura la da el diálogo nativo (en Linux con `showOverwriteConfirmation`), y el fichero existente solo se sustituye al terminar (nombre parcial + `rename`).
- **Limpieza de temporales al arrancar** (efecto de montaje en `useMixRender`):
  - Se lee el directorio temporal del sistema y se borran solo las entradas cuyo nombre es exactamente de las nuestras (`videomix-render-<id8>`, `videomix-preview-<id8>` o `videomix-preview-<id8>.mp4`), que son ficheros o directorios (no enlaces) y que no se han modificado en 24 h.
  - Es conservador: 24 h cubre un render en curso de otra instancia.
  - El filtro es puro (`getOrphanTempEntries` en `renderOutput.ts`, con test). Los errores solo se registran.
  - No se limpian los `*.part.mp4` de la carpeta de salida (no se sabe dónde están; solo quedan si la app muere durante el `concat` final).

### Planificador / render (punto 3)

- `getAnimatedColumn`: una columna que aparece o desaparece **sin vecina derecha** usa `x = W + gap` (antes `W`).
- Hacía falta más para que fuera continuo. Con `x = W + gap` solo, la barra seguía apareciendo, porque tanto el relleno entre columnas como la barra de separación se ponían pegados a la columna izquierda. Cambios:
  - `getFillSpansAtFrame`: el relleno que se abre entre dos columnas durante una animación toca la columna **izquierda** (`[fin de la izquierda, x de la derecha − gap]`), y la separación queda pegada a la derecha. Cuando la derecha está fuera (x ≥ W), ese relleno coincide exactamente con el relleno derecho del keyframe anterior. El ancho del relleno no cambia, solo su posición.
  - `buildVideoGraph`: las barras de separación redibujadas en bloques animados van en `max(fin de la izquierda, x de la derecha − gap)`. Sin relleno entre medias es lo mismo que antes. Con una columna fuera del fotograma, la barra también queda fuera.
- `validatePlan` usa la misma función (sin más cambios). Actualizados el JSDoc, 04-diseno §3.1 y ADR-001 (regla y barras).
- Tests:
  - `planMix.test.ts`: `x = W + gap` con separación.
  - `buildVideoGraph.test.ts`, test nuevo: con el plan `fills`, las áreas del fotograma anterior a la animación y las de su primer fotograma son idénticas, y el relleno intermedio toca la columna izquierda.
  - Snapshot de `buildRenderJob` (plan `fills`) actualizado: el relleno intermedio pasa de x = 548 a 540, y la barra de 540 (visible en el primer fotograma) a 640 (fuera).
- **Comprobado con ffmpeg real** (script local, no incluido): con el plan `fills`, separación roja de 8 px y relleno azul, la barra ya no aparece en el fotograma 60 (inicio de la animación). La separación entra desde el borde derecho (x = 636 → 364) de forma continua.

### Diálogos solapados al arrancar (punto 4)

- `useMixWorkspace` guarda en una ref la promesa de la oferta de recuperación del arranque, y `openFiles` la espera antes de hacer nada.
- Un `.vmx` (o vídeos) abierto por línea de comandos o por asociación de ficheros se procesa después de responder al diálogo de recuperación.
- Si se ha elegido "Restaurar", abrir el `.vmx` pregunta después si guardar los cambios del proyecto recuperado.

### Ficheros

| Fichero | Cambio |
|---|---|
| `src/common/videomix/legacyUi.ts` (+ `legacyUi.test.ts`) | Nuevo: `videoMixMode`, `retiredKeyboardActions`, `isKeyboardActionRetired`. |
| `src/main/menu.ts` | `llcOnly([...])` en los items retirados. |
| `src/main/configStore.ts` | Atajos por defecto sin las acciones retiradas. |
| `App.tsx` | Acciones retiradas como no-op. Sin acciones IPC de EDL/URL. Sin `loadMifiLink`, `ExportConfirm`, `ConcatDialog` ni `WhatsNew`. Timecode no cargado como desfase. `useMixRender` sin `enableOverwriteOutput`. |
| `TopMenu.tsx`, `BottomBar.tsx`, `NoFileLoaded.tsx`, `components/Settings.tsx`, `components/KeyboardShortcuts.tsx` | Elementos ocultos en VideoMix (ver inventario). |
| `hooks/useUserSettingsRoot.ts` | `simpleMode` e `invertCutSegments` forzados a `false` en VideoMix. |
| `videomix/workspace.ts` | Reexporta `videoMixMode`. |
| `videomix/hooks/useMixRender.ts`, `videomix/render/renderOutput.ts` (+ test) | Sin `enableOverwriteOutput`. Limpieza de temporales. |
| `videomix/hooks/useMixWorkspace.ts` | `openFiles` espera a la oferta de recuperación. |
| `videomix/planner/validatePlan.ts`, `videomix/render/renderTimeline.ts`, `videomix/render/buildVideoGraph.ts` (+ tests y snapshot) | `W + gap`, relleno intermedio y barras. |
| `04-diseno.md` §3.1, `ADR-001` | Regla actualizada. |

- **i18n**: no hay textos nuevos. `scan-i18n` no cambia los locales, y "Render mix" ya estaba traducido.

### Validación

- `tsc`, `lint`, `test run` (36 ficheros, 413 tests, incluidos los de ffmpeg real) y `build` en verde.
- No se puede lanzar la app aquí (sin pantalla).

### Prueba manual (usuario)

Preparación: `yarn dev`. Para ver los atajos nuevos por defecto: Ajustes → Atajos → restablecer, o borrar `config.json`.

1. **Menú**:
   - Archivo: Abrir, Abrir carpeta, Cerrar, Convertir a un formato compatible, Ajustes, Salir. No aparecen Abrir URL, Cerrar lote, importar/exportar proyecto, Corregir duración ni Diezmar.
   - No hay menú Segmentos.
   - Editar: sin Pistas.
   - Herramientas: solo Leer todos los fotogramas clave, Últimos comandos y DevTools.
   - Ayuda: sin "Solicitar una función" ni "Donar".
2. **Barra superior**: solo el botón de modo oscuro y el de Ajustes, también con un vídeo cargado.
3. **Barra inferior**: con un vídeo cargado, no aparecen el yin-yang, el conmutador de vista, la papelera ni el velocímetro de FPS. Sí aparecen los tiempos de corte editables, los saltos, el zoom, la captura y Ajustes / Vista previa / Renderizar.
4. **Vista avanzada forzada**: aunque `config.json` tenga `"simpleMode": true`, `I` en una zona sin clip crea un marcador y `O` lo convierte en clip.
5. **Pantalla inicial**: sin la línea "vista simple/avanzada" ni el recuadro promocional.
6. **Atajos retirados**: `D`, `R`, `T`, `Mayús+Z` y `Mayús+=` no hacen nada. En la consola (DevTools) sale "Action not available in VideoMix" si el `config.json` aún los asigna. En el diálogo de atajos no aparecen las categorías "Lista de ficheros por lotes" ni "Pistas", y `E` se llama "Render mix".
7. **Ajustes**: no aparecen las filas del inventario marcadas O. Sí aparece "Directorio de trabajo".
8. **Sobrescritura**: con `"enableOverwriteOutput": false` en `config.json`, renderiza dos veces al mismo fichero. El diálogo nativo pide confirmación y el render sustituye el fichero (antes lo rechazaba).
9. **Temporales huérfanos**:
   - Con la app cerrada, crea en `/tmp` (o `%TEMP%`) un directorio `videomix-render-abcdefgh` y un fichero `videomix-preview-abcdefgh.mp4`, y ponles una fecha antigua (`touch -d '2 days ago' …`).
   - Crea también `videomix-render-recent01` con la fecha actual y `videomix-otro`.
   - Arranca: desaparecen los dos antiguos; los otros dos siguen.
10. **Recuperación + `.vmx` por línea de comandos**:
    - Deja un fichero de recuperación (cambia algo y mata el proceso).
    - Arranca con `yarn dev -- test-media/prueba.vmx` (o abriendo el `.vmx` con la app).
    - Primero sale solo el diálogo de recuperación. Al responder se abre el `.vmx`; si has restaurado, antes pregunta si guardar los cambios.
11. **Render**: con separación > 0 y un clip cuadrado entre rellenos que luego pasa a dos columnas (como el plan `fills`), la vista previa no muestra una barra de la separación de un fotograma al empezar la animación.

### Dudas para el orquestador

1. **Ayuda**: "Cómo usar", "FAQ", "Solución de problemas", "Más información", "Código fuente", "Licencias" y "Informar de un error" abren páginas de LosslessCut. Se han dejado. ¿Se redirigen al repositorio de VideoMix o al manual de T17, o se ocultan?
2. **"Abrir carpeta"** añade como fuentes todos los ficheros no reconocidos como audio/proyecto/EDL de la carpeta (también imágenes, etc.). ¿Se mantiene?
3. **Textos con la marca LosslessCut** visibles en VideoMix: "Quit LosslessCut" (diálogo de atajos) y "Allow multiple instances of LosslessCut…" (Ajustes). ¿T17?
4. **"Dividir segmento en el cursor"** ya no está en ningún menú (solo `B`). ¿Se añade "Split clip" al menú Proyecto?
5. **Borrado del código de lote/segmentos/export**: se ha preferido ocultar. Si se quiere borrar de verdad (`BatchFilesList`, `ConcatDialog`, `ExportConfirm`, EDL…), sería una tarea aparte con más riesgo sobre `App.tsx`.
6. **Selección de segmentos**: se ha retirado. Los clips entran en el timeline seleccionados (`clipToSegment`), así que "Reproducir segmentos seleccionados" reproduce todos los clips de la fuente activa. ¿Correcto, o se quiere una selección de clips propia?
7. **"Extraer fotogramas del segmento actual como imágenes"** (sin atajo por defecto) se mantiene como herramienta de captura. ¿Correcto?

## Revisión

- **Resultado**: aceptada. `tsc`, `lint`, tests (413) y `build` en verde. Se ha ocultado la UI heredada sin borrar código.
- **Decisiones del orquestador sobre las dudas**:
  1. Enlaces de ayuda de LosslessCut: se ocultan los específicos. "Source code" apunta al repo de VideoMix y se añade el enlace al manual (T17).
  2. "Open folder": se filtra a ficheros de vídeo, sin imágenes (T17).
  3. Los textos con "LosslessCut" se renombran a VideoMix (T17).
  4. Se añade "Split clip" al menú Project (T17).
  5. El borrado del código oculto va al backlog, fuera de v1.
  6. "Play selected segments" reproduce los clips de la fuente activa; se acepta.
  7. Se mantiene "Extract frames".
