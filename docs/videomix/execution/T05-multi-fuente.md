# T05 · Integración multi-fuente en la app

- **Hito**: M2 · **Modelo**: Opus · **Depende de**: T04 · **Estado**: hecha

## Objetivo

Que la app trabaje con un **proyecto VideoMix de varias fuentes**:
- panel izquierdo de fuentes;
- activar una fuente la carga en el player/timeline sin perder el proyecto;
- menú y atajos de proyecto.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §3 (P1, P2), §7
- [04-diseno](../04-diseno.md) §6.1, §6.2, §7
- [02-as-built](../02-as-built.md) §2 (menú e IPC), §4 (`loadMedia`, `resetState`, `userOpenFiles`, batch), §5 (autosave `.llc`)
- [03-convenciones](../03-convenciones.md) §5: cambios mínimos en `App.tsx`

## Alcance

1. **`useMixProject`** (T04) montado en `App.tsx` de forma que **no** lo borre `resetState()`, y expuesto a los componentes (prop o contexto nuevo `MixProjectContext`).
2. **Modo VideoMix** (la app funciona siempre así):
   - `loadMedia` no busca ni carga `.llc`, no importa capítulos como segmentos y no dispara `useSegmentsAutoSave`;
   - `userOpenFiles`: los vídeos soltados o abiertos se **añaden como fuentes** al proyecto (sin preguntar la acción de apertura), un `.vmx` abre el proyecto y un fichero de audio se ofrece como música del proyecto;
   - que sea con cambios pequeños y localizados (un flag o parámetro), comentando el *por qué*.
3. **`videomix/components/SourceList.tsx`** (panel izquierdo; sustituye a `BatchFilesList` en el layout):
   - lista de fuentes con nombre, duración y número de clips;
   - fuente activa resaltada; clic para activar (`loadMedia` de su ruta);
   - quitar la fuente, con confirmación si tiene clips;
   - botón para añadir;
   - aviso de fuente no encontrada con acción "Localizar…" (`relinkSource`).
4. **Menú (main, `menu.ts`)**: "Project" con New, Open…, Save, Save As… y Add videos…, y los canales IPC correspondientes en `App.tsx` (`mainActions` / `allActions`).
   - Las nuevas `KeyboardAction` van en `src/common/types.ts`, con atajos por defecto razonables en `configStore.ts`: Ctrl/Cmd+S guardar y Ctrl/Cmd+Shift+S guardar como, **comprobando conflictos** con los atajos existentes.
5. **Título de la ventana**: nombre del proyecto más un `*` si hay cambios sin guardar.
6. **Cierre**: si hay cambios sin guardar, confirmar (reutiliza el mecanismo `askBeforeClose` / `setAskBeforeClose`).
7. **Recuperación al arrancar**: si `findRecoverableProjects()` devuelve algo, se ofrece restaurarlo.
8. **Fuente activa**:
   - Se mantiene `currentSourceId` en el estado de VideoMix.
   - Al cambiar de fuente, el timeline muestra los segmentos que T07 sincronizará. Mientras tanto, déjalo vacío o con un placeholder.

## Fuera de alcance

- Clips, overlay y lista de clips (T06, T07).
- Eliminar la UI heredada (T16). En esta tarea solo se **sustituye** `BatchFilesList` en el layout.

## Criterios de aceptación

- Se pueden añadir 3 fuentes y cambiar entre ellas; el player carga cada una y el proyecto se conserva.
- Guardar, cerrar y abrir el `.vmx` restaura las fuentes.
- No se crean ficheros `*-proj.llc`.
- `yarn tsc && yarn lint && yarn test run` en verde.
- Las notas de ejecución incluyen **instrucciones de prueba manual** para el usuario.

## Notas de ejecución

### Ficheros

| Fichero | Cambio |
|---|---|
| `src/renderer/src/videomix/workspace.ts` (+ `workspace.test.ts`, 10 tests) | Nuevo, puro: flag `videoMixMode`, `classifyOpenedPaths` (vmx / audio / media / no soportado, por extensión), `getSourceMeta` (tamaño orientado + duración desde el ffprobe de `loadMedia`), `isSourceMetaChanged`, `createMusic`, `getMixProjectTitle`, `countClipsBySource`. |
| `src/renderer/src/videomix/hooks/useMixWorkspace.ts` | Nuevo: pegamento entre `useMixProject` y el player de un solo fichero. Fuente activa, activar/añadir/quitar/localizar fuentes, flujos del menú Proyecto (envueltos en `withErrorHandling`), música, recuperación al arrancar. |
| `src/renderer/src/videomix/components/SourceList.tsx` | Nuevo: panel izquierdo de fuentes. |
| `src/renderer/src/videomix/hooks/useMixProject.ts` (T04) | + `setSourceMeta(sourceId, meta)`: refresca la cache informativa **sin** paso de undo ni `dirty` (mismo mecanismo que `setLoudnessCache`: `applyToAll` + `savedProject`). Reutiliza la acción `relinkSource` del reducer; no hay acción nueva. |
| `src/renderer/src/videomix/dialogs.ts` (T04) | + `askForRecoverProject` (Restaurar / Descartar / Más tarde). |
| `src/renderer/src/App.tsx` | Ver "Puntos de cambio". |
| `src/renderer/src/util.ts` | `setDocumentTitle` acepta `projectTitle` opcional. |
| `src/common/types.ts` | `KeyboardAction`: `newProject`, `openProject`, `saveProject`, `saveProjectAs`, `addSourcesDialog`. |
| `src/main/configStore.ts` | Atajos por defecto: `Ctrl/Cmd+S` guardar, `Ctrl/Cmd+Shift+S` guardar como. |
| `src/main/menu.ts` | Menú **Project** (entre File y Edit): New project, Open project..., Save project, Save project as..., Add videos... |
| `src/renderer/src/components/KeyboardShortcuts.tsx` | Nombres de las 5 acciones nuevas (categoría "Project"); el tipo `ActionsMap` lo exige. |
| `locales/en`, `locales/es` | `scan-i18n` + español de **todos** los textos VideoMix pendientes (94 claves: T04, T05 y los de T14 que ya estaban en el árbol). |

### Puntos de cambio en `App.tsx` (todos comentados con el porqué)

1. Imports (4 líneas).
2. `const mixProject = useMixProject()` justo después de `useErrorHandling`: su estado es propio del hook, así que `resetState()` no lo toca.
3. Título: `getMixProjectTitle(...)` → `setDocumentTitle({ ..., projectTitle })`. Formato: `[progreso - trabajo -] Proyecto* - fuente.mp4 - VideoMix x.y`.
4. `useSegmentsAutoSave({ autoSaveProjectFile: autoSaveProjectFile && !videoMixMode, ... })` → no se crean `*-proj.llc`.
5. `loadMedia`: el bloque que carga el `.llc` / busca el proyecto / importa capítulos queda dentro de `if (!videoMixMode)`.
6. Tras `loadMedia`: `closeMedia` (`resetState` + `clearSegments`) y `const mixWorkspace = useMixWorkspace({...})`.
7. `userOpenFiles`: tras las comprobaciones de fichero regular, `if (videoMixMode) { await mixWorkspace.openFiles(paths); return; }` (no se pregunta la acción de apertura). Cubre Ctrl+O, soltar sobre el vídeo, soltar sobre el panel, `openFiles` de main (CLI / asociación de ficheros) y la API HTTP.
8. `mainActions`: 5 acciones nuevas (menú e IPC van por `allActions` automáticamente).
9. `setAskBeforeClose`: `(askBeforeClose && isFileOpened) || mixProject.dirty`.
10. `handleSourcesDrop` y, en el layout, `<SourceList>` si `videoMixMode`; `BatchFilesList` solo si `!videoMixMode` (el código batch sigue compilando; lo borra T16).
11. `RectOverlayDemo` (T06) sin tocar.

### Comportamiento

- **Fuente activa** (`currentSourceId`): se **deriva** de `filePath` (`sources.find(s => s.path === filePath)`) en vez de ser un `useState` aparte. Así no puede desincronizarse del player si `loadMedia` aborta con un toast (fichero ilegible, etc.) o si se cierra el fichero (Ctrl+W).
- **Activar** una fuente: comprueba que existe (`mainApi.pathExists`) y hace `loadMedia({ filePath })` con `setWorking` (como `batchOpenSingleFile`; `loadMedia` no limpia `working`). Si falta, se marca como no encontrada y hay toast.
- **Metadatos** (ancho/alto orientados, duración): al activar una fuente se toman del ffprobe de `loadMedia` y se guardan con `setSourceMeta` (cache: no ensucia ni crea paso de undo; se escribe en el siguiente guardado).
- **Añadir** (botón +, menú Project → Add videos..., Ctrl+O, soltar): los vídeos se añaden como fuentes (ignorando duplicados). Solo se carga en el player el primero nuevo **si no hay ninguna fuente activa**: hasta T07 cambiar de fuente pierde los segmentos del timeline. Abrir/soltar un único fichero que ya es fuente lo activa.
- **Audio** (mp3, m4a, aac, wav, flac, ogg, opus…): diálogo de confirmación "¿Usar como música del proyecto?" (o "¿Sustituir…?" si ya hay). Conserva volumen/loop de la música anterior; por defecto 0 dB y sin loop.
- **`.vmx`**: abre el proyecto (con "¿guardar cambios?" si hay). Si vienen más ficheros junto al `.vmx`, se ignoran.
- **No soportados** (`.llc`, `.csv`, `.srt`, `.xml`, `.edl`, …): toast de error; no se añaden.
- **Quitar**: confirmación solo si la fuente tiene clips (quita también sus clips). Si es la activa, se descarga del player.
- **Fuente no encontrada**: icono de aviso, "Fichero no encontrado" y enlace "Localizar..." (también al pulsar la fila). `relinkSource` con la nueva ruta y nombre, y se activa. Rechaza un fichero que ya es otra fuente.
- **Nuevo / Abrir / Restaurar**: se descarga el fichero del player y, tras abrir, se avisa de las fuentes que faltan, se ofrece localizar la música si falta y se activa la primera fuente encontrada.
- **Guardar**: toast "Proyecto guardado"; el `*` desaparece del título.
- **Cierre**: con cambios sin guardar, main muestra su diálogo existente ("¿Seguro que quieres salir?").
- **Recuperación al arrancar** (una vez; ref de guarda contra el doble efecto de StrictMode):
  - Se **purgan** los ficheros con `newerThanProjectFile === false` (el `.vmx` se guardó después: no hay nada que recuperar).
  - Para cada uno de los demás (del más reciente al más antiguo): Restaurar (se carga y se deja de preguntar; el resto se ofrecerá en el próximo arranque), Descartar (se borra y se pasa al siguiente) o Más tarde (se conservan todos y se deja de preguntar).

### Atajos

- `ControlLeft+KeyS` / `MetaLeft+KeyS` → `saveProject`; `ControlLeft+ShiftLeft+KeyS` / `MetaLeft+ShiftLeft+KeyS` → `saveProjectAs`. Comprobado: ningún atajo por defecto ni acelerador de menú usa `KeyS` (los aceleradores existentes son Ctrl+O, Ctrl+W y Ctrl+,).
- New / Open / Add videos sin atajo por defecto (Ctrl+O ya es "Open", que en VideoMix también añade fuentes o abre un `.vmx`). Se pueden asignar en el diálogo de atajos (categoría "Project").
- Los items del menú Project **no** llevan `accelerator`: el atajo lo gestiona el renderer (como undo/redo) y un acelerador podría disparar la acción dos veces (en macOS `registerAccelerator: false` no existe). Por eso el menú no muestra el atajo.
- **Ojo**: `keyBindings` se guarda completo en `config.json`; si ya existía una configuración de VideoMix, los atajos nuevos no aparecen hasta restablecer los atajos (o borrar `config.json`). No he añadido migración porque volvería a añadirlos aunque el usuario los quite a propósito.

### Decisiones y dudas para el orquestador

- **Contexto**: no se ha creado `MixProjectContext`. Envolver el árbol con un provider obliga a reindentar ~400 líneas de JSX en `App.tsx`; `SourceList` recibe props. Si T07/T14 lo necesitan, se puede añadir con ese coste (o pasar `mixProject` por props).
- **Undo/redo**: siguen apuntando a los segmentos (T07 los redirige al proyecto). Por ahora, añadir/quitar fuentes no se deshace con Ctrl+Z.
- **Timeline**: al activar una fuente se ve el comportamiento heredado (segmento inicial de toda la duración, el "placeholder"); T07 cargará los clips.
- **Salir sin guardar**: si se confirma el diálogo de salida, el fichero de recuperación queda en disco y en el siguiente arranque se ofrece restaurarlo. Es lo más seguro (el renderer no sabe qué eligió el usuario en el diálogo de main), pero puede resultar insistente. Alternativa: diálogo propio de 3 botones en el renderer que borre la recuperación al descartar. ¿Preferencia?
- **Arranque con un `.vmx` por CLI/asociación y a la vez un fichero de recuperación**: los dos diálogos pueden solaparse (caso raro; no tratado).
- **Detección de audio por extensión** (no por ffprobe): un `.mka`/`.ogg` con vídeo se ofrecería como música. Aceptable por ahora.
- `.llc`/EDL/SRT soltados se rechazan (antes importaban segmentos). Si se quiere mantener la importación de EDL hacia clips, sería otra tarea.

### Validación

- `tsc`: sin errores en mis ficheros. Errores **ajenos** (en curso): `script/videomix/spike/renderSpike.ts(644)` (T09, `'g'` sin usar) y `src/renderer/src/videomix/planner/dbg.test.ts` / `planMix.test.ts` (T10, variables sin usar; varía según el momento).
- `lint`: sin errores en mis ficheros. Errores **ajenos**: `script/videomix/spike/renderSpike.ts` (T09) y `src/renderer/src/videomix/planner/*` (T10: `formatPlan.ts`, `planMix.ts`, `validatePlan.ts`, `dbg.test.ts`, `validatePlan.test.ts`).
- `test run`: 21 ficheros, 244 tests en verde (10 nuevos en `workspace.test.ts`).
- `build`: OK.
- No se ha podido ejecutar la app (sin pantalla): la integración está razonada, no probada. Ver prueba manual.

### Prueba manual (usuario)

Requisitos: `yarn generate-test-media` (T02) y `yarn dev`. Si ya tenías una configuración de VideoMix, restablece los atajos (diálogo de atajos → restablecer) para tener Ctrl+S.

1. **Arranque**: panel izquierdo "Fuentes" vacío con el texto "Suelta vídeos aquí…". Título: `Proyecto sin título - VideoMix x.y`. Menú nuevo **Proyecto** entre Archivo y Editar.
2. **Añadir 3 fuentes**: arrastra `test-media/h-1080p-10s.mp4`, `v-1080x1920-12s.mp4` y `sq-1080-6s.mp4` a la vez sobre el panel (o botón +, o Proyecto → Añadir vídeos...). No debe salir el diálogo "¿qué hacer con el fichero?". Aparecen 3 filas numeradas; se carga la primera en el player (fila resaltada con borde cian). Título: `Proyecto sin título* - h-1080p-10s.mp4 - …`.
3. **Duración**: tras activar una fuente, su fila muestra la duración (p. ej. `0:10`) y "0 clips".
4. **Cambiar de fuente**: pulsa cada fila: el player carga cada vídeo y el resaltado cambia; las 3 filas siguen ahí (el proyecto se conserva). Pulsar la activa no hace nada.
5. **Duplicados**: vuelve a soltar `h-1080p-10s.mp4`: no se duplica y pasa a ser la activa.
6. **Música**: suelta `test-media/music-20s.m4a`: diálogo "Música del proyecto" → Usar como música. Suelta `music-60s.mp3`: pregunta si sustituir. (Se verá en el diálogo de ajustes de T14; por ahora, en el `.vmx` guardado, `settings.music`.)
7. **No soportado**: suelta un `.llc` o `.csv` cualquiera: toast "Estos ficheros no se pueden usar como fuentes".
8. **Guardar**: Ctrl+S (o Proyecto → Guardar proyecto) → diálogo Guardar como, propone `project.vmx` junto a la primera fuente. Guarda como `test-media/prueba.vmx`: toast "Proyecto guardado", el título pasa a `prueba - …` sin `*`. Comprueba que **no** hay ficheros `*-proj.llc` en `test-media/`.
9. **Cerrar con cambios**: quita una fuente (✕; sin clips no pide confirmación) → título con `*`. Cierra la ventana: debe preguntar "¿Seguro que quieres salir?". Responde No, vuelve a añadir la fuente y guarda (Ctrl+S); ahora cerrar no pregunta.
10. **Reabrir**: cierra la app (sin cambios no pregunta). `yarn dev` otra vez → Proyecto → Abrir proyecto... → `prueba.vmx`: se restauran las fuentes y se activa la primera. También vale soltar el `.vmx` o abrirlo con Ctrl+O.
11. **Fuente que falta**: con la app cerrada, renombra `test-media/sq-1080-6s.mp4` a `sq-renamed.mp4`. Abre `prueba.vmx`: toast "No se han encontrado 1 fichero(s)…" y la fila con ⚠ "Fichero no encontrado · Localizar...". Pulsa Localizar... y elige `sq-renamed.mp4`: la fila recupera el nombre nuevo, se activa y el título muestra `*`. Guarda y vuelve a renombrarlo como estaba al final.
12. **Música que falta**: igual con la música: al abrir, pregunta si localizarla.
13. **Recuperación**: añade una fuente (título con `*`), espera 2 s y mata el proceso (Ctrl+C en la terminal de `yarn dev`). Vuelve a arrancar: diálogo "¿Restaurar el proyecto sin guardar?" con nombre, nº de fuentes/clips y fecha. Restaurar → aparece el proyecto con `*` y se activa la primera fuente. Repite y elige Descartar → no vuelve a preguntar. Con "Más tarde" vuelve a preguntar en el siguiente arranque.
14. **Nuevo proyecto**: Proyecto → Nuevo proyecto con cambios → "Cambios sin guardar" (Guardar / Descartar / Cancelar). Descartar: lista vacía y player descargado.
15. **Idioma**: con el idioma en español, los textos del panel, menú y diálogos salen en español.

## Revisión

- **Resultado**: aceptada. `lint` y `tsc` limpios en los ficheros de T05 (los únicos errores son de T09/T10, en curso); tests en verde.
- **Decisiones del orquestador sobre las dudas**:
  - Se mantiene el fichero de recuperación tras "Salir sin guardar". Es la opción segura: el aviso al arrancar se puede descartar.
  - Sin migración de atajos: el proyecto aún no tiene usuarios con configuración previa.
  - Undo/redo del proyecto: en T07.
  - El solape de diálogos al abrir un `.vmx` por CLI con recuperación pendiente se acepta por ahora; se revisará en T16.
  - La detección de audio por extensión se acepta.
