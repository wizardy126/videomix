# T21b · Medición de sonoridad de efectos muy cortos

- **Hito**: M7 · **Modelo**: Sonnet · **Depende de**: T21, T23 · **Estado**: hecha

## Objetivo

Que los efectos de sonido cortos (< ~0,4 s, típicos en pitidos de cuenta atrás) se normalicen y suenen. Ahora `loudnorm` devuelve `-inf` para ellos y se tratan como "sin audio", así que se silencian sin ningún aviso.

## Contexto (leer antes de empezar)

- [T21](T21-overlays-sonido.md) y [T23](T23-overlays-cierre.md), sus notas
- Código: `src/main/videomix/loudness.ts`, `loudnessParse.ts` y `script/videomix/renderOverlaysExample.ts`

## Alcance

1. **Fichero entero más corto de ~3 s** (duración por ffprobe): medir la sonoridad de una versión en bucle, p. ej. `-af aloop=loop=-1:size=<muestras>,atrim=0:3,loudnorm=…`, o bien `-stream_loop` con `-t 3`. La sonoridad integrada de la repetición equivale a la del sonido. Documentar el método elegido y por qué.
2. **Silencio real**: se sigue tratando como "sin audio". Un fichero silencioso en bucle sigue dando `-inf`.
3. **Aviso**: si un efecto de sonido sigue sin poder medirse, se muestra como aviso antes de renderizar en lugar de silenciarse sin más. Se aplica la ganancia manual sin normalizar y se documenta.
4. **Tests**: parseo y lógica de decisión. Test con ffmpeg real, que se omite si falta: un pitido de 0,15 s y otro de 0,3 s se miden con un valor finito y coherente (±1,5 LU) con el mismo tono de 2 s.
5. **Ejemplo**: `generateTestMedia` puede volver a generar un pitido corto (0,2 s) y `renderOverlaysExample.ts` debe hacerlo sonar.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

### Resumen de cambios

- **`src/main/videomix/loudnessParse.ts`** (puro, con tests):
  - `LOOP_MEASURE_DURATION = 3` (s): por debajo de esto, una medida de fichero entero se mide en bucle.
  - `shouldLoopForMeasurement({ isWholeFile, duration })`: solo cuando es medida de fichero entero (música T12b, efectos T21) **y** la duración se conoce (ffprobe) **y** es menor que `LOOP_MEASURE_DURATION`. Nunca en la medida acotada de un clip (fuera de alcance de esta tarea).
  - `LoudnessAnalysis` (rama `hasAudio: false`) gana `unmeasured?: true`: fichero entero cuya medida ha fallado del todo (no la `-inf` parseable de un silencio confirmado), ver más abajo.
- **`src/main/videomix/loudness.ts#measureLoudness`**:
  - si `shouldLoopForMeasurement` es cierto, añade `-stream_loop -1` (entrada) y `-t 3` (salida, tras `-map`: recorta el bucle infinito, a diferencia del `-ss/-t` de entrada que ya usaba el modo acotado) antes del `loudnorm`.
  - **Silencio real** (alcance punto 2): un fichero silencioso sigue dando `-inf` aunque esté en bucle (comprobado empíricamente, ver "Medidas"); se sigue devolviendo `{ hasAudio: false }` sin más, sin aviso — el bucle no fabrica señal que no existe.
  - **Aviso** (alcance punto 3): en vez de relanzar la excepción de "Failed to parse loudnorm output" para una medida de fichero entero cuando algo falla de verdad (no solo un `-inf` parseable, ya cubierto arriba), se captura y se devuelve `{ hasAudio: false, unmeasured: true }` (más `duration` si se conoce). La medida acotada de un clip sigue relanzando (no es el alcance de esta tarea) y una cancelación (`abortSignal.aborted`) también relanza, para que siga abortando el render como antes.
- **`src/renderer/src/videomix/types.ts`**: `loudnessMeasurementSchema`, rama `hasAudio: false`, gana `unmeasured: z.literal(true).optional()`. Aditivo: una entrada de cache sin este campo se sigue leyendo igual.
- **`src/renderer/src/videomix/render/buildAudioGraph.ts`**: un efecto de sonido con `hasAudio: false` **y** `unmeasured: true` ya no se descarta como los silenciosos confirmados: se mezcla igual que uno audible pero con `volume=<gainDb>dB` (sin ganancia de normalización, porque no hay medida con la que calcularla) y sin `getFixChannelLayoutFilter` (no hay `channels`/`channelLayout` sin medida con audio). El resto del grafo (retardo, recorte a su duración resuelta, posición en la mezcla) no cambia.
- **`src/renderer/src/videomix/hooks/useMixRender.ts#render`**: tras `ensureLoudness`, si algún efecto de sonido ha quedado `unmeasured`, se muestra un aviso (`askForRenderWarnings`, la misma función que ya usa `prepare` para los avisos de la confirmación) con una línea por efecto; si el usuario cancela, se lanza `RenderAbortedError` (de `render/runRenderJob.ts`, ya usada para cancelaciones sin diálogo de error) y el render se detiene ahí, antes del paso de renderizado con ffmpeg. Este aviso no puede ir en `prepare()` (como los de `resolveOverlayTimes`) porque `unmeasured` solo se sabe tras medir la sonoridad de verdad (`ensureLoudness`), que `prepare()` no ejecuta (solo lo hace `render()`, después de la confirmación) — de ahí que el aviso aparezca justo después de medir y antes de renderizar, en vez de en el diálogo de confirmación previo.
- **`script/videomix/generateTestMedia.ts`**: `overlay-beep.wav` vuelve a ser un pitido corto de 0,2 s (antes T23 lo había subido a 0,5 s porque 0,3 s no se medía; ver duda de T23). Con el bucle de T21b ya se mide sin problema.
- **`script/videomix/renderOverlaysExample.ts`**: `measureLoudnessCli` (que replica a mano el algoritmo de `measureLoudness` porque este script de Node no puede importar `src/main` sin arrastrar Electron) incorpora el mismo bucle (`shouldLoopForMeasurement`/`LOOP_MEASURE_DURATION`, reexportadas de `loudnessParse.ts`, que no tiene imports problemáticos). La ventana de comprobación del nivel del pitido (antes/durante, con `astats`) se ajusta a la nueva duración de 0,2 s (antes 0,5 s): la fase "durante" pasa de 0,2 s a 0,1 s para no solaparse con el *fade out* del pitido (que ahora empieza a los 0,15 s).
- **Tests**:
  - `src/main/videomix/loudnessParse.test.ts`: `shouldLoopForMeasurement` (fichero entero corto → bucle; igual o por encima de `LOOP_MEASURE_DURATION` → no; duración desconocida → no; medida acotada de un clip → nunca, aunque sea corta).
  - `src/renderer/src/videomix/render/buildAudioGraph.test.ts`: nuevo test en el `describe` de T21 — un efecto `unmeasured` se mezcla con `volume=<gainDb>dB` (sin ganancia de normalización).
  - `src/main/videomix/loudness.ffmpeg.test.ts` (**nuevo**, ffmpeg real, se omite si falta): no puede importar `measureLoudness` directamente (arrastra `src/main/ffmpeg.ts`, que importa `electron`, y `app` es `undefined` fuera de un proceso Electron real — comprobado a mano, revienta con `Cannot read properties of undefined (reading 'isPackaged')` al construir `logFilePath` en `src/main/logger.ts`). En su lugar replica el algoritmo con las mismas funciones puras (`loudnessParse.ts`) y llamadas directas a `ffmpeg`/`ffprobe`, igual que ya hacía `measureLoudnessCli` de `renderOverlaysExample.ts`. Comprueba: (a) el criterio de aceptación de la tarea — un pitido de 0,15 s y otro de 0,3 s miden un valor finito y coherente (±1,5 LU) con el mismo tono de 2 s (que también se mide en bucle, al ser <3 s) —; (b) que un pitido ya de 3,5 s (≥ `LOOP_MEASURE_DURATION`, no se mide en bucle) sigue coincidiendo con uno corto; (c) que un silencio real de 0,2 s sigue midiendo `-inf` (sin `unmeasured`) aunque esté en bucle.

### Medidas (empíricas, ffmpeg real de `ffmpeg/linux-x64`)

Un tono `sine=frequency=880` al mismo nivel, medido con `loudnorm=I=-16:TP=-1.5:LRA=11`:

| Duración | Medida directa (`input_i`) | Medida en bucle a 3 s (`input_i`) |
|---|---|---|
| 0,15 s | `-inf` (bug: se trataría como silencio) | **-21.35 LUFS** |
| 0,3 s | `-inf` (bug) | **-21.35 LUFS** |
| 2 s | -21.35 LUFS (ya funcionaba directo) | -21.35 LUFS (también se mide en bucle, por ser < 3 s) |

Las tres medidas en bucle son **idénticas** (mismo tono sintético, así que es el resultado esperado; el margen de ±1,5 LU del criterio de aceptación se cumple con margen). Un silencio real (`anullsrc`) de 0,2 s en bucle a 3 s sigue midiendo `-inf`/`-inf` (input_i/input_tp), confirmando que el bucle no inventa sonoridad donde no la hay (alcance punto 2). Con el pitido de ejemplo real (`overlay-beep.wav`, 0,2 s, con *fade out*), `renderOverlaysExample.ts` mide `-22.15 LUFS` (antes, a 0,3 s, medía `-inf` y se habría silenciado) y el fotograma/audio de salida confirma que se oye claramente por encima del fondo (RMS +3,7 dB).

### Dudas

- **Qué cuenta como "sigue sin poder medirse" (alcance punto 3)**: la duda no bloqueante más relevante de esta tarea. Con el bucle a 3 s, cualquier efecto corto con señal real por encima de la puerta absoluta (-70 LUFS) se mide bien (comprobado empíricamente); un fichero corto genuinamente silencioso sigue dando `-inf` en bucle, y eso *es* silencio real (alcance punto 2, explícito). Así que, tras la corrección del punto 1, no queda ningún caso de "silencio ambiguo" para ficheros cortos con duración conocida: el aviso de `unmeasured` solo puede dispararse cuando la propia medida (`runFfmpeg`/parseo del JSON de `loudnorm`) falla del todo — un fallo de verdad, no un `-inf` parseable —, algo que antes de esta tarea tumbaba el render entero con "Failed to parse loudnorm output" por un solo efecto de sonido roto o con un formato inusual. Elegí esta interpretación (conservadora: nunca deja de sonar un efecto por un error de medición, pero tampoco silencia con normalización manual de más) porque es la única situación real, tras el punto 1, en la que "no confirmado silencio" y "no medido" no coinciden. **No he encontrado ningún fichero real que dispare este camino** (no he conseguido que `-stream_loop`/`loudnorm` fallen con ningún WAV/PCM de prueba), así que la ruta de `unmeasured` está cubierta por tests de decisión pura y de `buildAudioGraph`, pero no por un caso de ffmpeg real que la dispare; el orquestador puede revisar si esto merece más cobertura o si la interpretación es la que se buscaba.
- Descarté que la duración desconocida (ffprobe no puede leer `format.duration`) fuera un caso de `unmeasured`: ese fichero ya se queda sin `duration` en la medida, así que `getSoundDurations` lo omite y `resolveOverlayTimes` ya avisa con `unknown-duration` y lo resuelve a duración 0 (silenciado por posición, no por ganancia) — marcarlo también `unmeasured` sería redundante y, además, inalcanzable en `buildAudioGraph` (el overlay nunca llega a esa rama porque `times.end <= times.start`).
- Nada más bloqueante. `overlay-beep.wav` vuelve a 0,2 s (el motivo de subirlo a 0,5 s en T23 ya no aplica).

## Revisión

- **Resultado**: aceptada. Los pitidos de 0,15 s, 0,3 s y 2 s miden lo mismo (−21,35 LUFS) con el bucle a 3 s. El silencio real sigue siendo silencio. `tsc`, `lint`, tests (532) y `build` en verde.
- **Duda**: la ruta "no medible por error" está cubierta con tests unitarios y basta con eso.
