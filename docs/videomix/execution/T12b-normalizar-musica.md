# T12b · Normalización de la pista de música

- **Hito**: M3 · **Modelo**: Sonnet · **Depende de**: T12 · **Estado**: pendiente

## Objetivo

Normalizar la música a −16 LUFS igual que los clips, con `volumeDb` relativo a ese nivel (decisión del usuario tras T12, ver [01-requisitos](../01-requisitos.md) §5).

## Contexto (leer antes de empezar)

- [T12-audio](T12-audio.md): notas y API
- [04-diseno](../04-diseno.md) §5
- Código: `src/main/videomix/loudness.ts`, `src/renderer/src/videomix/loudness.ts` (`ensureLoudness`, cache), `render/buildAudioGraph.ts`, `types.ts` (`defaultMixSettings`) y `components/MixSettingsDialog.tsx` (texto de ayuda del volumen)

## Alcance

1. **Medición**: `ensureLoudness` también mide la música (fichero completo), con clave de cache propia.
2. **`buildAudioGraph`**:
   - aplica la ganancia de normalización a la música (mismos límites que los clips) más `volumeDb`;
   - si la música no tiene medida, aplica solo `volumeDb` y deja un aviso en el código.
3. **Valor por defecto** del volumen de música: **−12 dB**. Hay que cambiarlo en `defaultMixSettings` y en el valor inicial al elegir un fichero en `MixSettingsDialog` y `useMixWorkspace`.
4. **UI**: texto de ayuda del volumen ("0 dB = as loud as the clips"), con traducción al español.
5. **Tests**: snapshots actualizados y un test de la ganancia de la música.
6. **Demo**: `script/videomix/audioDemo.ts --music` con −12 dB debe dejar la música en torno a −28 LUFS (12 LU por debajo de los clips). Mide solo la música si se puede aislar.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

## Revisión
