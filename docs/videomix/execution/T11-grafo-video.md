# T11 · Generador del grafo de vídeo

- **Hito**: M3 · **Modelo**: Opus · **Depende de**: T09, T10 · **Estado**: pendiente

## Objetivo

Traducir un `MixPlan` a los argumentos de ffmpeg (entradas, `filter_complex`, mapeos y bloques) según la decisión del **ADR-001**.

## Contexto (leer antes de empezar)

- `docs/videomix/decisiones/ADR-001-render.md` (**especificación principal**)
- [04-diseno](../04-diseno.md) §2, §3.1, §4
- `geometry.ts` (T03) y `planner/` (T10)
- [03-convenciones](../03-convenciones.md) §9 (tests obligatorios)

## Alcance

1. **`src/renderer/src/videomix/render/buildVideoGraph.ts`** (puro):
   - recorte de cada clip según el ancho de su columna (`getCropForAspect`) y normalización a pares;
   - `fps` y escala;
   - `xfade` en las sustituciones con el tipo y la duración globales;
   - re-layout animado (o fallback, según el ADR);
   - relleno (desenfoque o color) y separación;
   - `fade` in/out global si `fadeInOut`.
2. **`render/buildRenderJob.ts`** (puro): compone el trabajo completo como una lista de bloques, cada uno `{ args: string[], duration, outPath }`, más el paso de concat, según el ADR. Parámetros de salida: resolución, fps, CRF, preset, `-pix_fmt yuv420p` y `-movflags +faststart`. En esta tarea el audio se deja como un hueco o interfaz para T12: una función `buildAudioGraph` inyectable, o un stub que genere silencio.
3. **Tests**:
   - snapshots de los argumentos para 3–4 planes (estático, con sustituciones, con re-layout, con relleno);
   - verificador del grafo: etiquetas definidas y consumidas exactamente una vez, entradas referenciadas que existen y recortes dentro del fotograma de la fuente.
4. **Test de integración opcional con ffmpeg real** (`*.ffmpeg.test.ts`), que se omite si no hay ffmpeg en `ffmpeg/<plat>-<arch>`: renderiza un plan pequeño con los medios de T02 a 320×180 y comprueba la duración y la resolución con ffprobe.

## Fuera de alcance

- La ejecución desde la app, el progreso y la UI (T13).
- El audio (T12).

## Criterios de aceptación

- Un script de desarrollo (`script/videomix/renderPlan.ts` o equivalente) renderiza un proyecto `.vmx` de ejemplo con los medios de T02 y el resultado se ve correcto. Se adjuntan capturas de fotogramas clave en `docs/videomix/decisiones/` o se describen en las notas.
- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

## Revisión
