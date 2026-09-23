# T27 · v2: lista de música y ducking (C1, C2)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T24 · **Estado**: pendiente

## Alcance

1. **Sonoridad**: `ensureLoudness` mide cada pista de la lista (fichero entero, en bucle si es corta, como en T21b).
2. **`buildAudioGraph`**:
   - las pistas van en secuencia con **crossfade** (`acrossfade`, o `afade` + `adelay`);
   - la lista entera se repite si `loop` está activo;
   - volumen por pista más normalización a −16 LUFS;
   - *fade-out* final y recorte a la duración del vídeo.
3. **Ducking**:
   - `sidechaincompress`, con la suma de los clips como señal de control y la música como entrada;
   - la reducción máxima equivale a `amountDb`;
   - ataque y relajación suaves (≈ 50 / 400 ms), documentados;
   - solo si `ducking.enabled`.
   - La compensación de simultaneidad y el orden (efectos después, y limitador al final) se mantienen.
4. **UI**: la sección Música de `MixSettingsDialog` pasa a ser una lista (añadir varias, arrastrar para ordenar, volumen por pista y quitar), con crossfade, "Repetir lista" y el ducking (interruptor y cantidad). Reenlazar pistas que falten (patrón de T22).
5. **Tests**: snapshots del grafo y test con ffmpeg real en el que la música baja con los clips sonando (mide la diferencia de nivel ≈ `amountDb`). Actualizar `audioDemo.ts`.
6. **i18n**: español.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

## Revisión
