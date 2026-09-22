# T12 · Audio: análisis de sonoridad y grafo de audio

- **Hito**: M3 · **Modelo**: Opus · **Depende de**: T03, T09 · **Estado**: pendiente

## Objetivo

- Medir la sonoridad de cada clip (EBU R128, primera pasada de `loudnorm`) con cache.
- Generar el grafo de audio: normalización, mute y ganancia por clip, fades de sustitución, compensación de simultaneidad, música y limitador.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §5
- [04-diseno](../04-diseno.md) §5
- `docs/videomix/decisiones/ADR-001-render.md` (cómo encaja el audio en los bloques o el grafo)
- [02-as-built](../02-as-built.md) §3: patrón de `silenceDetect` / `detectIntervals` en `src/main/ffmpeg.ts` y `getFixChannelLayoutFilter`

## Alcance

1. **`src/main/videomix/loudness.ts`**:
   - `measureLoudness({ filePath, start, end, abortSignal? })` → `LoudnessMeasurement | { hasAudio: false }`;
   - parseo del JSON de `loudnorm` en función pura con tests (`src/main/videomix/loudnessParse.test.ts`);
   - se expone al renderer como en el as-built (`remoteApiLegacy`: `videomix: { measureLoudness }`, o como parte de `ffmpeg`).
2. **Cache**:
   - clave según 04-diseno §5.1 (`mtime` y tamaño vía `fs.stat`);
   - se integra con `loudnessCache` del proyecto (acción `setLoudnessCache` de T04);
   - función `ensureLoudness(project, onProgress, abortSignal)` en el renderer, que mide solo lo que falta.
3. **`src/renderer/src/videomix/render/buildAudioGraph.ts`** (puro), con la firma que haya dejado preparada T11 (o coordinada con el ADR):
   - por clip: recorte, remuestreo a estéreo 48 kHz, `volume` de normalización más `gainDb`, mute (excluir), `afade` in/out de duración D y `adelay`;
   - compensación de simultaneidad (documenta la elección);
   - música: loop opcional, volumen, recorte y fade-out final;
   - `alimiter` y fade in/out global si `fadeInOut`;
   - **objetivo de sonoridad: −16 LUFS** (decidido por el usuario), como constante documentada.
4. **Tests**:
   - snapshots del grafo de audio (con y sin música, clips sin audio, clips muteados);
   - test de integración opcional con ffmpeg real: mezclar dos medios de T02 con volúmenes distintos y comprobar que la sonoridad integrada de cada tramo queda dentro de ±2 LU del objetivo.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run` en verde.
- Un script de desarrollo (`script/videomix/...`) demuestra el equilibrado con los medios de T02.

## Notas de ejecución

## Revisión
