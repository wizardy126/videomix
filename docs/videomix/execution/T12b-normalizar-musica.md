# T12b · Normalización de la pista de música

- **Hito**: M3 · **Modelo**: Sonnet · **Depende de**: T12 · **Estado**: hecha

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

### Resumen

- **Medición** (`ensureLoudness`, `src/renderer/src/videomix/loudness.ts`): nuevo parámetro opcional `music?: Pick<MixMusic, 'absolutePath'>`. Si se pasa, mide también el fichero completo con clave propia (`getMusicLoudnessCacheKey`, que reutiliza `getLoudnessCacheKey` con el rango centinela `[0, Infinity)`, que ningún clip real puede producir) y devuelve la medida en el mapa de salida bajo `MUSIC_LOUDNESS_KEY` (exportada por `render/buildAudioGraph.ts`). Así el cambio es aditivo: la firma de `ensureLoudness` solo gana un parámetro opcional, y su tipo de retorno (`Record<string, LoudnessMeasurement>`) no cambia, así que la firma que T13 vaya a copiar de 04-diseno (`buildAudioGraph: (input) => buildAudioGraph({ ...input, clips: project.clips, loudness })`) sigue funcionando sin tocarla.
  - `src/main/videomix/loudness.ts`: `measureLoudness` gana `start`/`end` opcionales; si se omiten los dos, no se pasan `-ss`/`-t` y mide el fichero entero.
- **`buildAudioGraph`**: sin nuevo parámetro. Busca `loudness[MUSIC_LOUDNESS_KEY]`; si existe y tiene audio, aplica `getNormalizationGain(measurement) + music.volumeDb` (mismos topes que los clips); si no, solo `volumeDb` (comentario en el código con el aviso pedido). Los snapshots existentes (sin esa clave) no cambian.
- **Valor por defecto −12 dB**: constante `DEFAULT_MUSIC_VOLUME_DB` en `types.ts` (junto a `mixMusicSchema`, ya que `defaultMixSettings` no lleva `music` al ser opcional), usada en `workspace.ts` (`createMusic`, que usa `useMixWorkspace`) y en `MixSettingsDialog.tsx` (al elegir fichero desde el propio diálogo).
- **UI**: texto de ayuda bajo el slider de volumen ("0 dB = as loud as the clips" / "0 dB = tan alta como los clips"), con el mismo estilo (`detailsStyle`) que las otras ayudas del diálogo.
- **Tests**: `loudness.test.ts` (mide la música completa, comparte cache); `buildAudioGraph.test.ts` (ganancia de la música con y sin medida). Snapshots existentes sin cambios (no incluyen `MUSIC_LOUDNESS_KEY`).
- **`audioDemo.ts`**: pasa `music` a `ensureLoudness` con `--music`; añade una renderización aislada (plan sin `placements`, solo música) para medir la música sola lejos de los fundidos, e imprime su sonoridad y el objetivo (`LOUDNESS_TARGET + volumeDb`).
  - Al depurar una sonoridad "silencio" intermitente en algunas secciones (el fichero, comprobado a mano, sí tenía audio), se cambió la medición de sección del script (no la de producción) de *fast seek* (`-ss`/`-t` antes de `-i`) a *seek* preciso (después de `-i`, antes de `-map`): con secciones muy cortas sobre un fichero recién codificado, el *fast seek* erraba el fotograma ocasionalmente y leía silencio. 10+ ejecuciones seguidas con `--music` (y sin) quedan estables tras el cambio.

### Medidas

`node script/videomix/audioDemo.ts --music`, mismos medios y planificador que T12 (2 columnas), música (`music-20s.m4a`) a −12 dB en bucle:

| Tramo (s) | Clips sonando | Sin normalizar (LUFS) | Equilibrado (LUFS) |
|---|---|---|---|
| 0,5–7,5 | c1 | −22,6 | −15,4 |
| 8–14 | c3 | −23,9 | −15,6 |
| 14,5–18,5 | c2 | −24,0 | −15,6 |
| 19–23,5 | c2 + c5 | −23,8 | −15,7 |
| 24–26 | c5 | −23,8 | −15,7 |
| 26,5–31,5 | c7 | −23,6 | −15,7 |
| 32–38 | c8 | −23,2 | −15,8 |

- Mezcla completa equilibrada: −15,8 LUFS (todos los tramos dentro de ±0,6 LU del objetivo). Música (fichero completo): −26,6 LUFS medida, ganancia de normalización +10,6 dB.
- **Música sola** (render aislado, sin clips, 1–35,5 s, lejos de los fundidos): **−28,1 LUFS**, frente al objetivo −16 + (−12) = **−28,0 LUFS**: la normalización deja la música 12 LU por debajo de los clips, como pedía la tarea.
- Sin música (`node script/videomix/audioDemo.ts`): sin cambios respecto a T12, −16,1 LUFS de mezcla, todos los tramos dentro de ±0,4 LU.

### Dudas para el orquestador o el usuario

Ninguna: T12b resuelve la duda 1 abierta en T12 (ahora la música se normaliza como los clips, con `volumeDb` relativo a −16 LUFS).

## Revisión

- **Resultado**: aceptada. La música aislada da −28,1 LUFS (objetivo −28,0). Tests en verde.
