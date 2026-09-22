# T04 · Store del proyecto y persistencia

- **Hito**: M1 · **Modelo**: Opus · **Depende de**: T03 · **Estado**: hecha

## Objetivo

Crear el hook que mantiene el proyecto VideoMix en memoria, con undo/redo, y su persistencia en `.vmx`, incluido el autoguardado de recuperación.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §7
- [04-diseno](../04-diseno.md) §1, §6.2
- [02-as-built](../02-as-built.md) §4, §5 (`useStateWithHistory` en `useSegments`, `edlStore.ts` para la E/S con JSON5 y los diálogos de remote)
- [03-convenciones](../03-convenciones.md)

## Alcance

1. **`src/renderer/src/videomix/projectReducer.ts`** (puro): acciones tipadas sobre `MixProject`, testeables.
   - Fuentes: `addSources`, `removeSource` (que elimina también sus clips, con aviso gestionado en la UI), `relinkSource`.
   - Clips: `addClip`, `updateClip`, `removeClip`, `duplicateClip`, `reorderClips(ids)`.
   - Ajustes: `updateSettings`.
   - `setLoudnessCache`.
2. **`src/renderer/src/videomix/hooks/useMixProject.ts`**:
   - Estado: proyecto, `projectPath`, `dirty`, `undo`, `redo`, `canUndo` y `canRedo` (historial acotado, p. ej. 100).
   - Las ediciones continuas, como arrastrar un rectángulo, deben poder agruparse en un solo paso de historial. Para ello, el hook expone un `commit` o un modo *transient*; el diseño se documenta aquí.
3. **`src/renderer/src/videomix/projectFile.ts`**:
   - `saveMixProject(path, project)`: JSON5 con indentación. Convierte las rutas de las fuentes y de la música a relativas respecto al `.vmx` y mantiene `absolutePath`.
   - `loadMixProject(path)`: resuelve las rutas (relativa → absoluta) e informa de las fuentes que faltan.
   - La lógica de rutas va separada en funciones puras con tests (usar `node:path` vía `window.require` solo en el borde, como hace `edlStore.ts`, o pasar el módulo `path` como parámetro para poder testear).
4. **Recuperación**:
   - Autoguardado con debounce (1–2 s) del proyecto no guardado o sucio en `<userData>/videomix-recovery/`, un fichero por sesión o proyecto.
   - Al guardar explícitamente se limpia.
   - `findRecoverableProjects()` para que T05 ofrezca recuperar al arrancar.
   - Para obtener `userData`, reutiliza un mecanismo existente o añade una función mínima en main (`remoteApi`).
5. **Acciones de usuario** (sin UI todavía; las enganchará T05): `userNewProject`, `userOpenProject`, `userSaveProject` y `userSaveProjectAs`, con los diálogos de remote (patrón `edlStore.ts`, filtro `*.vmx`) y confirmación si hay cambios sin guardar.

## Fuera de alcance

- Montar el hook en `App.tsx`, los paneles y los menús (T05).

## Criterios de aceptación

- Tests del reducer, de la conversión de rutas y del *round-trip* guardar → cargar (sin disco o con `tmpdir`).
- El undo/redo y la agrupación de ediciones continuas están documentados.
- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

### Resumen

Ficheros nuevos (todos en `src/renderer/src/videomix/`):

| Fichero | Contenido |
|---|---|
| `projectReducer.ts` (+ test) | `mixProjectReducer(project, action)` puro y `createMixSource`. |
| `projectHistory.ts` (+ test) | Historial genérico undo/redo con ediciones *transient*. Puro. |
| `projectFile.ts` (+ test) | Conversión de rutas, (de)serialización JSON5, `saveMixProject` / `loadMixProject`. |
| `projectRecovery.ts` (tests en `projectFile.test.ts`) | Ficheros de recuperación: escribir, borrar, buscar y resolver. |
| `dialogs.ts` | `askForUnsavedChanges()` → `'save' \| 'discard' \| 'cancel'` (Swal con botón *deny*). |
| `hooks/useMixProject.ts` | El hook: estado, historial, acciones, E/S con diálogos y autoguardado de recuperación. |

No se ha tocado `src/main`: `userData` se obtiene con `remote.app.getPath('userData')` (`@electron/remote`, ya usado en `index.tsx`).

### API

**Reducer** (`MixProjectAction`): `addSources` (ignora ficheros o ids ya presentes), `removeSource` (borra también sus clips), `relinkSource` (`path`, `absolutePath` y opcionalmente `name`/`width`/`height`/`duration`), `addClip` (con `index` opcional), `updateClip` (`patch` sin `id`/`sourceId`; `minRect: undefined` elimina la clave), `removeClip`, `duplicateClip` (copia profunda justo detrás; `newId` y `name` los da el llamador), `reorderClips(ids)` (los ids no listados quedan al final en su orden; desconocidos o repetidos se ignoran), `updateSettings` (`music: undefined` elimina la música), `setLoudnessCache`.
- Los ids los genera el llamador (nanoid en el hook), así el reducer es determinista.
- Una acción que no cambia nada (comparación con `isEqual` del parche) devuelve **el mismo objeto**; el historial no crea un paso vacío.

**Hook** `useMixProject()` (sin parámetros) devuelve:
- Estado: `project`, `projectPath`, `dirty`, `canUndo`, `canRedo`.
- Historial: `undo`, `redo`, `commitTransient`, `cancelTransient`.
- Edición: `dispatch(action, { transient? })` y atajos `addSources(filePaths) → ids nuevos`, `removeSource`, `relinkSource`, `addClip(clip, index?)`, `updateClip(id, patch, { transient? })`, `removeClip`, `duplicateClip(id, name?) → newId`, `reorderClips(ids)`, `updateSettings(patch, { transient? })`, `setLoudnessCache(entries)` (fusiona entradas).
- Usuario: `userNewProject()`, `userOpenProject(filePath?)`, `userSaveProject()`, `userSaveProjectAs()`, `confirmDiscardChanges()`. Devuelven `false`/`undefined` si el usuario cancela. `userOpenProject` devuelve `{ project, missingSourceIds, missingMusic }` para que T05 pida localizar lo que falta (con `relinkSource` / `updateSettings`).
- Recuperación: `getRecoverableProjects()`, `userRecoverProject(entry)`, `discardRecoverableProject(entry)`.
- Tipo exportado: `UseMixProject`.

Las funciones `user*` **lanzan** en errores de E/S o de parseo; T05 las envuelve en `withErrorHandling`.

### Undo/redo y ediciones continuas

- Historial propio (`projectHistory.ts`) en lugar de `useStateWithHistory` de react-use, porque este no permite agrupar pasos. Límite: 100 pasos.
- Estado `{ past, present, future, transientBase? }`:
  - **Edición normal**: guarda `present` en `past` y vacía `future`.
  - **Edición transient** (`{ transient: true }`): solo sustituye `present` y recuerda en `transientBase` el estado previo al primer movimiento.
  - `commitTransient()` registra el gesto completo como **un solo paso** (`transientBase → present`); si se volvió al valor inicial, no crea paso.
  - `cancelTransient()` vuelve a `transientBase` (p. ej. con Escape).
  - Cualquier edición normal, `undo` o `redo` confirma antes un transient pendiente, así que no se pierde nada si el llamador olvida el commit.
- Uso previsto (T06): `updateClip(id, { maxRect }, { transient: true })` en cada `pointermove` y `commitTransient()` en `pointerup`.
- `dirty` = `project !== savedProject` (comparación por referencia): deshacer hasta el estado guardado lo deja limpio.
- `setLoudnessCache` **no** crea paso ni marca el proyecto como sucio: se aplica a todas las instantáneas del historial (y a la guardada) con una función memoizada por referencia, para que el undo no pierda la cache y la comparación de `dirty` siga funcionando. Se guarda en el `.vmx` con el siguiente guardado.

### Rutas y fichero `.vmx`

- **En memoria**, `path` de fuentes y música es la ruta absoluta en uso y `absolutePath` la de respaldo (iguales salvo si el fichero falta).
- **Al guardar** (`toSavedMixProject`), `path` pasa a relativa al directorio del `.vmx` con separador `/` (para mover proyectos entre sistemas); si no se puede (otra unidad en Windows), queda absoluta. `absolutePath` se mantiene. JSON5 con indentación 2.
- **Al cargar** (`resolveMixProjectPaths`), se prueba la relativa resuelta y después `absolutePath`. Si existe, ambas rutas pasan a ser la encontrada. Si falta, `path` queda con la relativa resuelta, `absolutePath` con la guardada y el id se devuelve en `missingSourceIds` (o `missingMusic`).
- El módulo `path` y `fs/promises` se inyectan (`NodeDeps`) para testear con vitest en Node; el hook usa `window.require` solo en el borde.

### Recuperación

- Un fichero por **sesión** (id nanoid del hook): `<userData>/videomix-recovery/<sessionId>.vmx-recovery`.
  - Es un envoltorio JSON5 `{ version: 1, projectPath?, savedAt, project }` con el proyecto en memoria (rutas absolutas). Por eso **no** usa la extensión `.vmx` que sugería 04-diseno §6.2: no es un `.vmx` válido.
- **Autoguardado** con debounce de 1,5 s mientras el proyecto está sucio y las ediciones se han asentado; cuando vuelve a estar limpio (guardar o deshacer hasta lo guardado), se borra. Nuevo o abrir también lo borran. Las operaciones se encolan para que una escritura lenta no llegue después de un borrado.
- `getRecoverableProjects()` lista los ficheros de otras sesiones, del más reciente al más antiguo, con `newerThanProjectFile` (falso si el `.vmx` se guardó después; T05 puede ignorarlos o borrarlos). Los ficheros corruptos se ignoran con un `console.warn`.
- `userRecoverProject(entry)` resuelve las rutas, carga el proyecto asociándolo a su `projectPath`, lo deja **sucio** (hay que guardarlo) y traspasa el fichero de recuperación a la sesión actual (escribe el suyo antes de borrar el antiguo).

### Decisiones y desviaciones

- `saveMixProject` / `loadMixProject` reciben `deps` como primer parámetro (`saveMixProject(deps, path, project)`), en vez de la firma `(path, project)` del task-doc, para poder testear sin Electron.
- El diálogo "¿guardar cambios?" es de tres botones: Guardar / Descartar / Cancelar. Si se elige Guardar y se cancela el diálogo de "Guardar como", se aborta la acción.
- Guardar como: si el diálogo devuelve una ruta sin `.vmx`, se añade. Ruta por defecto: la del proyecto o `project.vmx` en la carpeta de la primera fuente.
- `addSources` usa `basename` como nombre y descarta rutas repetidas.

### Pendiente / dudas

- **i18n**: textos nuevos (`Unsaved changes`, `The project has unsaved changes. Do you want to save them?`, `VideoMix project`, `Save project`, `Open project`). No he ejecutado `yarn scan-i18n` ni añadido el español para no pisar a los agentes en paralelo (T06 también añade textos). Hay que hacerlo al integrar.
- **Cerrar la ventana con cambios sin guardar**: el as-built tiene `setAskBeforeClose`; enlazarlo con `dirty` corresponde a T05.
- Los ficheros de recuperación con `newerThanProjectFile: false` o de sesiones antiguas no se purgan automáticamente; T05 decide (p. ej., borrarlos al arrancar).
- `lint` falla solo en ficheros de T06 (`components/RectOverlayToolbar.tsx`: `no-shadow`; `overlayMath.test.ts`: `unicorn/no-lonely-if`), en curso. `tsc` y `test run` (200 tests) en verde.

## Revisión

- **Resultado**: aceptada. `tsc`, `lint` (ficheros de T04) y tests en verde.
- **Desviaciones aceptadas**:
  - dependencias `path`/`fs` inyectadas en las funciones de E/S;
  - extensión `.vmx-recovery` para los ficheros de recuperación.
- **Tareas para T05**:
  - enlazar `dirty` con `setAskBeforeClose`;
  - purgar las recuperaciones antiguas al arrancar;
  - hacer `scan-i18n` y la traducción al español de los textos nuevos. Esto último se hará en T05 o en T17.
