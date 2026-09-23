# T27 · v2: lista de música y ducking (C1, C2)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T24 · **Estado**: hecha

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

### Resumen de cambios

- **`render/buildAudioGraph.ts`**:
  - `getMusicSchedule({ playlist, durations, totalDuration })` (puro, exportado): dónde suena cada aparición de cada pista. Cada pista empieza `crossfade` s antes del final de la anterior; el fundido se limita a la mitad de la más corta de las dos. Con `loop`, la lista entera se repite hasta el final del vídeo (también una sola pista, que se funde consigo misma). Se omiten las pistas de menos de 50 ms. Una pista de duración desconocida termina la lista. Tope de `MAX_MUSIC_OCCURRENCES` = 500 apariciones.
  - Música: **una entrada por aparición** con `atrim` a la duración de la pista, `volume` (normalización a −16 LUFS + `volumeDb` de la pista), `afade` `qsin` (potencia constante) de entrada y de salida en cada fundido cruzado, o 10 ms antichasquidos si `crossfade` = 0, y `adelay` hasta su inicio. Todas se suman con `amix`, y después van `atrim` a la duración del vídeo y el *fade-out* final de `max(2 s, D)` de antes. La última aparición lleva `-t` para no decodificar la pista entera.
  - Se usa `afade` + `adelay` en vez de una cadena de `acrossfade`, que era la otra opción del spec: el grafo hace exactamente lo que dice `getMusicSchedule`, y una lista larga en bucle no se convierte en una cadena larga de filtros que dependen unos de otros. El patrón es el mismo que el de los clips.
  - **Ducking** (`getDuckingFilter`):
    - `[clips]asplit` → `volume=30dB,asoftclip=type=hard` (señal de control saturada a 0 dBFS) → `sidechaincompress` sobre la música;
    - parámetros: `ratio=20`, umbral = `amountDb / (1 − 1/20)` dB (−10 dB → −10,53 dB, lineal 0,2976), `knee=1`, `attack=50`, `release=400`, `detection=rms`, `link=maximum`;
    - solo se aplica si `ducking.enabled`, `amountDb < 0` y hay algún clip audible;
    - va después de la compensación de simultaneidad y antes de los efectos y el limitador (el orden de T21 se mantiene).
  - **Robustez (bug que ya existía)**: se añade `asetpts=N/SR/TB` detrás de cada `amix` (constante `AMIX_TIMESTAMPS`). Ver "Hallazgos".
  - Sin medida de una pista: solo `volumeDb`, y suena hasta el final (con `-stream_loop -1` si la lista se repite, como antes de T27). Una pista silenciosa o `unmeasured` (T21b) suena con `volumeDb`, sin normalización.
- **`loudness.ts`**: `ensureLoudness` ya medía cada pista entera (y en bucle si es corta, gracias a T21b en `measureLoudness`). Ahora también **vuelve a medir una pista cacheada sin `duration`** (caché anterior a T21), igual que los efectos: la duración hace falta para programar los fundidos.
- **UI**:
  - `components/MixMusicSection.tsx` (nuevo): la sección Música, extraída a su propio fichero para no chocar con T25 en `MixSettingsDialog.tsx`. Tiene:
    - lista con dnd-kit (asa para arrastrar), nombre, volumen por pista (−30…+6 dB, con edición transitoria) y quitar;
    - "Add music files…" con selección múltiple;
    - deslizador de crossfade (0–10 s), "Repeat the list if shorter than the video" e interruptor y cantidad de ducking (−30…−3 dB);
    - aviso "File not found" con "Locate..." en las pistas cuyo fichero no existe, según el patrón de T22 (se comprueba con `mainApi.pathExists` al mostrar la sección y cada vez que cambia una ruta).
  - `MixSettingsDialog.tsx` (cambio localizado): la sección Música monta `MixMusicSection`. Se quitan el código de una sola pista y la prop `onPickMusicFile`, que nadie pasaba.
  - `hooks/useMixWorkspace.ts`:
    - todos los audios abiertos van a la música: si no había, pasan a ser la música (sin repetir, como antes); si la había, se pregunta si se añaden al final de la lista ("Add to music");
    - al abrir un proyecto con pistas que faltan, en vez de un diálogo por pista sale un aviso (*toast*) que remite a "Locate..." en la sección Música, como con los ficheros de los elementos (T22).
  - `workspace.ts`: `replaceMusic` (el flujo de una sola pista) se sustituye por `appendMusicTracks`.
- **Tests**:
  - `buildAudioGraph.test.ts`: `getMusicSchedule` (lista, bucle, una pista que se funde consigo misma, fundido limitado, duración desconocida, pistas vacías y tope), grafo con dos pistas (snapshot + `verifyFilterGraph`), sin crossfade, pista sin medida con `-stream_loop`, `getDuckingFilter` y grafo con ducking (orden asplit → sidechaincompress → mezcla → efectos → limitador; snapshot). Se actualizan los snapshots existentes con música (nueva forma de la cadena y `asetpts`).
  - `buildAudioGraph.ffmpeg.test.ts` (nuevo, ffmpeg real, se omite si falta): tonos generados. Comprueba (1) que cada pista suena donde toca, la lista se repite y a mitad del fundido cada tono está a −3 dB; (2) que con ducking la música baja 10 dB (±1) con el clip sonando y vuelve a 0 (±0,5) antes y después; (3) que una música más corta que el vídeo, con ducking, no recorta la salida ni los clips.
  - `loudness.test.ts`: la pista trae su `duration`, y una entrada de caché sin `duration` se vuelve a medir.
  - `workspace.test.ts`: `appendMusicTracks`.
  - `verifyFilterGraph.ts`: acepta entradas de la forma `N:a:0` (una línea).
- **`script/videomix/audioDemo.ts`**:
  - `--playlist`: lista en bucle de dos tonos generados (330 Hz y 12 s; 990 Hz y 9 s) con crossfade de 2 s;
  - `--ducking [amountDb]`: activa el ducking y silencia c3 para tener un tramo sin clips;
  - la medida de la música por pista incluye ya `duration` y el bucle de T21b;
  - cada render guarda también sus entradas (`*.inputs.json`) para poder repetirlo a mano.
- **i18n**: claves nuevas en inglés con `scan-i18n` y traducción al español. Se quitan del español las claves que ya no se usan ("Choose music file…", "Music volume"…).
- **Docs**: `04-diseno` §5.2 (puntos 2 y 4, y la demo) y §9.

### Medidas (ffmpeg 8.0 de `ffmpeg/linux-x64`, medios de T02)

`node script/videomix/audioDemo.ts --playlist --ducking` (2 columnas, música −12 dB, ducking −10 dB, c3 silenciado):

- **Sonoridad por tramo** (equilibrado): los tramos con clips dan entre −16,3 y −16,0 LUFS. El tramo sin clips (8–14 s) da −28,0 LUFS, que es la música sola (−16 − 12). Mezcla completa: −16,2 LUFS.
- **Música sola** (1–35,5 s): −28,0 LUFS; el objetivo es −28,0.
- **Lista** (RMS tras un pasa-banda, en la música sola):

  | Pista | Inicio (s) | Crossfade | Tono propio | Otro tono | Mitad del fundido: sale / entra |
  |---|---|---|---|---|---|
  | A (330 Hz, 12 s) | 0 | — | −30,2 dBFS | −50,9 | — |
  | B (990 Hz, 9 s) | 10 | 2 s | −30,9 | −51,6 | −2,9 / −3,0 dB |
  | A (repetición) | 17 | 2 s | −30,2 | −50,9 | −2,9 / −3,1 dB |
  | B (repetición) | 27 | 2 s | −30,9 | −51,6 | −2,8 / −3,1 dB |
  | A | 34 | 2 s | (en el *fade-out* final) | | |

  Cada tono suena solo en su tramo, con más de 20 dB sobre el otro. En la mitad de cada fundido los dos están a −3 dB, que es lo esperado con `qsin`. La lista se repite en 17 s y 27 s, tal como programa `getMusicSchedule`.
- **Ducking**: nivel RMS de la música sola frente a la música atenuada por los clips (el mismo grafo con los clips silenciados en la mezcla):

  | Tramo (s) | Clips | Δ −10 dB | Δ −20 dB¹ | Δ −6 dB² |
  |---|---|---|---|---|
  | 1–7,5 | c1 | −10,0 | −20,0 | −6,0 |
  | 8,5–14 | ninguno | 0,0 | 0,0 | 0,0 |
  | 15–18,5 | c2 (ruido rosa) | −9,9 | −19,9 | −5,9 |
  | 19,5–23,5 | c2 + c5 | −9,9 | −19,9 | −5,9 |
  | 24,5–26 | c5 | −10,0 | −20,0 | −5,9 |
  | 27–31,5 | c7 | −9,9 | −19,9 | — |
  | 32,5–35,5 | c8 | −10,0 | −20,0 | −6,0 |

  ¹ `--ducking -20`. ² `--ducking -6 --columns 3`, cuyo plan es distinto y tiene otro tramo sin clips (25,5–28 s, Δ 0,0).

  Los tiempos, medidos en ventanas de 100 ms: al empezar c2 (14 s, con *fade-in* de 0,5 s) la música llega a −10 dB en 0,1–0,2 s; al acabar c1 (fundido de 7,5 a 8 s) vuelve a su nivel en unos 0,3 s.
- Sin música y con `--music` los resultados no cambian respecto a T12/T12b (todos los tramos a ±0,4 LU de −16). Todas las variantes pasan 3 de 3 ejecuciones seguidas.

### Hallazgos (bugs que ya existían)

1. **`amix` sin timestamps (render real)**. Con música, el audio a veces salía de 8 s en vez de 38,5 s: acababa al final del primer clip. Pasaba en ~1 de cada 4 ejecuciones, **también con el grafo de antes de T27** (una sola pista con `-stream_loop`).
   - La causa: el `amix` de los clips a veces saca todos sus fotogramas sin *pts* (una carrera entre los hilos de decodificación de sus entradas). Entonces la expresión de compensación recibe `t = NaN` y ffmpeg pone el volumen a 0; además, las cadenas siguientes terminan antes de tiempo.
   - Arreglo: `asetpts=N/SR/TB` detrás de cada `amix`. Las muestras de `amix` sí son correctas; solo se rehacen sus *timestamps*.
   - Resultado: 0 fallos en 30 ejecuciones seguidas del mismo grafo, frente a 5–7 de 20 sin el arreglo. Afecta a los renders de la app con música, así que conviene tenerlo en cuenta aunque no fuera de esta tarea.
2. **Medida por tramos del script de demo (desde T12b)**. Con `-af`, poner `-ss`/`-t` como opciones de salida recorta la salida del filtro, pero `loudnorm` sigue midiendo desde 0. Por eso las cifras "por tramo" de T12b eran acumuladas desde el inicio: en la columna "sin normalizar" salían todas en torno a −23/−24. Ahora el tramo se recorta con `atrim` dentro del filtro. Las cifras de T12 (anteriores al cambio de T12b) sí eran correctas y coinciden con las de ahora. Probablemente también explica el "silencio intermitente" de T12b, que en realidad era el bug 1.
3. En el script y el test, el truco de medir la música atenuada sola enviando los clips a `anullsink` hacía que ffmpeg cerrara el grafo antes de tiempo. Se silencian en la mezcla (`volume=0`). En el grafo real no hay `anullsink`.

### Decisiones y dudas

- **Cantidad máxima exacta**: la señal de control saturada hace que la música baje exactamente `amountDb` sea cual sea el nivel de los clips, y nunca más. El umbral efectivo queda en unos −30…−40 dBFS de los clips normalizados, así que el ruido de fondo de una grabación (por debajo de −40 dBFS) apenas mueve la música. Con clips muy dinámicos, la música puede subir en las pausas largas de una frase, que es lo que pide C1 ("sube en los silencios").
- **Ataque y relajación**: 50 y 400 en las unidades de `sidechaincompress` (ms), como pide el spec. En la práctica la bajada tarda 0,1–0,2 s y la subida ~0,3 s.
- **Límites de la UI**: crossfade de 0 a 10 s; ducking de −30 a −3 dB. Un `amountDb` ≥ 0 no aplica ducking.
- **Varias apariciones = varias entradas**: una lista corta en bucle sobre un vídeo largo abre muchas entradas (una por repetición; una pista de 3 min en 1 h son 20). Por eso hay un tope de 500; más allá, la música se corta. Una música de pocos segundos en bucle sobre un vídeo largo sería el caso extremo (**duda menor**: si hiciera falta, se podría volver al bucle sin fundido con `-stream_loop` para una pista sola).
- **Pistas que faltan**: se cambia el diálogo por pista de T24 por un aviso y "Locate..." en la sección Música (patrón de T22). Si faltan también fuentes o ficheros de elementos, solo sale el aviso de más prioridad (como en T22), pero la sección Música sigue marcando las pistas que faltan.
- **Abrir audios con música ya puesta**: se añaden al final de la lista tras confirmar. Antes se sustituía la música. Si no había música, pasan a ser la lista y `loop` queda desactivado, como antes (T24).

### Validación

`yarn tsc`, `yarn lint`, `yarn test run` (54 ficheros, 623 tests, incluidos los de ffmpeg real) y `yarn build` en verde. `scan-i18n` ejecutado.

## Revisión

- **Resultado**: aceptada. Además corrige un bug previo: `amix` sin *timestamps* cortaba el audio en ~1 de cada 4 renders con música. Ducking medido con un error de 0,1 dB.
- **Duda** (el tope de 500 repeticiones de una pista muy corta): se acepta y pasa al backlog.
