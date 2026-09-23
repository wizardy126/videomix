# T24 · v2: modelo v3 y migración

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: — · **Estado**: hecha

## Objetivo

Hacer todos los cambios de modelo de las mejoras v2 en una sola versión del `.vmx`, para que el resto de tareas de M8 puedan ir en paralelo.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §10
- [04-diseno](../04-diseno.md) §9
- Notas de T19 (patrón de la migración v1 → v2)

## Alcance

1. **`MixProject` versión 3** con migración v2 → v3 (y v1 → v3 encadenada). Campos:
   - `settings.output = { aspect: '16:9' | '9:16' | '1:1', resolution: '720' | '1080' | '2160' }`, donde la resolución es el lado corto.
     - Tabla de tamaños exactos (1280×720, 720×1280, 720×720…).
     - Helper `getOutputSize(output)`.
     - Se migra desde `resolution`.
   - `settings.encoder = { codec: 'h264' | 'h265', hardware: 'auto' | 'none' | 'nvenc' | 'qsv' | 'videotoolbox' | 'vaapi' }`. Por defecto `h264` / `auto`.
   - `settings.musicPlaylist = { tracks: { id, path, absolutePath, volumeDb }[], crossfade: 2, loop: boolean, ducking: { enabled: false, amountDb: -10 } }`.
     - Se migra desde `settings.music`: una pista, y `loop` se conserva.
     - La cache de sonoridad de la música pasa a clave por pista.
   - Overlay **`text`**:
     - `text` (multilínea), `box`, `align`, `color`, `font?`, `border`, `shadow?`, `lineSpacing`, `fadeIn`, `fadeOut`;
     - `entry: { kind: 'none' | 'slide' | 'typewriter', from?: 'left' | 'right' | 'top' | 'bottom', duration }`;
     - anclaje y duración como el resto.
   - `MixClip.pinTime?: number` (inicio fijado en el vídeo final) y `MixClip.groupId?: string`.
2. **Reducer y hook**: acciones para lo nuevo (pistas: añadir, quitar, reordenar y editar; `pinTime`; grupos: agrupar y desagrupar).
3. **`projectFile`**: rutas relativas y absolutas y ficheros que faltan para las pistas de música.
4. **Validación**: `pinTime` dentro del rango, grupos con al menos 2 clips, textos vacíos, etc.
5. **Tipos de presets (B2)**: `OverlayStylePreset` (texto, contador y barra, solo propiedades de estilo) en `src/common/videomix/` para que main los guarde. **No** se implementa el almacenamiento, que es de T26.
6. **Compatibilidad**: el código existente debe seguir compilando y funcionando con valores por defecto (render 16:9, H.264 x264 y una sola pista con el comportamiento actual). Allí donde se usaba `settings.music` o `resolution`, adáptalo de forma mínima.
7. **Tests**: migraciones (v1 → v3 y v2 → v3), reducer y validación.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde. Proyectos v1 y v2 se abren sin pérdida.

## Notas de ejecución

### Resumen de cambios

- `src/common/videomix/encoder.ts` (nuevo): `mixEncoderSchema`, `MixEncoderSettings`, `defaultMixEncoder` (`h264` / `auto`). En common porque la detección de encoders de T25 va en main.
- `src/common/videomix/overlayStyles.ts` (nuevo): esquemas de **estilo** de texto, contador y barra, y `OverlayStylePreset` (B2) con `overlayStyleKeys`. También se movieron aquí `OVERLAY_COLOR_REGEX`, `overlayFileSchema` y `progressBarDirections` (`types.ts` los reexporta, así que los imports existentes no cambian). Los esquemas de los overlays del renderer se construyen con `...xxxOverlayStyleSchema.shape`, de modo que preset y overlay no pueden divergir.
- `videomix/types.ts`: `MixProject` **v3** (`mixProjectSchema`, `MIX_PROJECT_VERSION = 3`); se eliminan `mixProjectV1Schema`/`V2Schema` (nadie los usaba fuera; las versiones viejas solo se leen a través de las migraciones sobre el JSON). `mixOutputSchema`, `mixOutputSizes`, `getOutputSize`, `mixMusicTrackSchema`, `mixMusicPlaylistSchema`, `defaultMusicPlaylist`, `textOverlaySchema`, y `pinTime`/`groupId` en `mixClipSchema`. Desaparecen `mixResolutions`, `MixResolution` y `MixMusic`.
- `videomix/project.ts`: migración `2 → 3` (encadenada con `1 → 2`), `MIGRATED_MUSIC_TRACK_ID`, y validación nueva (ver abajo). `MixProjectIssue` gana `trackId` y `groupId`.
- `videomix/projectReducer.ts`: acciones nuevas (ver abajo) y `dissolveSingleClipGroups`.
- `videomix/projectFile.ts`: rutas relativas/absolutas de las pistas y de la fuente de los textos; `LoadedMixProject.missingMusic: boolean` pasa a `missingMusicTrackIds: string[]`.
- `hooks/useMixProject.ts`: `setClipPinTime`, `groupClips` (devuelve el id del grupo), `ungroupClips`, `addMusicTracks(filePaths, index?)` (devuelve ids), `updateMusicTrack`, `removeMusicTrack`, `reorderMusicTracks`, `updateMusicPlaylist`, `relinkMusicTrack`.
- `hooks/useMixWorkspace.ts`: "Usar como música" sustituye la lista por una sola pista (`replaceMusic`) y "Localizar" pregunta por cada pista que falte (una con el comportamiento de antes).
- `workspace.ts`: `createMusic` → `createMusicTrack` y `replaceMusic(playlist, { id, filePath, loopIfNew })`.
- `loudness.ts`: `ensureLoudness({ music })` → `ensureLoudness({ musicTracks })`; cada medida vuelve bajo el id de su pista. Se elimina `MUSIC_LOUDNESS_KEY`.
- `render/buildAudioGraph.ts`: lee `settings.musicPlaylist` y usa **solo la primera pista** (con `musicPlaylist.loop` y la medida `loudness[track.id]`); el grafo es idéntico al de antes (no cambia ningún snapshot). T27 lo sustituye por la lista completa.
- `planner/plannerInput.ts`, `render/renderOutput.ts`, `hooks/useMixOverlays.ts`: `getOutputSize(settings.output)` en vez de `mixResolutions[settings.resolution]`.
- `hooks/useMixRender.ts`: comprueba y mide todas las pistas; la fuente incluida también cuenta para los textos.
- `components/MixSettingsDialog.tsx` (mínimo): el selector de resolución cambia `output.resolution` (etiquetas generadas con `getOutputSize`, iguales a las de antes en 16:9); la sección Música edita la primera pista y `musicPlaylist.loop`. "Quitar música" deja `tracks: []`.
- Texto (hasta T26): `render/overlayFilters.ts` lo ignora (`// todo` para T26); `MixPlanView` lo muestra aproximado en la mini vista (color propio en los carriles, que van en "Contadores y barras" por `getOverlayLane`); `overlayTexts` tiene su etiqueta; `overlays/factories.ts` añade `createTextOverlay` y `getTextOverlayFontSize`.
- `renderDialogs.getIssueText`: textos traducidos para los códigos nuevos (es).
- Scripts: `script/videomix/audioDemo.ts` y `renderOverlaysExample.ts` adaptados (probados con ffmpeg real: mismos niveles que antes).
- Docs: `04-diseno` §1.2, §5.1/§5.2 (música por pista), §8.1 y §9.

### Modelo final (v3)

```ts
// src/common/videomix/encoder.ts
MixEncoderSettings = { codec: 'h264' | 'h265', hardware: 'auto' | 'none' | 'nvenc' | 'qsv' | 'videotoolbox' | 'vaapi' }  // h264 / auto

// videomix/types.ts
MixOutput = { aspect: '16:9' | '9:16' | '1:1', resolution: '720' | '1080' | '2160' }   // lado corto; 16:9 / 1080
getOutputSize(output) → { width, height }   // tabla mixOutputSizes: 16:9 1280×720…3840×2160, 9:16 720×1280…2160×3840, 1:1 720²…2160²
MixMusicTrack = { id: string, path: string, absolutePath: string, volumeDb: number }
MixMusicPlaylist = {
  tracks: MixMusicTrack[],                          // orden de reproducción; [] = sin música
  crossfade: number,                                // ≥ 0 s; 2
  loop: boolean,                                    // true
  ducking: { enabled: boolean, amountDb: number },  // false / −10
}
MixSettings = { output, encoder, fps, crf, preset, maxColumns, gap, reorderWindow, order, transition, fadeInOut, fill, musicPlaylist }
MixClip += { pinTime?: number, groupId?: string /* min 1 */ }
TextOverlay = OverlayBase & {
  type: 'text', text: string /* '\n' separa líneas */, duration: number, box: OverlayBox,
  align: 'left' | 'center' | 'right', color: string, font?: OverlayFile,
  border: { width ≥ 0, color }, shadow?: { x, y, color },
  lineSpacing: number /* ≥ 0, fracción del tamaño de letra */, fadeIn ≥ 0, fadeOut ≥ 0,
  entry: { kind: 'none' | 'slide' | 'typewriter', from?: 'left' | 'right' | 'top' | 'bottom', duration ≥ 0 },
}
MixOverlay = ImageOverlay | CountdownOverlay | ProgressBarOverlay | SoundOverlay | TextOverlay
MixProject = { version: 3, sources, clips, settings, loudnessCache?, overlays }

// src/common/videomix/overlayStyles.ts
TextOverlayStyle      = { align, color, font?, border, shadow?, lineSpacing, fadeIn, fadeOut, entry }
CountdownOverlayStyle = { align, decimals, leadingZeros, color, font?, border, shadow?, fadeOut }
ProgressBarOverlayStyle = { fillColor, backgroundColor, border, direction, mode }
OverlayStylePreset =
  | { id, name, type: 'text', style: TextOverlayStyle }
  | { id, name, type: 'countdown', style: CountdownOverlayStyle }
  | { id, name, type: 'progressBar', style: ProgressBarOverlayStyle }
overlayStyleKeys: { text: [...], countdown: [...], progressBar: [...] }   // para elegir el estilo de un overlay
```

### Migraciones

- **v2 → v3**, sobre el JSON y antes del esquema:
  - `settings.resolution: 'NNNNp'` → `settings.output = { aspect: '16:9', resolution: 'NNNN' }`. Una resolución desconocida se pasa tal cual, para que el esquema la siga rechazando; si falta, se toma la de por defecto.
  - `settings.music` → `musicPlaylist = { ...defaultMusicPlaylist, tracks: [{ id: 'music', path, absolutePath, volumeDb }], loop: music.loop }`. Sin música, la lista por defecto (`tracks: []`).
  - `encoder` sale de los valores por defecto (el relleno de ajustes que faltan ya existía).
  - Los campos nuevos de clips y el overlay de texto son aditivos.
- **v1 → v3**: `1 → 2` (`overlays: []`) y después `2 → 3`.
- Se guarda siempre en v3. Un proyecto v3 abierto por una versión anterior de la app da "newer than supported", como antes.

### Reducer

- `setClipPinTime { clipId, pinTime | undefined }` (`undefined` quita la clave). `updateClip` también acepta `pinTime`/`groupId` y elimina las claves puestas a `undefined`.
- `groupClips { clipIds, groupId }`: necesita al menos 2 clips existentes (si no, no hace nada). Los clips salen de sus grupos anteriores.
- `ungroupClips { clipIds }`.
- Tras agrupar, desagrupar, `removeClip` o `removeSource`, los grupos que se quedan con un solo clip se **disuelven** (`dissolveSingleClipGroups`). `updateClip` no disuelve, para no romper secuencias dentro de un `batch`; para eso está el aviso `group-too-small`.
- `duplicateClip`: la copia **no** hereda `pinTime` ni `groupId`, porque empezaría a la vez que el original.
- `addMusicTracks { tracks, index? }` (lanza si hay un id repetido), `updateMusicTrack { trackId, patch }`, `removeMusicTrack { trackId }`, `reorderMusicTracks { ids }` (misma semántica que `reorderClips`, con un helper `reorderById` compartido) y `updateMusicPlaylist { patch }` (crossfade, loop, ducking).
- `updateSettings` ya no quita `music` (no quedan ajustes opcionales).
- Todas devuelven el mismo objeto si no cambian nada y funcionan dentro de `batch`.

### Validación (`validateMixProject`)

- Errores:
  - `pin-time-out-of-range`: `pinTime` < 0 o no finito;
  - `overlay-invalid-entry`: `slide` sin `from`;
  - `duplicate-music-track-id`.
- Avisos:
  - `pin-time-after-end`: `pinTime` > duración total de los demás clips, así que habría un hueco antes;
  - `group-too-small`: un grupo con un solo clip, que T30 debe tratar como no agrupado;
  - `group-pin-conflict`: clips de un grupo fijados en momentos distintos;
  - `overlay-empty-text`: texto vacío o solo espacios;
  - `overlay-entry-too-long`: la animación de entrada dura más que el texto.
- Los textos entran también en las comprobaciones de caja, duración, *fades* (`fadeIn + fadeOut`) y colores.
- El esquema **no** limita `pinTime` ni `ducking.amountDb`: igual que las cajas de T19, un valor malo no debe impedir abrir el proyecto.

### Compatibilidad comprobada

- Proyectos v1 y v2 (con y sin música) se abren sin pérdida: tests de `project.test.ts` y `projectFile.test.ts`, incluida la lectura de ficheros reales en disco.
- Render 16:9, x264 y una sola pista: **ningún snapshot cambia**, porque el grafo de audio y el de vídeo son idénticos. `audioDemo --music` y `renderOverlaysExample` dan los mismos niveles con ffmpeg real.
- Validación: `tsc`, `lint`, `test run` (567 tests) y `build` en verde. `scan-i18n` ejecutado y traducciones añadidas en `es`.

### Decisiones y dudas

- **Tamaño de letra del texto**: el spec no incluye `fontSize`, así que sale de la caja. Las `n` líneas y sus `n − 1` separaciones (`lineSpacing` × tamaño) llenan `box.height`, y con una línea el tamaño es `box.height`, como en el contador (`getTextOverlayFontSize`). Consecuencia: añadir una línea reduce la letra si no se agranda la caja; la UI de T26 puede hacer crecer la caja al añadir líneas. Si el usuario prefiere un tamaño fijo, T26 puede añadir `fontSize` de forma aditiva.
- **`loop` por defecto `true`**: la música nueva elegida en el diálogo ya se repetía; "Usar como música" desde un fichero abierto conserva su `false` de antes (`replaceMusic(..., loopIfNew)`), así que no cambia nada visible.
- **Id de la pista migrada**: `'music'`, fijo, para que la migración sea pura y determinista. Solo tiene que ser único dentro de la lista.
- **Presets**: se excluyen la caja (posición y tamaño), los tiempos, el anclaje, el texto y `linkedCountdownId`. Se incluyen los *fades* y la animación de entrada, que son parte del aspecto. Si el usuario quiere que un preset guarde también la posición, T26 puede añadir un `box?` opcional.
- **Codificador**: `hardware: 'auto'` es el valor por defecto, pero hasta T25 el render usa siempre libx264 (el campo no se lee aún).
- Proyectos con más de una pista antes de T27 (solo posibles editando a mano): el diálogo y el render usan la primera. El render comprueba y mide todas.

### Para las tareas siguientes

- **T25**: leer `settings.encoder` en `buildRenderJob`/`useMixRender`; tipos en `src/common/videomix/encoder.ts`.
- **T26**: render del texto en `overlayFilters.ts` (sustituir el `// todo`); panel y botón "Add text" con `createTextOverlay`; presets con `overlayStylePresetSchema` y `overlayStyleKeys`.
- **T27**: sustituir el uso de la primera pista en `buildAudioGraph` y la sección Música del diálogo; las acciones del reducer, los *wrappers* del hook y `missingMusicTrackIds` ya están.
- **T29**: `getOutputSize(settings.output)` ya se usa en planificador, render y mini vista; falta la UI de proporción, `PREVIEW_SIZE` (hoy 640×360 fijo) y el eje del planificador.
- **T30**: `pinTime`/`groupId`, sus acciones y avisos ya están; el planificador todavía los ignora.

## Revisión

- **Resultado**: aceptada. `tsc`, `lint`, tests (567) y `build` en verde; ningún snapshot cambió.
- **Decisiones del orquestador**:
  - **Tamaño del texto**: T26 añade un campo explícito `fontSize` (fracción de la altura del fotograma, aditivo). La caja crece con las líneas, de modo que añadir una línea no encoge el texto.
  - Los presets no guardan la caja.
  - `loop` es `true` por defecto.
