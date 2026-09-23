# T21 · Overlays: efectos de sonido en la mezcla

- **Hito**: M7 · **Modelo**: Sonnet · **Depende de**: T19 · **Estado**: pendiente

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

## Revisión
