# T25 · v2: encoders por hardware y H.265 (D2)

- **Hito**: M8 · **Modelo**: Sonnet · **Depende de**: T24 · **Estado**: pendiente

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

## Revisión
