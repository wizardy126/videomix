# T24 · v2: modelo v3 y migración

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: — · **Estado**: pendiente

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

## Revisión
