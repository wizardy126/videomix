# T21 · Overlays: efectos de sonido en la mezcla

- **Hito**: M7 · **Modelo**: Sonnet · **Depende de**: T19 · **Estado**: hecha

## Objetivo

Incluir los efectos de sonido en la pasada de audio, normalizados a −16 LUFS más su ganancia.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §9.1
- [04-diseno](../04-diseno.md) §5 y §8.3
- [T12](T12-audio.md) y [T12b](T12b-normalizar-musica.md): cache, `MUSIC_LOUDNESS_KEY`, límites de normalización
- Código: `videomix/loudness.ts`, `render/buildAudioGraph.ts` y `resolveOverlayTimes` (T19)

## Alcance

1. **`ensureLoudness`** mide también los efectos (fichero completo), con clave de cache por fichero. Así se sabe también su duración, que `resolveOverlayTimes` necesita: si falta, se obtiene con ffprobe o de la medida.
2. **`buildAudioGraph`**:
   - cada efecto con `adelay` hasta su inicio resuelto, ganancia de normalización más `gainDb` y recorte al final del vídeo;
   - se suman **después** de la compensación de simultaneidad y **antes** del `alimiter`;
   - el *fade* global no afecta a los efectos (se documenta si se decide lo contrario).
3. Los cambios son aditivos y compatibles con los usos existentes (`useMixRender`).
4. **Tests**: snapshots con efectos y un test de ganancia. Opcionalmente, ampliar `audioDemo.ts` con un efecto y medir su nivel aislado.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

### Resumen de cambios

- **`src/main/videomix/loudness.ts` / `loudnessParse.ts`**: `measureLoudness` ahora también obtiene la duración del fichero con `ffprobe` (`probeAudioInfo`, una sola llamada con `-show_entries format=duration:stream=…`, `format` es independiente de `-select_streams`, así que la duración se obtiene aunque el fichero no tenga pista de audio). `LoudnessAnalysis` gana `duration?: number` (en ambas ramas de `hasAudio`); solo se rellena cuando `start`/`end` se omiten (medida de fichero completo: música T12b, efectos T21), no en la medida acotada de un clip. Nueva función pura `parseFfprobeDuration` (+ tests en `loudnessParse.test.ts`).
- **`src/renderer/src/videomix/types.ts`**: `loudnessMeasurementSchema` gana `duration?: number` (no negativo) en ambas ramas, aditivo y compatible con el cache existente (que simplemente no lo tiene).
- **`src/renderer/src/videomix/loudness.ts`**:
  - `ensureLoudness` gana el parámetro opcional `sounds?: Pick<SoundOverlay, 'id' | 'absolutePath'>[]`. Mide el fichero completo de cada efecto con la misma clave de cache por fichero que la música (`getMusicLoudnessCacheKey`, ahora documentada como compartida entre música y efectos: dos elementos que usan el mismo fichero comparten medición). El resultado va bajo el `id` del overlay, igual que los clips van bajo `clip.id`.
  - Una entrada de cache sin `duration` (anterior a T21) se vuelve a medir, aunque el fichero no haya cambiado.
  - Nueva función `getSoundDurations(loudness, sounds)`: `Record<id, seconds>` a partir del resultado de `ensureLoudness`, para pasar a `resolveOverlayTimes`. Un sonido sin medida o sin `duration` se omite (así `resolveOverlayTimes` avisa `unknown-duration` y dura 0, como especifica T19).
- **`render/buildAudioGraph.ts`**: nuevos parámetros opcionales `overlays` (efectos: `id`, `absolutePath`, `gainDb`) y `overlayTimes` (el `Map` de `resolveOverlayTimes`). Por cada efecto con tiempo resuelto (`overlayTimes.get(id)`, `end > start`) y medida con audio: `adelay` hasta su inicio resuelto, ganancia de normalización (`getNormalizationGain`) más `gainDb`, `atrim` a `end − start` (ya recortado al vídeo por `resolveOverlayTimes`). Se mezclan con `amix` **después** de la compensación de simultaneidad y la música, **antes** del `alimiter`, así que el fundido global no les afecta (tal como sugiere la tarea; no hizo falta decidir lo contrario). Sin `overlays`/`overlayTimes` el grafo es idéntico al de antes (comprobado con un test que compara ambas llamadas).
- **`hooks/useMixRender.ts`** (edición mínima y localizada, coordinada con T20 que también toca este fichero):
  - una línea en `render`: `const soundOverlays = project.overlays.filter((overlay) => overlay.type === 'sound');`;
  - `sounds: soundOverlays` en la llamada a `ensureLoudness`;
  - una línea para `overlayTimes = resolveOverlayTimes(project, plan, { soundDurations: getSoundDurations(loudness, soundOverlays) })`, tras desestructurar `plan` de `renderPlan` (ya existía esa desestructuración);
  - `overlays: soundOverlays, overlayTimes` añadidos al objeto que cierra sobre `buildAudioGraph` en `buildRenderJob`.
  - No se tocó `prepare` (comprobación de ficheros que faltan) ni el grafo de vídeo: eso es T20.
- **Tests**: `buildAudioGraph.test.ts` (nuevo `describe('buildAudioGraph: sound overlays (T21)')`: mezcla tras la compensación y antes del limitador, con música, recorte a duración 0 fuera de vídeo, overlay sin `overlayTimes`, efecto silencioso, medida ausente (lanza) y equivalencia con/sin overlays vacíos) + una entrada nueva en el snapshot. `loudness.test.ts` (mide efectos, comparte medición por fichero, remide una entrada de cache sin `duration`, `getSoundDurations`). `loudnessParse.test.ts` (`parseFfprobeDuration`).
- **`script/videomix/audioDemo.ts`**: no se ha ampliado con un efecto (parte opcional de la tarea); los tests cubren la mezcla, el recorte y la ganancia.

### Helper `getSoundDurations`

```ts
getSoundDurations(
  loudness: Record<string, LoudnessMeasurement>, // resultado de ensureLoudness
  sounds: Pick<SoundOverlay, 'id'>[],
): Record<string, number> // overlayId → segundos, solo los que tienen duración
```

Uso típico (como en `useMixRender`): `resolveOverlayTimes(project, plan, { soundDurations: getSoundDurations(loudness, soundOverlays) })`, con `loudness = await ensureLoudness({ project, music, sounds: soundOverlays, ... })`.

### Dudas

Ninguna bloqueante. Se decidió, como indica la propia tarea, que el fundido global no afecta a los efectos (solo a la mezcla de clips + música). También se decidió mezclar los efectos con `amix(normalize=0, duration=first)` sobre la mezcla ya recortada a la duración del vídeo (igual patrón que la música), para no alargarla.

## Revisión

- **Resultado**: aceptada. Lint y tests de los ficheros de T21 en verde. El *fade* global no afecta a los efectos de sonido.
