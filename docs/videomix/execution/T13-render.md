# T13 · Orquestación del render y la previsualización

- **Hito**: M4 · **Modelo**: Opus · **Depende de**: T07, T11, T12 · **Estado**: pendiente

## Objetivo

Conectar proyecto → plan → análisis de audio → render en la app, con progreso, cancelación, previsualización a baja resolución y diálogo de fin.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.6, §6
- [04-diseno](../04-diseno.md) §6.6
- ADR-001 y el código de T10, T11 y T12
- [02-as-built](../02-as-built.md) §3 (`runFfmpegWithProgress`, `abortFfmpegs`, `appendFfmpegCommandLog`), §9 (`setWorking`, `setProgress`, `withErrorHandling`, `open*FinishedDialog`)

## Alcance

1. **`videomix/hooks/useMixRender.ts`**:
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
   - `userPreviewMix()`: igual pero a 640×360, preset `ultrafast`, CRF alto y en un directorio temporal. Muestra el resultado en un diálogo con un `<video>` y botón de cerrar.
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

## Revisión
