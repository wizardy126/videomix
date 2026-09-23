# T25 · v2: encoders por hardware y H.265 (D2)

- **Hito**: M8 · **Modelo**: Sonnet · **Depende de**: T24 · **Estado**: hecha

## Alcance

1. **Detección en main** (`src/main/videomix/encoders.ts`):
   - `ffmpeg -hide_banner -encoders` y una prueba real corta (1 s de `testsrc`, 256×144) por cada encoder candidato: `h264_nvenc`, `hevc_nvenc`, `h264_qsv`, `hevc_qsv`, `h264_videotoolbox`, `hevc_videotoolbox`, `h264_vaapi`, `hevc_vaapi`;
   - resultado cacheado durante la sesión.
2. **Mapeo de argumentos por encoder**: calidad equivalente a CRF (`-cq` / `-global_quality` / `-q:v` / `-qp`), preset y `pix_fmt`. VAAPI necesita `hwupload` y `format=nv12`. `libx265` con `-tag:v hvc1` y `+faststart`.
3. **`buildRenderJob` / `useMixRender`**: con `hardware: auto` se usa el primer encoder válido del códec elegido y, si no hay ninguno, `libx264` / `libx265`. Si un bloque falla con el encoder por hardware, se reintenta el job con el de software y se avisa.
4. **UI**: sección Salida de `MixSettingsDialog`, con selector de códec y encoder (mostrando cuáles están disponibles).
5. **Tests**: mapeo de argumentos (snapshots), parseo de `-encoders` y test con ffmpeg real de `libx265` (se omite si falta).
6. **i18n**: español.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

### Resumen de cambios

- **`src/common/videomix/encoder.ts`** (T24, ampliado): `hardwareEncoderCandidates` (los 8 `{ id, codec, hardware }` del spec), `getEncoderName` (nombre `-c:v`: candidato o `libx264`/`libx265`) y `resolveEncoderHardware({ encoder, available })` (puro, sin ffmpeg): `auto` prueba `AUTO_HARDWARE_PRIORITY` (nvenc, qsv, videotoolbox, vaapi) y cae a `'none'` si ninguno está disponible; una elección concreta no disponible (proyecto de otra máquina) también cae a software en vez de fallar. Usado tanto por main (detección) como por el renderer (resolución antes de renderizar y UI de disponibilidad).
- **Detección en main**:
  - `src/main/videomix/encodersParse.ts` (puro, sin Electron, con tests): parsea `ffmpeg -hide_banner -encoders` (`parseEncoderNames`) y filtra los candidatos de `common/videomix/encoder.ts` que aparecen compilados (`getCompiledHardwareCandidates`).
  - `src/main/videomix/encoders.ts`: `detectEncoders()` — `-encoders` más una prueba real corta (1 s de `testsrc2` 256×144) por cada candidato compilado; VAAPI añade `-vaapi_device /dev/dri/renderD128` y `-vf format=nv12,hwupload` (necesita subir el fotograma a una superficie de hardware antes de poder codificarlo). Resultado cacheado en un módulo-nivel `Promise` durante la sesión (un fallo no se cachea, para no atascar la detección si ffmpeg falla por una razón transitoria). No se testea directamente (como `loudness.ts`: importar `../ffmpeg.js` en vitest fuera de Electron falla), solo a través de `encodersParse.test.ts` (la parte pura) y del render real de libx265.
  - Expuesto en `src/main/index.ts`, `remoteApiLegacy.videomix.detectEncoders` (mismo patrón que `measureLoudness`, T21).
- **Mapeo de argumentos**: `src/renderer/src/videomix/render/encoderArgs.ts` (puro, con snapshots): `getVideoEncodeArgs({ codec, hardware, fps, crf, preset })` → `{ globalArgs, outputArgs }`. Software (sin cambios respecto a antes de T25): `-preset -crf -pix_fmt yuv420p -r`. Hardware: `-cq` (NVENC, con `-rc vbr -b:v 0` y preset `fast/medium/slow`), `-global_quality` (QSV, mismo preset), `-q:v` (VideoToolbox, escala 0–51 invertida a 1–100, sin preset de velocidad) y `-qp` (VAAPI, con el `hwupload`/`format=nv12` y el `-vaapi_device` en `globalArgs`). H.265 añade siempre `-tag:v hvc1` (compatibilidad Apple/QuickTime), también en los encoders de hardware, no solo en libx265 como decía literalmente el punto 2 del alcance.
- **`buildRenderJob`**: nuevo parámetro opcional `resolvedEncoder?: ResolvedEncoder` (`{ codec, hardware }`, sin `auto`). Sin él (scripts de desarrollo, tests, y cualquier llamada anterior a T25), usa software con el códec del proyecto — así ningún snapshot existente cambia. `useMixRender` es el único que lo resuelve de verdad (con `detectEncoders` + `resolveEncoderHardware`) y lo pasa. Los argumentos del encoder (`globalArgs`) se insertan justo después de `-hide_banner -nostdin -y`, antes de las entradas del bloque.
- **`useMixRender`**: antes de construir el `RenderJob`, `detectEncoders()` (cacheado en main) + `resolveEncoderHardware`. Si el render con el encoder resuelto falla (no es una cancelación), se avisa (`showHardwareEncoderFallbackWarning`, sweetalert) y se reintenta una vez con software (`hardware: 'none'`), reconstruyendo el `RenderJob` en el mismo `workDir` (que `runRenderJob` ya limpia siempre en su `finally`, también tras un fallo). Si el que falla ya era software, el error se relanza sin reintento.
- **UI**: `MixSettingsDialog`, sección Output — selectores de códec y de encoder (con "(detected)"/"(not detected)" en las opciones de hardware para el códec elegido, deshabilitadas si no están disponibles; "Auto" y "Software only" siempre habilitadas). La disponibilidad viene de `hooks/useEncoderAvailability.ts` (llama a `detectEncoders` una vez al montar el diálogo).
- **`src/renderer/src/videomix/encoders.ts`**: wrapper de `detectEncoders` vía `@electron/remote` (mismo patrón que `loudness.ts`).
- **Tests**:
  - `common/videomix/encoder.test.ts`: `getEncoderName` y `resolveEncoderHardware` (auto, específico disponible/no disponible, `none`).
  - `main/videomix/encodersParse.test.ts`: parseo de una salida de `-encoders` realista (con y sin candidatos).
  - `render/encoderArgs.test.ts`: snapshots de los 4 mapeos de hardware más software (h264/h265).
  - `render/encoderArgs.ffmpeg.test.ts`: render real de un plan pequeño con **libx265** (única prueba real posible aquí: sin GPU no hay NVENC/QSV/VideoToolbox/VAAPI que probar) — comprueba con ffprobe `codec_name: hevc`, `codec_tag_string: hvc1`, resolución y fotogramas exactos. Se omite si falta ffmpeg o los medios de T02, como el resto de `*.ffmpeg.test.ts`.
  - `render/buildRenderJob.test.ts` (ya existente): sigue en verde sin cambios, confirmando que el valor por defecto de `resolvedEncoder` reproduce exactamente los argumentos de antes de T25.
- **i18n**: `scan-i18n` ejecutado; claves nuevas traducidas al español.

### Decisiones y limitaciones

- **Sin GPU en este entorno**: los 8 candidatos de hardware (NVENC, QSV, VideoToolbox, VAAPI × H.264/H.265) no se han podido probar con ffmpeg real. La lógica de detección (`encodersParse.ts`) está probada con salidas de `-encoders` simuladas; el mapeo de argumentos por encoder (`encoderArgs.ts`) tiene snapshots pero sus valores concretos (nombres de preset de NVENC/QSV, escala de VideoToolbox, ruta fija del dispositivo VAAPI `/dev/dri/renderD128`) son los habituales en la documentación de ffmpeg, no verificados aquí con hardware real. Si al revisar en una máquina con GPU algún valor no funciona (p. ej. otra ruta de dispositivo VAAPI, u otro nombre de preset), es un ajuste localizado en `encoderArgs.ts` (render) y/o `encoders.ts` (main, la prueba de detección), sin tocar el resto del diseño.
- **Reintento con software**: se implementa a nivel de `useMixRender` (reconstruye el `RenderJob` entero con `hardware: 'none'` y vuelve a llamar a `runRenderJob`), no dentro de `runRenderJob`/`buildRenderJob`, que siguen siendo puros/deterministas. Solo se reintenta si el primer intento usaba hardware; una cancelación del usuario nunca dispara el reintento.
- **`+faststart`**: ya estaba en el paso de `concat` de `buildRenderJob` (T11) para todos los códecs, así que no hizo falta añadirlo; se confirma que sigue aplicándose también a H.265/hardware.
- **Etiqueta `hvc1`**: el punto 2 del alcance solo la menciona para `libx265`, pero se aplica a cualquier encoder H.265 (también hardware), porque el problema de compatibilidad con Apple/QuickTime que resuelve es el mismo independientemente del encoder.
- **Duda de requisitos**: no hay ninguna decisión de diseño que afecte a otras tareas más allá de lo ya fijado en T24 (`MixEncoderSettings`); no se ha necesitado registrar ningún ADR nuevo.

## Revisión

- **Resultado**: aceptada. x265 verificado con ffmpeg real. Los encoders por hardware se han probado con simulaciones (no hay GPU); falta validarlos en un equipo con GPU.
