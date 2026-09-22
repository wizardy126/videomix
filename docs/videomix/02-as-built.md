# 02 · As-built: cómo está construido el proyecto base

Base: **LosslessCut 3.69.0** (commit `20f2e34`), sin cambios propios al inicio del fork.

Stack:
- Electron 42, React 19 y TypeScript estricto (`@tsconfig/strictest`).
- electron-vite, Yarn 4 (`nodeLinker: node-modules`) y vitest 4.
- ffmpeg/ffprobe externos, ejecutados con execa.

## 1. Estructura de carpetas

```
src/
  main/        Proceso principal de Electron (Node). ffmpeg, config, menú, servidor HTTP, CLI.
  preload/     Preload: expone window.electron (proxy RPC tipado sobre ipcRenderer.invoke).
  common/      Código compartido main/renderer: tipos (Config, KeyboardAction), ffprobe, i18n, utilidades.
  renderer/
    errors.ts  Errores personalizados (UserFacingError, UnsupportedFileError, …).
    src/       Aplicación React.
      App.tsx          Componente raíz (~2900 líneas): casi todo el estado de la app.
      components/      Componentes reutilizables (Dialog, Button, Select, Switch, …).
      hooks/           Hooks de dominio (useSegments, useFfmpegOperations, useVideo, …).
      dialogs/         Diálogos imperativos (sweetalert2) y helpers.
      util/            Utilidades puras (streams, duración, plantillas de nombre).
      worker/          Evaluación sandbox de expresiones de usuario.
      test/            Fixtures y utilidades de tests.
locales/<lng>/translation.json   Traducciones (38 idiomas; clave = frase en inglés).
script/                          Scripts de build, docs, iconos, licencias, e2e.
docs/                            Documentación de usuario de LosslessCut (+ docs/videomix).
```

## 2. Procesos y comunicación

- **Main** (`src/main/index.ts`):
  - Llama a `remote.initialize()` y crea una sola `BrowserWindow` con `contextIsolation: false` y `nodeIntegration: true`.
  - En desarrollo carga `http://localhost:3001` y en producción `out/renderer/index.html`.
  - Orden de `init()`: `configStore.init`, lock de instancia única, handlers IPC, `--settings-json`, `--http-api` opcional, `createWindow()`, idioma/menú y comprobación de actualizaciones.
- **El renderer habla con main de dos formas:**
  1. **`@electron/remote` (legado, el más usado).** Se usa como `window.require('@electron/remote').require('./index.js')` y expone `remoteApiLegacy` (index.ts ~468): `ffmpeg`, `i18n`, `compatPlayer`, `configStore`, flags de plataforma, `isDev`, `lossyMode`, `pathToFileURL`, etc.
     - Ejemplo: `src/renderer/src/ffmpeg.ts:19` reexporta las funciones de `src/main/ffmpeg.ts`.
     - El renderer también usa `dialog`, `Menu` y `app` vía remote, y `window.require('node:fs/promises' | 'node:path' | 'electron')` directamente.
  2. **RPC tipado nuevo.** `remoteApi` (index.ts ~448) se expone por `ipcMain.handle('__electron_rpc__')`. El preload lo publica como `window.electron` y el renderer lo usa vía `src/renderer/src/mainApi.ts`. El tipo es `RemoteRpcApi = Asyncify<RemoteApi>`.
- **Canales IPC:**
  - Renderer → main: `appEvent`, `renderer-ready`, `setAskBeforeClose`, `setLanguage`, `apiActionResponse`, `tryTrashItem`, `showItemInFolder`.
  - Main → renderer: `openFiles`, `apiAction` y ~55 acciones de menú.
- **Menú** (`src/main/menu.ts`): cada item hace `mainWindow.webContents.send('<acción>')`. En el renderer, `App.tsx` (~2349) registra `ipcRenderer.on` para cada acción de `allActions` / `mainActions`.
- **Atajos de teclado**: `hooks/useKeyboard.ts` casa combinaciones de `KeyboardEvent.code` con `keyBindings` (config) y llama a `mainActions[action]`. El tipo `KeyboardAction` está en `src/common/types.ts`.
- **HTTP API / CLI**:
  - `--http-api` levanta Express en 127.0.0.1 (`src/main/httpServer.ts`) con `POST /api/action/:action` y `POST /api/await-event/:eventName`.
  - Las opciones de CLI se parsean con yargs en `index.ts`. Ver `docs/api.md` y `docs/cli.md`.

## 3. ffmpeg

- **`src/main/ffmpeg.ts`**:
  - Localiza los binarios así:
    - `customFfPath` (ajuste) si está definido;
    - `process.resourcesPath` en builds empaquetadas;
    - `ffmpeg/<platform>-<arch>/[lib/]` en desarrollo.
  - Ejecuta con **execa**. `runFfmpegProcess` registra cada proceso en `runningFfmpegs` y `abortFfmpegs()` los aborta todos.
  - Progreso: `handleProgress` lee stderr por líneas y `src/main/progress.ts` parsea `time=`.
  - Funciones exportadas:
    - `runFfmpegWithProgress({ffmpegArgs, duration, onProgress})`, `runFfmpegConcat`, `runFfprobe`.
    - `renderWaveformPng`, `detectSceneChanges`, `blackDetect`, `silenceDetect`.
    - `captureFrames`, `captureFrameToFile`, `captureFrameToClipboard`.
    - `createMediaSourceProcess` (reproductor compat), `downloadMediaUrl`, `runFfmpeg`.
  - Solo hay `-filter_complex` en tres sitios:
    - forma de onda (`showwavespic`);
    - reproductor compat (fps/scale/format + `amix`);
    - `extractWaveform` en el renderer.
- **`src/renderer/src/ffmpeg.ts`**: reexporta lo de main y añade helpers ffprobe (`readFileFfprobeMeta`, `readFrames`, keyframes, `renderThumbnails`, `runFfmpegStartupCheck`…).
- **Export** (`hooks/useFfmpegOperations.ts`): el renderer construye los argumentos de ffmpeg como `string[]` y los ejecuta en main vía remote.
  - `losslessCutSingle` / `cutMultiple` cortan con `-c copy` (y *smart cut* opcional).
  - `concatFiles` usa el concat demuxer.
  - **No existe export con filtros ni re-encode general**: VideoMix necesita un pipeline nuevo.
  - Cada comando se registra en "Last commands" (`appendFfmpegCommandLog`).

## 4. Estado del renderer (`App.tsx`)

- **Sin librería de estado global**: `useState` en `App.tsx` más tres contextos (`contexts.ts`: `AppContext`, `UserSettingsContext`, `SegColorsContext`). Lo demás baja por props.
- **Un único fichero abierto** (`filePath`):
  - `loadMedia({filePath, projectPath})` (~1408) hace ffprobe, comprueba permisos y html5ify, llama a `resetState()` y carga el proyecto `.llc`. `setFilePath` va al final a propósito, porque dispara el `<video src>`.
  - **Abrir otro fichero borra el estado actual**, incluido el historial de undo.
- **Batch**: `batchFiles` es solo una lista de rutas (`BatchFilesList`, panel izquierdo). Al seleccionar una se hace `loadMedia` y se reemplaza el fichero actual. No guarda estado por fichero.
- **Flujo de apertura**: `userOpenFiles` (~1831) decide entre abrir, proyecto, pistas, subtítulos o añadir al batch, y `userOpenSingleFile` gestiona el `.llc`.
- **Layout JSX** (~2523):
  - `Theme` (Radix) → `MotionConfig` → providers → `#app-root`.
  - `TopMenu` arriba.
  - Fila central: `BatchFilesList` | contenedor de vídeo (`videoContainerRef`) | `SegmentList`.
  - Abajo, `Timeline` y `BottomBar`.
  - Diálogos al final.
- **Acciones**: `mainActions: Record<KeyboardAction, () => void>` (~2046).

## 5. Segmentos

- **Tipos** (`src/renderer/src/types.ts`):
  - `SegmentBase {start, end?, name?}`.
  - `StateSegment` (+ `segId` de nanoid, `segColorIndex`, `tags`, `selected`, `initial?`).
  - Un segmento sin `end` es un **marcador**.
- **`hooks/useSegments.tsx`**:
  - `useStateWithHistory` de react-use (100 pasos) da el undo/redo.
  - `safeSetCutSegments` es el setter central: acota tiempos y convierte segmentos de longitud cero en marcadores.
  - API: add, split, remove, duplicate, reorder, invert, combine, select, label, tags, generadores (escenas, silencio, keyframes…) y `loadCutSegments`.
- **`segments.ts`**: helpers puros (`createSegment`, `sortSegments`, `invertSegments`…).
- **Proyecto `.llc`** (`edlStore.ts`, `hooks/useSegmentsAutoSave.ts`):
  - JSON5 con esquema zod v2: `{version: 2, mediaFileName?, cutSegments: [{start, end?, name, tags?, selected?}]}`.
  - Se autoguarda como `<nombre>-proj.llc` junto al vídeo, con debounce de 500 ms.
  - **Un proyecto por fichero de vídeo.**
- **Import/export EDL** (`edlFormats.ts`): CSV, CUE, XMEML, FCPXML, EDL, SRT, OTIO, etc.

## 6. Player

- Hay un solo `<video>` en `App.tsx` (~2571) con `style={{width:'100%', height:'100%', objectFit:'contain'}}` (`styles.ts`), dentro de un div absoluto que ocupa todo el contenedor central.
- **`hooks/useVideo.ts`**: `videoRef`, `seekAbs`/`seekRel`, `playbackRate`, `playing` y modos de reproducción (loop de segmento, etc.).
- **`MediaSourcePlayer.tsx`** (reproductor compat) se usa para códecs que Chromium no reproduce o para previsualizar la rotación. Transcodifica en tiempo real con ffmpeg (`createMediaSourceProcess`) a MP4 fragmentado sobre MediaSource y se superpone al `<video>` maestro, que va silenciado.
- **`hooks/useHtml5ify.tsx`**: convierte el fichero a un formato reproducible si hace falta.
- **Sin overlay de dibujo sobre el vídeo.** El único "crop" existente es de metadatos de bitstream (h264/hevc, `StreamsSelector.tsx` `CropEditor`), sin preview; no sirve para VideoMix.
- **Rotación**: estado `rotation` (metadato `-display_rotation`).

## 7. Timeline y listas

- **`Timeline.tsx`**:
  - Div con scroll horizontal cuyo ancho interior es `zoom × 100%`. Todo se posiciona con `left: t/duration %`.
  - Contiene forma de onda, miniaturas, segmentos (`TimelineSeg.tsx`), keyframes y cabezal (`motion.div`).
  - Con el ratón: clic para buscar; con modificador, arrastrar los límites del segmento actual.
- **`SegmentList.tsx`**: panel derecho, virtualizado con `@tanstack/react-virtual` y reordenable con **dnd-kit** (`DndContext` + `SortableContext` + `useSortable`, `restrictToVerticalAxis`). `BatchFilesList` usa el mismo patrón.

## 8. Ajustes de usuario

- **`src/main/configStore.ts`**: electron-store 5.1.1 con `defaults` (tipo `Config` en `src/common/types.ts`). Las migraciones son ad hoc dentro de `init()`. Fichero: `config.json` en `userData`.
- **Renderer**: `hooks/useUserSettingsRoot.ts` lee y escribe `configStore` vía remote, con un `useState` + `useEffect` por ajuste. Se expone por `UserSettingsContext` y `useUserSettings()`.
- **UI de ajustes**: `components/Settings.tsx`.

## 9. UI, estilos y diálogos

- **Radix**: `@radix-ui/themes` (`Theme accentColor="cyan"`) y primitivas envueltas en `components/` (`Dialog`, `AlertDialog`, `DropdownMenu`, `Checkbox`, `Switch`, `Select`).
- **Estilos**: mayoritariamente inline (`style={{…}}`, a menudo memoizados con `useMemo<CSSProperties>`). Colores con variables CSS de Radix (`var(--gray-12)`) y constantes de `colors.ts`. Algunos componentes usan CSS modules (`X.module.css`, acceso `styles['x']`).
- **Otras librerías**:
  - Iconos: `react-icons` (fa, md, ai, io).
  - Animación: `motion` (`motion/react`).
  - Utilidades: `lodash` importado por función, `p-map`, `nanoid`, `zod`, `tiny-invariant`, `use-debounce`, `react-use`, `immer`.
- **Diálogos, tres estilos**:
  1. sweetalert2 (`swal.ts`, `dialogs/index.tsx`) para prompts y toasts.
  2. `GenericDialog` (`showGenericDialog({ render })`) para diálogos que devuelven promesa.
  3. `Dialog.Root` de Radix controlado por estado (Settings, ExportConfirm, ConcatDialog).
- **Errores**:
  - `useErrorHandling`: `withErrorHandling(fn, título)` y `handleError({title, err})`, que abre `ErrorDialog`.
  - `UserFacingError` se muestra como toast.
  - Operaciones largas: `setWorking({ text, abortController })` y `setProgress`.

## 10. Build, tests y CI

- **Scripts (`package.json`)**:
  - `dev` (electron-vite dev), `build`, `tsc` (`tsc --build` sobre 4 proyectos: web, main, node y common), `lint` (eslint con `eslint-config-mifi`), `test` (vitest), `scan-i18n` y `generate-docs`.
  - `check` los ejecuta todos.
- **Tests**:
  - `*.test.ts` junto al código; solo funciones puras, sin mocks de Electron/React.
  - Snapshots en `__snapshots__/` y fixtures en `src/renderer/src/test/fixtures`.
- **CI**:
  - `test.yml` (push y PR; ubuntu y windows): install, dedupe, test, tsc, lint, build, generate-docs, licencias.
  - `build.yml`: releases, App Store y builds diarios. Se desactiva en VideoMix.
- **Empaquetado**: electron-builder (clave `build` de `package.json`). `appId no.mifi.losslesscut`, ffmpeg en `extraResources`, fuses de Electron y asociaciones de ficheros.

## 11. Implicaciones para VideoMix

| Necesidad | Base existente | Estrategia |
|---|---|---|
| Varias fuentes en un proyecto | Un solo `filePath` y `resetState()` al abrir | Un store de proyecto propio que sobreviva al cambio de fuente. `loadMedia` se reutiliza para cargar la fuente activa en el player. |
| Recorte temporal | `useSegments` + `Timeline` | Reutilizar la selección de tiempo. El clip es la fuente de verdad y se sincroniza con los segmentos de la fuente activa. |
| Rectángulos | Nada | Overlay nuevo sobre el `<video>` que tenga en cuenta `object-fit: contain` y la rotación. |
| Proyecto multi-fuente | `.llc` por fichero | Formato `.vmx` nuevo. Se desactiva el autosave `.llc` en modo VideoMix. |
| Montaje | Nada | Módulo puro (planificador + geometría) con tests. |
| Render con filtros | Solo `-c copy` | Generador de `filter_complex` + ejecución con progreso reutilizando `runFfmpegWithProgress` / `abortFfmpegs`. |
| Loudness | `silenceDetect` como patrón de parseo de stderr | Nueva función de main para `loudnorm print_format=json`. |
