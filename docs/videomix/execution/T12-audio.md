# T12 · Audio: análisis de sonoridad y grafo de audio

- **Hito**: M3 · **Modelo**: Opus · **Depende de**: T03, T09 · **Estado**: hecha

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

### Resumen

El diseño implementado está en [04-diseno §5](../04-diseno.md), con la firma para T11/T13.

- **Main**:
  - `src/main/videomix/loudness.ts`: `measureLoudness({ filePath, start, end, abortSignal? })`. Hace `ffprobe` de la primera pista de audio y la primera pasada de `loudnorm`.
  - `src/main/videomix/loudnessParse.ts` (puro) + `loudnessParse.test.ts`: parseo del JSON de `loudnorm` y del `ffprobe`; silencio (`-inf` o ≤ −70 LUFS) → `{ hasAudio: false }`.
  - `src/main/index.ts`: una línea de import y `videomix: { measureLoudness }` en `remoteApiLegacy`.
- **Renderer**:
  - `videomix/loudness.ts` + test: `getLoudnessCacheKey` (sha1 con Web Crypto) y `ensureLoudness`, que mide solo lo que falta (concurrencia 2, progreso, cancelación, `onCacheEntries` → `setLoudnessCache`) y devuelve las medidas por id de clip. Las dependencias (`stat`, `measureLoudness`) se inyectan; por defecto van por `@electron/remote`.
  - `videomix/types.ts`: `LoudnessMeasurement` gana `channels` y `channelLayout` opcionales (para `getFixChannelLayoutFilter` al mezclar). Es compatible con los proyectos existentes.
  - `render/buildAudioGraph.ts` + test con 4 snapshots (sin música, con música en bucle y fundidos globales, clips muteados o sin audio, ningún clip audible) y tests de fundidos, compensación y ganancia.
- **Scripts**:
  - `script/videomix/audioDemo.ts`: demo del equilibrado.
  - `script/videomix/rendererImports.ts`: *hook* de `node:module` (`registerHooks`) que permite importar módulos del renderer desde Node. Resuelve los imports sin extensión probando `.ts`, `.tsx` y `/index.ts`, y define `import.meta.env` (lo usa `planMix`). Los módulos se cargan con `await import()` dinámico. **No** se pueden importar sus tipos desde `script/`, porque `tsconfig.node.json` (NodeNext) los comprobaría y rechazaría los imports sin extensión; el script declara localmente los pocos tipos que usa. T11 puede reutilizarlo.

### Decisiones

- **Objetivo −16 LUFS** (`LOUDNESS_TARGET`). La normalización es una ganancia estática `min(−16 − input_i, 24 dB, +5 − input_tp)`:
  - el tope de 24 dB evita subir el ruido de clips casi mudos; lleva al objetivo clips de hasta −40 LUFS;
  - el tope por pico hace que el limitador no tenga que quitar más de unos 6 dB a los picos de un clip; un clip muy dinámico queda algo por debajo del objetivo en vez de aplastado.
- **Sin `dual_mono`**. Una primera versión lo usaba y dejaba los clips mono 3 LU por debajo del objetivo: swresample convierte mono en estéreo a −3 dB por canal, con lo que se conserva la sonoridad medida en un canal.
- **Fundidos por clip** con curva `qsin` (potencia constante): crossfade = `transitionIn` del entrante; columna que aparece o desaparece = duración de la animación del keyframe; final hacia el relleno = `transitionOut` de T10b; cortes secos con 10 ms antichasquidos.
- **Compensación de simultaneidad global** sobre la suma (`volume` con `eval=frame`). `n(t)` cuenta desde la mitad del fundido de entrada hasta la mitad del de salida, así que una sustitución no cambia la ganancia. Rampas lineales como suma plana de `clip()`.
- **Música sin normalizar**: `volume=volumeDb`, como dice el diseño (ver dudas).
- **Limitador**: `alimiter` a −1 dBFS con `level=disabled` (si no, normaliza él) y `latency=1`. Sin `latency` el audio sale 5 ms tarde (comprobado con `silencedetect`).
- **Fundido global** = `D` si `fadeInOut` (`getGlobalFadeDuration`); el vídeo de T11 debería usar la misma duración.
- **Siempre hay pista de audio**: sin clips audibles, `anullsrc` de la duración del vídeo.
- **Coordinación con T11**:
  - la salida `{ inputs, filterComplex, outLabel }` tiene la misma forma que `AudioGraph` de `buildRenderJob`;
  - la entrada acepta `{ plan, clips, sourcePaths, settings, duration }` del *hook* más `loudness`;
  - como `RenderClip` no tiene `muted` ni `gainDb`, T13 debe cerrar también sobre los clips completos: `(input) => buildAudioGraph({ ...input, clips: project.clips, loudness })`.

### Medidas

`node script/videomix/audioDemo.ts`, con el planificador real, 2 columnas, 8 clips (5 con audio, uno sin pista y otro con pista muda), ffmpeg 8.0 y 4 vCPU. Sonoridad integrada del resultado por tramo, excluidos los fundidos:

| Tramo (s) | Clips sonando | Sin normalizar (LUFS) | Equilibrado (LUFS) |
|---|---|---|---|
| 0,5–7,5 | c1 (seno 440 Hz) | −21,8 | −16,0 |
| 8–14 | c3 (seno 660 Hz, −12 dB) | −33,6 | −16,0 |
| 14,5–18,5 | c2 (ruido rosa, −24 dB) | −39,1 | −16,4 |
| 19–23,5 | c2 + c5 | −24,6 | −16,0 |
| 24–26 | c5 (seno 550 Hz) | −21,7 | −16,0 |
| 26,5–31,5 | c7 (ruido rosa) | −38,9 | −16,1 |
| 32–38 | c8 (seno 440 Hz) | −21,8 | −16,0 |

- Mezcla completa: −23,4 → **−16,1 LUFS**; true peak −6,3 dBTP; LRA 14,3 → 0,5 LU. Todos los tramos quedan dentro de ±0,4 LU del objetivo (el criterio pedía ±2 LU).
- Con `--columns 3` hay tramos con 3 fuentes simultáneas (c2 + c5 + c7: −16,1 LUFS) y un tramo sin audio (silencio real). Con `--music` (música a −12 dB en bucle), los tramos quedan entre −16,4 y −15,8.
- La pasada de audio de 38,5 s tarda 0,7–1 s. Duración de la salida: 38,500 s exactos.
- No se añadió el test de integración opcional con ffmpeg en vitest: el script de demo cubre esa comprobación y falla (código de salida 1) si algún tramo se sale de ±2 LU.

### Dudas para el orquestador o el usuario

1. **Volumen de la música**: se aplica `volumeDb` tal cual, sin normalizar, según 04-diseno §5.2. Una música masterizada (~−9 LUFS) a 0 dB (el valor por defecto) sonará ~7 LU por encima de los clips.
   - **Alternativa propuesta**: medir también la música y normalizarla a `−16 + volumeDb`. Entonces 0 dB significaría "igual de alta que los clips" y valores como −12 dB darían un fondo razonable.
   - Es un cambio pequeño (`ensureLoudness` y `buildAudioGraph`), pero cambia el significado del ajuste. ¿Se hace?
2. **Topes de la normalización** (24 dB de subida máxima y picos ≤ +5 dBTP antes del limitador): son una elección propia. Con material real puede convenir ajustarlos.
3. Las fuentes multicanal (5.1) se mezclan a estéreo con la matriz por defecto de swresample, pero se miden en su layout original. La sonoridad resultante puede diferir 1–2 LU. No se ha corregido; los medios de prueba son mono o estéreo.

## Revisión

- **Resultado**: aceptada. Lint de los ficheros de T12 en verde y tests en verde. La demo da todas las secciones a ±0,4 LU de −16 LUFS.
- **Duda 1** (normalizar la música): se consulta al usuario.
- **Dudas 2 y 3**: se aceptan como están. Los límites se ajustarán con material real si hace falta.
