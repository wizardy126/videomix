# T13 · Orquestación del render y la previsualización

- **Hito**: M4 · **Modelo**: Opus · **Depende de**: T07, T11, T12 · **Estado**: hecha

## Objetivo

Conectar proyecto → plan → análisis de audio → render en la app, con progreso, cancelación, previsualización a baja resolución y diálogo de fin.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.6, §6
- [04-diseno](../04-diseno.md) §6.6
- ADR-001 y el código de T10, T11 y T12
- [02-as-built](../02-as-built.md) §3 (`runFfmpegWithProgress`, `abortFfmpegs`, `appendFfmpegCommandLog`), §9 (`setWorking`, `setProgress`, `withErrorHandling`, `open*FinishedDialog`)

## Alcance

1. **`videomix/hooks/useMixRender.ts`**:
   - **APIs disponibles**: `ensureLoudness` (`videomix/loudness.ts`), `planMix` + `getPlannerInput` (`planner/`), `buildRenderJob` con el hook `buildAudioGraph: (input) => buildAudioGraph({ ...input, clips: project.clips, loudness })` y `getChunkConcurrency` (`render/`). Ver 04-diseno §4.2 y §5.
   - `userRenderMix()`:
     - valida el proyecto y muestra los problemas;
     - diálogo "Guardar como" del MP4 (nombre por defecto basado en el proyecto);
     - pide confirmación si el fichero existe (respetando `enableOverwriteOutput`);
     - `ensureLoudness` con progreso;
     - `planMix`;
     - `buildRenderJob`;
     - ejecuta los bloques con progreso global ponderado por duración, cancelable, y concat final;
     - limpia los temporales (también si se cancela o falla);
     - registra los comandos en "Last commands";
     - muestra el diálogo de fin con "Mostrar en carpeta".
   - `userPreviewMix()`: igual pero a 640×360 (el plan se calcula a esa resolución, con la separación escalada y par, como hace `script/videomix/renderPlan.ts`), preset `ultrafast`, CRF alto y en un directorio temporal. Muestra el resultado en un diálogo con un `<video>` y botón de cerrar.
   - Los avisos del plan (upscale > ×2, relleno) se muestran antes de renderizar, con opción de continuar.
2. Si la ejecución por bloques necesita funciones nuevas en main (p. ej. un directorio temporal o concat con lista), añádelas en `src/main/videomix/`.
3. **Montar `MixSettingsDialog`** (T14, ver sus notas): menú Project → "Mix settings…" y botón en la UI.
4. **Menú Project**: Preview y Render, y botones en la UI (BottomBar o TopMenu, sustituyendo al botón Export de LosslessCut en el layout VideoMix).

## Fuera de alcance

- El diálogo de ajustes (T14) y el timeline del plan (T15).

## Criterios de aceptación

- Con un proyecto de los medios de T02 (≥ 8 clips de ≥ 4 fuentes, con música), la preview y el render final funcionan y la cancelación deja todo limpio.
- La lógica pura (ponderación del progreso, nombres de ficheros) tiene tests.
- `yarn tsc && yarn lint && yarn test run` en verde.
- Instrucciones de prueba manual en las notas.

## Notas de ejecución

### Resumen

- **Lógica pura** (`videomix/render/`, sin React ni Electron, con tests):
  - `renderOutput.ts`:
    - rutas: salida por defecto (`<proyecto>.mp4` junto al `.vmx`; sin guardar, junto a la primera fuente o en la carpeta Vídeos; en la sesión se recuerda la última), extensión `.mp4` si falta (el diálogo de Linux no la añade), nombre parcial `<nombre>.<id>.part.mp4` en la misma carpeta (renombrado atómico), directorio de trabajo `videomix-render|preview-<id>` y fichero de previsualización en el temporal del sistema;
    - `planRender(project, { preview })`: plan a la resolución de salida o, en la previsualización, a 640×360 con la separación escalada desde la altura de salida y par (`scaleGap`), fps a la mitad si es 50/60 (`getPreviewFps`) y `ultrafast` / CRF 30 (`PREVIEW_ENCODING`);
    - `getRenderWarnings`: avisos del plan que se confirman (upscale > ×2, pillarbox/letterbox y el primer `fill` de fila), con el nombre del clip.
  - `renderProgress.ts`: progreso global por fotogramas (ADR-001). La razón `time/duración` que da `runFfmpegWithProgress` se convierte en fotogramas enteros del bloque; audio y `concat` pesan un 1 % cada uno. Cada paso solo avanza (ffmpeg a veces retrocede el `time=` al empezar).
  - `runRenderJob.ts`: ejecutor del `RenderJob` con dependencias inyectadas (fs, `runFfmpeg`, `abortAll`):
    1. crea el directorio de trabajo y escribe `files`;
    2. ejecuta la pasada de audio (primero: es corta y sus errores salen antes) y los bloques con la concurrencia de `getChunkConcurrency`;
    3. `concat` al nombre parcial y `rename` al final;
    4. siempre borra el directorio de trabajo; si falla o se cancela, también el parcial.
    - Cancelar (`abortSignal`) deja de lanzar pasos, mata los procesos en curso (`abortFfmpegs`), los espera y lanza `RenderAbortedError` (`name = 'AbortError'`, que `withErrorHandling` ignora).
    - Si falla un paso, no se lanzan más y se espera a los que están en marcha sin matarlos: la app solo puede matar todos los ffmpeg a la vez, incluido el del reproductor compat.
    - `onCommand` registra cada comando en "Last commands" (`appendFfmpegCommandLog`).
- **`hooks/useMixRender.ts`**: `userRenderMix` y `userPreviewMix`.
  1. Comprueba que hay clips; `validateMixProject` → los errores y los ficheros que faltan (fuentes usadas y música, con `pathExists`) se muestran en un diálogo y se para.
  2. `planRender`; los avisos de validación (clip corto, separación impar) y del plan se muestran con "Renderizar de todos modos" / "Cancelar".
  3. Render: diálogo "Guardar como" (filtro MP4, `showOverwriteConfirmation` para que Linux también pregunte si existe). Si existe y `enableOverwriteOutput` está desactivado, se rechaza con `showRefuseToOverwrite`.
  4. `ensureLoudness` (con la música, API de T12b) con progreso y cancelable; las medidas nuevas se guardan en el proyecto con `setLoudnessCache`.
  5. `buildRenderJob` con el hook de audio `(input) => buildAudioGraph({ ...input, clips: project.clips, loudness })` y `runRenderJob` con `setWorking`/`setProgress` (el botón de abortar del diálogo Working cancela).
  6. Render: diálogo de fin con "Mostrar" (`openExportFinishedDialog`). Previsualización: diálogo con `<video>` (`components/MixPreviewDialog.tsx`, URL con `pathToFileURL`); el fichero se borra al cerrar el diálogo (con 0,5 s de margen por Windows) o al empezar otra previsualización.
- **Textos y diálogos**: `videomix/renderDialogs.tsx` (textos traducidos de los códigos de `validateMixProject` y de los avisos del plan; diálogos sweetalert con lista).
- **UI**:
  - `components/MixRenderButtons.tsx`: "Ajustes", "Vista previa" y "Renderizar" (deshabilitados sin clips) en la `BottomBar`, que recibe la prop nueva `exportButtons` y la muestra en lugar de los controles de export de LosslessCut (que siguen fuera de `videoMixMode`).
  - `MixSettingsDialog` (T14) montado en `App.tsx` con `onChange={mixProject.updateSettings}`.
  - Menú Project: "Mix settings...", "Preview mix" y "Render mix...".
  - `KeyboardAction` nuevas `showMixSettings`, `previewMix` y `renderMix` (también en `KeyboardShortcuts`). Atajos por defecto: Ctrl/Cmd+E (render), Ctrl/Cmd+P (preview) y Ctrl/Cmd+Shift+M (ajustes); ninguno estaba en uso (Cmd+M solo es minimizar en macOS). En modo VideoMix la acción `export` (tecla E) renderiza.
- **`App.tsx`** (cambios mínimos y comentados): imports, `useMixRender` + estado `mixSettingsOpen` tras `useMixClips`, 3 acciones y `export` en `mainActions`, la prop `exportButtons` de `BottomBar` y el montaje de `MixSettingsDialog`.
- **i18n**: `scan-i18n` ejecutado; 35 claves nuevas con su traducción al español.
- `04-diseno` §4.2: actualizado el punto "Ejecución".

### Decisiones

- **Progreso sin `-progress`**: `runFfmpegWithProgress` ya parsea `time=` de stderr; como cada bloque dura `frames/fps`, `razón × frames` son los fotogramas escritos. No hizo falta ninguna función nueva en main.
- **Directorio temporal y CPU** desde el renderer: `app.getPath('temp')` (remote) y `navigator.hardwareConcurrency`, porque `window.require('node:os')` no está tipado en `index.tsx`.
- **Sobrescritura**: el diálogo nativo ya pide confirmación (en Linux con `showOverwriteConfirmation`), así que no se pregunta dos veces. Con `enableOverwriteOutput` desactivado se rechaza como en LosslessCut. Además, el render escribe siempre a un nombre parcial: un fichero existente solo se sustituye si el render termina bien.
- **Orden del flujo**: el plan y sus avisos se calculan antes del diálogo "Guardar como", para no elegir fichero y luego cancelar por un aviso. La sonoridad se analiza después (es lo lento, y se cachea).
- **Previsualización**: también analiza la sonoridad, para que el audio se oiga como en el render final (el render posterior aprovecha la cache). Sus fps se reducen a la mitad a 50/60 fps (el doble de rápido); el plan no cambia porque es en segundos.
- **Avisos**: además del upscale y el relleno de fila se incluyen pillarbox/letterbox (también es relleno) y los avisos de `validateMixProject`. Se omite `transition-shortened`, redundante con el aviso de clip corto.

### Tests

- `renderOutput.test.ts`: nombres y rutas (POSIX y Windows), separación escalada y par, fps de la previsualización, `planRender` (640×360, separación exacta entre columnas, misma duración que el final) y avisos.
- `renderProgress.test.ts`: ponderación por fotogramas, fotogramas enteros, monotonía, valores inválidos.
- `runRenderJob.test.ts` (fs y ffmpeg falsos): orden (audio primero, concat al final), concurrencia máxima, `rename`, limpieza, fallo de un bloque, cancelación (mata y lanza `AbortError`) y previsualización sin `rename`.
- `runRenderJob.ffmpeg.test.ts` (ffmpeg real, se omite sin ffmpeg o sin los medios de T02): render completo con varios bloques en paralelo (solo queda la salida, progreso monótono hasta 1) y cancelación a mitad (no queda nada en el directorio).
- Además, con un script local (no incluido), la cadena `planRender` → `buildRenderJob` + `buildAudioGraph` (con música en bucle) → `runRenderJob` sobre 8 clips de 5 fuentes de T02 da 570 fotogramas exactos, 19 s y audio, tanto en la previsualización (640×360, separación 4, 4,6 s) como en el final a 720p (5,8 s).
- `yarn tsc`, `yarn lint`, `yarn test run` (395 tests) y `yarn build` en verde.

### Prueba manual (la app no se puede lanzar aquí)

Preparación: `yarn generate-test-media` (si no existen los medios de `test-media/`) y `yarn dev`.

1. **Proyecto**: "Add videos..." con al menos 4 fuentes de `test-media/` (`h-1080p-10s.mp4`, `h-720p-25fps-8s.mp4`, `v-1080x1920-12s.mp4`, `sq-1080-6s.mp4`, `v-720x1280-silent-7s.mp4`). Crea ≥ 8 clips (tecla N o "Add clip") de 3–5 s repartidos entre ellas. En uno de los horizontales pon un rectángulo máx. pequeño (p. ej. 300×170 px) para provocar un aviso de upscale.
2. **Ajustes**: botón "Settings" de la barra inferior (o Project → Mix settings..., o Ctrl+Shift+M). Pon separación 8 px, transición `fade` 0,5 s, música `test-media/music-20s.m4a` con bucle. Cierra.
3. **Sin clips**: en un proyecto nuevo, "Preview"/"Render" están deshabilitados; con la tecla E o Ctrl+E sale el aviso "The project has no clips yet…".
4. **Previsualización**: botón "Preview" (o Project → Preview mix, o Ctrl+P).
   - Primero sale la lista de avisos (upscale del clip pequeño, rellenos si los hay): "Cancel" no hace nada; "Preview anyway" continúa.
   - Diálogo Working con "Analyzing audio loudness" y progreso (solo la primera vez; la segunda va directa porque se cachea) y luego "Rendering preview" con progreso creciente.
   - Se abre "Mix preview" con el vídeo a 640×360 reproduciéndose con sonido: columnas, separación fina, transiciones y música.
   - Comprueba en el directorio temporal (`/tmp` en Linux, `%TEMP%` en Windows) que durante el render existe `videomix-preview-<id>/` con `chunk-*.mp4`, grafos y `audio.m4a`, y que al terminar solo queda `videomix-preview-<id>.mp4`; al cerrar el diálogo desaparece.
5. **Render**: botón "Render" (o Project → Render mix..., Ctrl+E o E).
   - Avisos → "Render anyway" → "Guardar como" con `<nombre del proyecto>.mp4` junto al `.vmx` (o junto a la primera fuente si no está guardado).
   - Progreso global que avanza sin saltos atrás; durante el render, en la carpeta de salida existe `<nombre>.<id>.part.mp4` solo durante el `concat` final.
   - Al terminar, diálogo "Success!" con la ruta; "Show" abre la carpeta. El MP4 se reproduce en un reproductor externo: 1080p (o la resolución elegida), fps del proyecto, audio equilibrado con la música de fondo, fundido de entrada y salida.
   - "Last ffmpeg commands" (menú) lista la pasada de audio, cada bloque y el `concat`.
6. **Cancelación**: repite el render y pulsa abortar en el diálogo Working a mitad (también durante "Analyzing audio loudness" con un proyecto nuevo sin cache). No debe salir diálogo de error; no debe quedar ni el `.part.mp4` en la carpeta de salida ni `videomix-render-<id>` en el temporal, ni procesos `ffmpeg` vivos. Si ya existía un MP4 con ese nombre, sigue intacto.
7. **Sobrescritura**: renderiza otra vez al mismo fichero: el diálogo del sistema pide confirmación y, al aceptar, se sustituye al terminar. Con `enableOverwriteOutput: false` (solo se cambia en el diálogo de export de LosslessCut, oculto en VideoMix, o en `config.json` de `userData`), sale "Output file already exists, refusing to overwrite…".
8. **Fichero que falta**: renombra una fuente usada (o la música) fuera de la app y pulsa Render: sale "The mix can't be rendered" con "File not found: …".
9. **Atajos**: en Settings → Keyboard shortcuts, categoría Project, aparecen "Mix settings", "Preview mix" y "Render mix" con sus atajos.
10. **Proyecto guardado**: guarda, cierra y vuelve a abrir el `.vmx`; la previsualización ya no vuelve a analizar la sonoridad (`loudnessCache`).

### Dudas y limitaciones

1. **`abortFfmpegs` mata todos los ffmpeg** de la app (también el del reproductor compat) al cancelar. Es lo que ya hace el botón de abortar de LosslessCut; para matar solo los del render habría que exponer desde main una ejecución con `cancelSignal` por proceso.
2. Si la app se cierra durante un render o con la previsualización abierta, los temporales quedan en el directorio temporal del sistema (con prefijo `videomix-`).
3. El ajuste `enableOverwriteOutput` (por defecto activado) solo se puede cambiar desde el diálogo de export de LosslessCut, que no aparece en VideoMix. ¿Se añade a los ajustes de VideoMix (T16) o se ignora en el render?
4. El diálogo de fin se muestra siempre, aunque esté activado "Hide all notifications" (el render lo inicia el usuario y dura minutos).

## Revisión

- **Resultado**: aceptada. `tsc`, `lint`, tests (395) y `build` en verde. Cadena completa verificada con ffmpeg real. Falta la prueba manual de la UI.
- **Decisiones del orquestador**:
  - En VideoMix, el render ignora `enableOverwriteOutput`: la confirmación de sobrescritura la da el diálogo nativo de guardar. Se implementa en T16.
  - Los temporales `videomix-*` huérfanos se limpian al arrancar (T16).
  - El diálogo de fin se muestra aunque las notificaciones estén ocultas; se acepta.
