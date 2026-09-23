# ADR-001 · Estrategia de render con ffmpeg

- **Tarea**: T09 (spike) · **Estado**: aceptada
- **Afecta a**: T11 (grafo de vídeo), T12 (audio), T13 (render, progreso, previsualización), T10 (invariantes del plan)

## Resumen

- **El re-layout animado es viable** con calidad y rendimiento aceptables. No hace falta el fallback de transición de fotograma completo.
- **Técnica elegida para la animación: "capa de columna"**. Por cada clip:
  1. `crop` fijo de la unión de recortes;
  2. `scale` con `eval=frame`, cuyo tamaño de salida varía por fotograma;
  3. `overlay` con posición por fotograma sobre una base de tamaño fijo.

  Las columnas se componen de izquierda a derecha y cada una tapa el sobrante de la anterior.
- **Render por bloques**: se corta en instantes sin transición y siempre al principio y al final de cada re-layout. Cada bloque se codifica por separado; los bloques se unen con el concat demuxer (`-c copy`) y el audio se renderiza en una sola pasada aparte.
  - Se renderizan **2 bloques en paralelo**. Así se iguala el tiempo del grafo único con menos de la mitad de memoria por proceso y una memoria que no crece con la duración del proyecto.
- **Composición** sobre un lienzo `color` (del color de la separación) con `overlay`, no con `xstack`.
- **`xfade` por columna**, sobre flujos de columna de tamaño fijo.
- **Relleno desenfocado** a 1/8 de resolución.
- **El grafo se pasa siempre por fichero** (`-/filter_complex <fichero>`).
- Los valores por fotograma se escriben como **suma plana de escalones**: ffmpeg rechaza las expresiones anidadas a más de unos 98 niveles.

## Contexto

- El montaje es una fila de columnas de altura completa. Cada columna es una secuencia de clips que se sustituyen con `xfade`.
- A veces toda la fila cambia de anchos con una animación de duración `D` (0,5 s por defecto) mientras los clips siguen reproduciéndose. Ver [01-requisitos](../01-requisitos.md) §4 y [04-diseno](../04-diseno.md) §2 y §3.1.
- Durante la animación, cada columna debe mostrar en cada fotograma el recorte que da `getCropForAspect(max, min, w(t)/H)`:
  - centrado en el mín. y dentro del máx.;
  - escalado a la altura `H`.

  Así, el ancho de la ventana y, en clips con recorte limitado por el ancho, también el zoom varían por fotograma.
- Problema de partida (04-diseno §4.1): en ffmpeg, `crop` y `xfade` trabajan con tamaños fijos por enlace del grafo.

## Entorno de medida

- VM con **4 vCPU** Intel Xeon @ 2,10 GHz, 15 GB de RAM, sin GPU, Linux.
- `ffmpeg n8.0-23-gd1f31a829d` (build BtbN del 22-10-2025, el de `yarn download-ffmpeg-linux-x64`).
- Salida 1920×1080, 30 fps, `libx264 -preset medium -crf 20`, AAC 192k.
- **Medios**: los de T02 más tres fuentes largas generadas por el spike (`renderSpike.ts sources`: 60 s de `testsrc2` con ruido temporal `noise=alls=12:allf=t`, 1080p30, 720p25 y 1080×1920).
  - El ruido hace que x264 trabaje como con metraje real o más: la salida sale a ~70 Mb/s, lo que da **tiempos pesimistas**.
  - GOP por defecto de x264 (250), también pesimista para el coste de `-ss`.
- Tiempos: `wall` (reloj) y `cpu` (user + sys). Memoria: pico de RSS del proceso ffmpeg (`getrusage`).

## Reproducir

Prototipos en `script/videomix/spike/` (fuera del código de la app); salidas en `test-media/spike-out/`, ignorado por git.

```bash
node script/videomix/spike/renderSpike.ts sources        # fuentes largas + sonda de sincronía (≈3 min, una vez)
node script/videomix/spike/renderSpike.ts static         # §1 overlay vs xstack/hstack
node script/videomix/spike/renderSpike.ts sync           # §2 xfade 25/30 fps + sincronía A/V, por bloques y grafo único
node script/videomix/spike/renderSpike.ts relayout       # §3 re-layout: capa de columna vs composición por fotograma
node script/videomix/spike/renderSpike.ts mask-bench     # §3 coste de máscara geq vs scale eval=frame
node script/videomix/spike/renderSpike.ts fill           # §4 pillarbox, letterbox y relleno final
node script/videomix/spike/renderSpike.ts blur-bench     # §4 coste del desenfoque
node script/videomix/spike/renderSpike.ts perf medium chunked 1   # §5 2 min / 15 clips por bloques (1 = secuencial, 2 = paralelo)
node script/videomix/spike/renderSpike.ts perf medium full        # §5 grafo único (NULL_OUT=1: sin codificar)
node script/videomix/spike/renderSpike.ts argv-bench     # §5 longitud del comando
bash script/videomix/spike/example-anim-chunk.sh         # esqueleto comentado (ver "Esqueleto del grafo")
```

Cada ejecución escribe los grafos generados (`*.graph.txt`) y fotogramas PNG junto a los vídeos.

## Opciones evaluadas y medidas

### 1. Columnas estáticas: `overlay` sobre lienzo frente a `xstack` / `hstack`

Tres clips (1080p horizontal, 1080×1920 vertical y 1080×1080) recortados a 636/632/636 px, con separación de 8 px. 6 s (180 fotogramas), dos repeticiones:

| Grafo | Solo filtros (`-f null`) | Con x264 medium | RSS |
|---|---|---|---|
| `color` + 3× `overlay` | 1,6–1,9 s | 4,5–5,6 s | 922 MB |
| `xstack` (con `fill`) | 1,05 s | 3,9–4,1 s | 830 MB |
| `hstack` + `pad` para la separación | 1,1 s | 4,1 s | 830 MB |

- La imagen resultante es idéntica.
- `overlay` cuesta unos 3 ms más por fotograma: un 10–15 % del total, porque manda la codificación.
- **Se elige `overlay`**:
  - admite `x` por fotograma (imprescindible en la animación);
  - admite huecos y rellenos encima;
  - admite columnas que empiezan o terminan dentro del bloque (`eof_action=pass`);
  - y un solo camino de código.

  `xstack` exige que todas las entradas existan y tengan posiciones fijas.

### 2. Sustitución en una columna con `xfade`, con fuentes de 25 y 30 fps

- **Escenario**:
  - Columna 0: `h-720p-25fps` y después la sonda de sincronía de 25 fps, con `xfade` a los 7,5 s. La sonda tiene un destello blanco de 1 fotograma y un pitido de 40 ms en cada segundo exacto.
  - Columna 1: un vertical de 30 fps que sigue reproduciéndose.
  - Salida a 30 fps, renderizada en bloques de 3 s (corte en 9 s, en mitad de la sonda) y en grafo único.
- **Resultado** (idéntico en los dos modos):
  - destellos a 8,500 / 9,500 / 10,500 / 11,500 s;
  - pitidos a 8,505 / 9,505 / 10,505 / 11,505 s (la diferencia es la resolución de `silencedetect`);
  - 360 fotogramas, 12,000 s.

  **Sin desincronización** de audio ni de PTS, ni al cambiar de fps ni en los cortes de bloque.
- **Error encontrado y corregido**:
  - Con `-ss` como opción de entrada, el primer fotograma decodificado puede no estar en 0 (a 25 fps, hasta 40 ms después).
  - Si se hace `setpts=PTS-STARTPTS` **antes** de `fps`, el clip se adelanta hasta un fotograma de la fuente. En el render por bloques se veía un destello duplicado en 9,467 s.
  - **Regla**: `fps=<F>:start_time=0` directamente sobre la entrada; `setpts=PTS-STARTPTS` solo después del `trim`.
- **Segundo error, en el primer fotograma de un bloque**:
  - El *accurate seek* de ffmpeg descarta el fotograma de la fuente que sigue en pantalla en el punto de `-ss`, porque su pts es anterior.
  - Con fuentes de 25 fps, el primer fotograma de un bloque mostraba el fotograma siguiente de la fuente. Se veía una diferencia de 25,7 dB de PSNR frente al grafo único solo en ese fotograma.
  - **Regla**: si el punto de búsqueda es > 0, se abre la entrada 0,1 s antes (`-ss s−0,1`) y se desplaza con `setpts=PTS-0.1/TB` antes de `fps`. Tras el cambio, ese fotograma queda a 45,9 dB, al nivel de los demás, que solo difieren por la codificación.
- **`xfade`**:
  - requiere que las dos entradas tengan el **mismo tamaño fijo**, la misma base de tiempos y el mismo SAR;
  - `offset` es relativo al inicio del primer flujo de la columna;
  - para encadenar varias sustituciones: `[a][b]xfade=…:offset=o1[ab];[ab][c]xfade=…:offset=o2`.

### 3. Re-layout animado

Escenario (`relayout`): 3 columnas y separación blanca de 8 px (para ver los bordes). En `t = 2,75` la columna 2 cambia de clip con `xfade` mientras toda la fila pasa en 0,5 s de 636|632|636 a 520|776|608:

- el horizontal estrecha su recorte;
- el vertical pasa a estar limitado por el ancho, **con zoom**;
- el cuadrado estrecha su recorte.

Suavizado `smoothstep` de los anchos.

| Técnica | Resultado |
|---|---|
| **`crop` con `w`/`h` en función de `t`** (04-diseno (b)) | **No sirve.** `w`/`h` se evalúan solo al configurar (el ancho se quedó fijo); solo `x`/`y` se evalúan por fotograma. |
| **`sendcmd` a `crop w`/`h`** | **No sirve.** El fotograma cambia de tamaño pero el enlace no: la imagen sale comprimida o corrupta. |
| **`xfade` con entradas de tamaño variable** | **No sirve**: la salida es corrupta. |
| **Máscara alfa por fotograma** (`geq` sobre alfa, 04-diseno (a) con máscara) | Funciona, pero **26 fps** para una sola capa de 960×1080. Descartada por lenta. |
| **Capas anchas + `overlay` con `x(t)` + orden de apilado** (04-diseno (a)) | Funciona si la escala es constante (sin zoom). No cubre los clips cuyo recorte limita por ancho. Queda como caso particular de la técnica elegida. |
| **Capa de columna: `crop` fijo (unión) → `scale … eval=frame` → `overlay` con `x`/`y` por fotograma sobre una base fija** | **Funciona con zoom.** `overlay` acepta fotogramas de tamaño variable en la entrada superpuesta (verificado en ffmpeg 8). Microbenchmark con 960×1080 y 150 fotogramas: **130 fps**, frente a 145 fps con escala fija (−10 %). **Elegida.** |
| **Composición por fotograma** (04-diseno (c)): cada fotograma de la animación es una composición estática con su recorte exacto, y se concatenan | Funciona y da la misma imagen: PSNR medio de 39 dB frente a la capa de columna, con diferencias de redondeo. Grafo **3× más largo** (11,7k frente a 3,7k caracteres para 15 fotogramas) que crece con fps × `D`. `xfade` no se puede usar: solo `fade` mediante opacidad. Descartada; queda como plan B. |
| **Fallback (d)**: transición global de fotograma completo | No es necesario. |

**Coste medido del bloque de animación** (0,5 s = 15 fotogramas, 4 entradas, incluida la apertura de las entradas y el `-ss`):

| | `-f null` | x264 medium | RSS | Grafo |
|---|---|---|---|---|
| Capa de columna | 0,96–1,4 s | 1,3–2,2 s | 670 MB | 3,7k caracteres |
| Por fotograma | 1,2–1,5 s | 1,4–2,3 s | 780–940 MB | 11,7k caracteres |

- **Calidad** (fotogramas PNG a 0 / 0,1 / 0,25 / 0,4 / 0,47 s del bloque, y el vídeo completo):
  - sin saltos; los bordes y la separación se mueven de forma continua;
  - el contenido de cada columna queda centrado en su recorte en todos los fotogramas (el horizontal solo se desplaza; el vertical hace zoom centrado en el mín.);
  - el `xfade` se ve limpio durante la animación.
- **Cuantización**:
  - las posiciones de `overlay` en yuv420p son pares, y los tamaños de `scale` se redondean a pares;
  - el contenido puede moverse 1–2 px de más o de menos entre fotogramas, algo invisible porque todo está en movimiento.
- **Coherencia con el grafo único**: el bloque renderizado aparte coincide con el mismo tramo de un render de 6 s en un solo grafo (PSNR de 44–47 dB por fotograma: solo difiere la codificación). Además, `example-anim-chunk.sh` reproduce **bit a bit** la salida del generador (PSNR = ∞).

### 4. Relleno desenfocado y separación

- **Escenario `fill`**:
  - un 16:9 rígido en una columna de 600 px (**letterbox**);
  - un 9:16 rígido en una columna de 800 px (**pillarbox**);
  - una tercera columna que termina a los 2,5 s y pasa a **relleno final**, con fundido de `D` antes del fin del clip.

  Los tres se ven correctos:
  - fondo desenfocado del propio clip (letterbox/pillarbox);
  - fondo desenfocado de la columna adyacente (relleno final).
- **Coste del desenfoque** (capa de 1920×1080, 300 fotogramas, sin codificar):

  | Variante | fps |
  |---|---|
  | `gblur=sigma=40` a resolución completa | 161 |
  | `boxblur=40:2` a resolución completa | 72 |
  | **escala a 1/8 + `boxblur=6:2` + escala arriba (`bilinear`)** | **408** |

  Se elige la última. Visualmente equivale a un desenfoque fuerte; en zonas planas se nota algo de "bloque" suave, aceptable para un fondo.
- **Separación**:
  - lienzo `color=c=<gap.color>`; en bloques estables la separación es el lienzo que asoma entre columnas;
  - en bloques con animación, las capas son más anchas que su ventana y tapan la separación, así que se redibujan barras `color=<gap.color>:s=<gap>xH` con `overlay` en `x(t)` = borde derecho de cada columna (o, si entre ella y la siguiente se abre un relleno, `x` de la siguiente − `gap`: el relleno toca a la columna izquierda; T16).

### 5. Rendimiento: grafo único frente a bloques (≈2 min, 15 clips, 1080p)

- **Plan** (`perfPlan()` en el spike):
  - 118 s y 15 clips de 6 fuentes: 1080p30, 720p25 (dos), vertical 1080×1920 (dos), la rotada por metadatos y 1080×1080 sin audio;
  - entre 2 y 3 columnas; 14 sustituciones con `xfade`;
  - **7 re-layouts animados**: uno elimina una columna (su ancho pasa a 0) y otro coincide con un `xfade`;
  - un relleno final con fundido;
  - fade in/out global;
  - música en bucle (`-stream_loop -1`).
- **Tiempos**:

  | Modo | Tiempo real | CPU | Pico de RSS | Entradas simultáneas | Grafo |
  |---|---|---|---|---|---|
  | **Bloques, secuencial** (20 bloques) | 549,7 s (0,21× tiempo real) | 1640 s | 1,09 GB | ≤ 4 | ≤ 4,4k caracteres |
  | **Bloques, 2 en paralelo** | **427,2 s** | 1659 s | 1,06 GB por proceso (~2,1 GB en total) | ≤ 4 por proceso | ≤ 3,7k caracteres |
  | **Grafo único** | 400,1 s | 1549 s | **2,68 GB** | 16 | 22k caracteres (22,7k–26k en línea) |
  | Grafo único sin codificar (`-f null`) | 130,4 s | 445 s | 2,1 GB | 16 | — |

  Pasos fijos del modo por bloques: pasada de audio 3,1 s (71 MB) y concat + mux 1,7–2,8 s.
- **Nota**: estas medidas se tomaron antes de añadir el margen previo de 0,1 s en `-ss` (§2). Supone decodificar ≤ 3 fotogramas más por entrada y bloque: despreciable.
- **Salida**: en los dos modos, 3540 fotogramas y 118,000 s exactos, sin fotogramas duplicados ni perdidos en los cortes (se comprobaron fotogramas en 19,75 / 35,25 / 99,75 / 111,25 s).
- **Lectura de los datos**:
  - La codificación x264 medium supone ~70 % de la CPU; decodificar y filtrar, ~30 %.
  - **Los bloques secuenciales infrautilizan la CPU** (2,98 de 4 núcleos, frente a 3,87 del grafo único): x264 tarda en llenar y vaciar el *lookahead* en cada bloque, y el `-ss` de cada entrada decodifica desde el keyframe anterior en un solo hilo. Los bloques de animación de 15 fotogramas costaron entre 3 y 15 s cada uno (fuentes con GOP de 250).
  - **Con 2 bloques en paralelo** el uso vuelve a 3,88 núcleos y el tiempo queda a +7 % del grafo único.
  - La memoria del grafo único escala con el **número de clips**: abre todas las entradas desde el principio, con 16 entradas 2,7 GB. Por bloques depende solo de las columnas simultáneas: ~1 GB a 1080p.
- **Límites**:
  - **Anidamiento de expresiones**: `if(…)` anidado funciona hasta unos 90 niveles y falla a partir de ~99 ("Error when evaluating the expression"). El grafo único con 7 animaciones falló así la primera vez. La **suma plana de escalones** (`v0+Δ1*gte(t,T1)+…`) se probó con 2000 términos sin problema.
  - **Longitud del comando**: el grafo único de 2 min ocupa ~23k caracteres en línea. El límite de `CreateProcess` en Windows es 32 767, así que un proyecto de 3–4 min ya no cabría. **Se pasa siempre por fichero**: `-/filter_complex <ruta>`, la sintaxis de ffmpeg ≥ 7; se usó en todas las pruebas. `-filter_complex_script` está obsoleto.
  - **Número de `-i`**: no hay límite práctico en ffmpeg, pero cada entrada es un demuxer más un decodificador con sus hilos y colas. Es el origen de la memoria del grafo único.

### 6. Audio: prototipo mínimo (04-diseno §5.2)

- **Pasada única** sobre toda la duración:
  - entradas con `-vn -ss <inicio> -t <dur+0,1>`: el vídeo no se decodifica;
  - por clip: `asetpts=PTS-STARTPTS,aresample=48000,aformat=fltp:stereo,atrim=duration=dur,volume=<g>dB,afade in/out (D),adelay=<ms>:all=1`;
  - `amix=inputs=N:normalize=0:duration=longest`;
  - compensación `volume='<expr de n(t)>':eval=frame` (amplitud `1/√n`, es decir, −10·log10(n) dB, con rampas de `D`);
  - música: `-stream_loop -1`, `atrim`, `volume`, `afade` de salida de max(2 s, D);
  - `amix` de 2 entradas con `normalize=0`;
  - `alimiter`;
  - `afade` in/out global.
- **Resultados**:
  - 3,1 s para 118 s y 15 clips, con 71 MB;
  - sincronía verificada en §2;
  - el bucle de música es continuo (20 s en bucle hasta 118 s).
- **Mux** con los bloques de vídeo: `-f concat -i list.txt -i audio.m4a -map 0:v -map 1:a -c copy`. Renderizar el audio aparte evita los huecos y el *priming* de AAC en las uniones de bloques.
- Los detalles (ganancias de `loudnorm`, clips sin audio, compensación por clip o global) son de T12.

## Decisión

### Arquitectura de render

1. **Render por bloques**:
   - Cada bloque se codifica con `libx264` en su propio proceso ffmpeg, con los **mismos parámetros** de codificación en todos (resolución, fps, `pix_fmt`, preset, CRF) y `-an`.
   - Se renderizan **2 bloques en paralelo** por defecto. Con 2160p o con menos de 4 núcleos, 1.
2. **Una pasada de audio** para toda la duración, en paralelo o antes de los bloques (es barata).
3. **Unión**: concat demuxer con `-c copy` más el mux del audio, con `-movflags +faststart`.
4. **Grafo por fichero** siempre (`-/filter_complex`). La lista de `-i` va en argv: son ≤ columnas × 2 entradas por bloque.

### Grafo de un bloque (lo genera T11)

- **Entradas**: una por cada colocación que solapa el bloque:
  - `-ss <s − p> -t <frames/fps + 0,5 + p> -i <ruta>`, con `s = clip.start + max(0, f0/fps − startTime)` y un margen previo `p = min(0,1, s)`;
  - la rotación la aplica ffmpeg (autorotate), y los rectángulos están en espacio orientado.
- **Cabecera de cada clip**:

  ```
  setpts=PTS-p/TB,fps=F:start_time=0,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=N,setpts=PTS-STARTPTS
  ```

  Da N fotogramas exactos: `N = round(fin·F) − round(inicio·F)`, recortado al bloque.
- **Clip en una columna de ancho constante durante el bloque** (camino estático):
  - `crop=<getCropForAspect(max,min,w/H)>,scale=w:H,setsar=1`;
  - pillarbox/letterbox: `split` → primer plano escalado más fondo `blurCover(w,H)` → `overlay` centrado.
- **Clip en una columna cuyo ancho varía en el bloque** (animación, camino "capa de columna"):
  1. Para cada fotograma `m` del clip en el bloque: `w(t)` (interpolado con `smoothstep` entre los `LayoutKeyframe`), `C(t) = getCropForAspect(max, min, w/H)` en reales y `s = H/C.h`.
  2. `U` = unión (par) de todos los `C(t)`; `crop=U` una sola vez.
  3. `scale=w='Σ':h='Σ':eval=frame`, con tamaño `round(U·s)`.
  4. Base de tamaño fijo `Lw×H`, con `Lw` = ancho máximo de la columna en el bloque: `color` negro, o `blurCover(Lw,H)` si algún fotograma no llena la celda.
  5. `overlay=x='Σ':y='Σ':eval=frame:shortest=1`:
     - `x = (w − C.w·s)/2 − (C.x − U.x)·s`;
     - `y = (H − C.h·s)/2 − (C.y − U.y)·s`.

  La ventana visible de la capa es `[0, w(t))` ("anclada a la izquierda"). Si `w < aMin·H` (columna que desaparece), se usa el recorte en `aMin` a altura `H`, recortado por la ventana.
- **Columna**:
  - capas del mismo tamaño encadenadas con `xfade=transition=<tipo>:duration=D:offset=<inicio local − inicio de la columna>`;
  - si la columna empieza dentro del bloque, `setpts=PTS+o/TB`.
- **Lienzo**:
  1. `color=c=<gap.color>:s=WxH:r=F:d=<dur>`.
  2. Columnas **de izquierda a derecha** con `overlay=x=<x o Σ>:y=0:eof_action=pass`.
  3. Si hay animación y separación, las barras de separación en `x = max(x_i + w_i, x_{i+1} − gap)` de cada columna menos la última (T16).
  4. Rellenos: `split` de la columna adyacente → `blurCover(ancho,H)`, o `color` si `fill.mode = 'color'` → `format=yuva420p,fade=t=in:…:alpha=1` si aparece → `overlay`.
  5. `fade=t=in` / `fade=t=out` global con `st` local al bloque (primer y último bloque).
  6. `format=yuv420p`.
- **Expresiones por fotograma**:
  - valores muestreados por fotograma y escritos como suma de escalones `v0+Δ1*gte(t,T1)+…`, con `T = (m − 0,5)/F`;
  - se omiten los tramos constantes; si no hay cambios, se escribe el número tal cual;
  - **nunca `if()` anidado**.
- **Salida del bloque**: `-map [vout] -frames:v <N> -c:v libx264 -preset P -crf C -pix_fmt yuv420p -r F -an bloque-XXX.mp4`.

### Esqueleto del grafo: ejemplo real comentado

- **Script**: [`script/videomix/spike/example-anim-chunk.sh`](../../../script/videomix/spike/example-anim-chunk.sh). Es ejecutable con los medios de T02 y produce el mismo vídeo, bit a bit, que el generador del spike.
- **Plan**:
  - 2 columnas;
  - en `t = 2` la columna 1 pasa de `h-1080p` a `h-720p-25fps` con `xfade`;
  - a la vez, la fila pasa de 632|1280 a 776|1136 en 0,5 s; el vertical de la columna 0 hace zoom.
- **Bloques**: `[0,2)` estable, `[2,2.5)` animación y `[2.5,4)` estable; después el audio y la unión.

Bloque de animación, con las expresiones abreviadas (`$VW`… son sumas de 15 escalones):

```
# columna 0 (vertical, zoom): crop fijo de la unión U → scale por fotograma → overlay sobre base fija 776×1080
[0:v]setpts=PTS-0.1/TB,fps=30:start_time=0,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=15,setpts=PTS-STARTPTS,
     crop=1080:1848:0:36,scale=w='$VW':h='$VH':eval=frame:flags=bicubic,setsar=1[sc0];
color=c=black:s=776x1080:r=30:d=0.5[base0];
[base0][sc0]overlay=x=0:y='$VY':eval=frame:shortest=1[col0];
# columna 1: clip saliente y entrante, cada uno como capa de 1282×1080 (ancho máximo de la columna) → xfade
[1:v]setpts=PTS-0.1/TB,fps=30:start_time=0,…,crop=1280:1080:320:0,scale=1280:1080,setsar=1[sc1];
color=c=black:s=1282x1080:r=30:d=0.5[base1];
[base1][sc1]overlay=x='$GX':y=0:eval=frame:shortest=1[l1];
[2:v]fps=30:start_time=0,…,crop=856:720:212:0,scale=1284:1080,setsar=1[sc2];
color=c=black:s=1282x1080:r=30:d=0.5[base2];
[base2][sc2]overlay=x='$FX':y=0:eval=frame:shortest=1[l2];
[l1][l2]xfade=transition=fade:duration=0.5:offset=0[col1];
# lienzo (color de separación) → columnas de izquierda a derecha en x(t) → barras de separación encima
color=c=0x303030:s=1920x1080:r=30:d=0.5,format=yuv420p[cv0];
[cv0][col0]overlay=x=0:y=0:eof_action=pass[cv1];
[cv1][col1]overlay=x='$C1X':y=0:eval=frame:eof_action=pass[cv2];
color=c=0x303030:s=8x1080:r=30:d=0.5[gap0];
[cv2][gap0]overlay=x='$GAPX':y=0:eval=frame,format=yuv420p[vout]
```

Un bloque estable es el mismo esquema sin expresiones:

```
[i:v]<cabecera>,crop=<C>,scale=<w>:H,setsar=1[cN];
color=<gap>[cv];
[cv][c0]overlay=x=<x0>:y=0[…];
…
```

Si hay sustituciones dentro del bloque, se encadenan `xfade` con su `offset`.

### Partición en bloques

1. **Intervalos ocupados**:
   - `[inicio, inicio + D]` de cada colocación con `startTime > 0` (su `xfade`);
   - `[time, time + transitionDuration]` de cada `LayoutKeyframe` animado;
   - `[time − D, time]` de cada keyframe instantáneo que añade relleno (fundido).
2. Se fusionan los solapados o contiguos.
3. **Cortes obligatorios** en el inicio y el fin de cada intervalo fusionado que contenga una animación. Dentro de un bloque estable los anchos son constantes: `xfade` exacto con cualquier tipo, y camino estático, que es más barato.
4. **Cortes opcionales**: los tramos estables de más de `maxChunk` (15 s) se parten en el último fotograma libre (fuera de intervalos ocupados) que no pase de `desde + 15 s`.
5. **Todo en fotogramas**: `f = round(t·F)`. Los bloques son `[f0, f1)` y el vídeo tiene exactamente `round(duration·F)` fotogramas.

En el plan de 2 min salen 20 bloques: 7 de 0,5 s o poco más (animaciones) y el resto de 3–15 s.

### Progreso, cancelación y reanudación

- **Progreso** en fotogramas: `(Σ fotogramas de bloques terminados + Σ frame= de los bloques en curso) / fotogramas totales`.
  - `frame=` se lee de `-progress pipe:1`, reutilizando `runFfmpegWithProgress`.
  - Opcional: sumar a cada bloque un coste fijo equivalente a ~30 fotogramas por el arranque y el `-ss`, que pesa en los bloques cortos.
- **Pasos finales**: el audio y el concat son < 2 % del total; se muestran como un paso final.
- **Cancelación**: se matan los procesos en curso (`abortFfmpegs`) y se borran los bloques incompletos.
- **Reanudación y cache** (opcional en T13): nombre de bloque = hash de su grafo, entradas y parámetros de codificación. Si el fichero existe y está completo, no se vuelve a renderizar.

### Previsualización

Mismo camino con W×H de previsualización (640×360), `ultrafast` y CRF alto. El plan y la geometría se calculan para esa resolución (no es un reescalado de la salida). No medido en el spike; se espera ≥ 5× más rápido, porque manda x264.

## Consecuencias

- **T11** implementa, como funciones puras con tests:
  - `getRenderChunks(plan, settings)`;
  - `buildVideoGraph(plan, clips, sources, settings, chunk)` → `{ inputs, filterComplex, frames }`.

  El prototipo `renderSpike.ts` (`getChunks`, `buildVideoGraph`, `columnsAt`, `fillsAt`, `stepExpr`, `blurCover`) es la referencia. `example-anim-chunk.sh` es el caso comentado.
  - Debe usar el `geometry.ts` real. El spike lleva una copia mínima de `getCropForAspect` porque Node no resuelve imports sin extensión.
- **T10** (invariantes del plan que el render necesita):
  - **durante una animación, las columnas conservan su orden** de izquierda a derecha (el apilado depende de él);
  - una columna que aparece o desaparece lo hace con ancho 0 pegada a su vecina derecha, y su clip termina o empieza con la animación;
    - Regla exacta (T10b): en el extremo donde falta, la columna tiene ancho 0 y `x` = `x` de la primera columna posterior que existe en ambos keyframes − `gap` (o `W + gap` si no hay ninguna; hasta T16 era `W`, que con separación > 0 y un relleno derecho hacía asomar una barra de separación en un fotograma). Está en `getAnimatedColumn` (`planner/validatePlan.ts`).
    - El planificador crea las columnas nuevas justo a la derecha de la columna liberada (crecen desde su borde derecho) y nunca añade y quita columnas en la misma animación, así que es compatible. `validatePlan` comprueba ambas invariantes (orden estable y ausencia de solapes con esta regla).
  - las transiciones que coinciden con una animación empiezan dentro de ella, o se fusionan en el mismo intervalo;
    - Esto incluye el fundido al relleno del final del vídeo (`ColumnPlacement.transitionOut`, T10b), que ocupa `[endTime − transitionOut, endTime]` y se trata como un intervalo ocupado más.
  - las columnas de un bloque estable empiezan en su inicio (en `t = 0` o al acabar una animación).
- **T12**: audio en pasada única (`-vn`), mezclado con `-c copy` al unir.
- **T13**:
  - ejecución por bloques con concurrencia 2;
  - progreso por fotogramas;
  - grafo en fichero temporal;
  - limpieza de los temporales.
- **Limitaciones aceptadas**:
  - En una sustitución que coincide con un re-layout, los tipos de `xfade` con geometría (`wipe*`, `slide*`, `smooth*`, `circleopen`) se calculan sobre la capa `Lw = max(w0, w1)` y no sobre `w(t)`: el frente del barrido llega al borde visible un poco antes o después. `fade`, `dissolve` y `fadeblack` son exactos. En bloques estables todos son exactos.
  - Cuantización de 2 px en posiciones y tamaños durante la animación (invisible con el contenido en movimiento).
  - **Coste fijo por bloque** (arranque, `-ss` desde el keyframe, *lookahead* de x264), notable con fuentes de GOP largo. Se compensa con la concurrencia. Si hiciera falta, se pueden alargar los bloques de animación (p. ej. `[t−1 s, t+D+1 s]`) usando el camino de capa en toda la columna, a cambio de la limitación anterior de las transiciones.
  - **Memoria**: ~1 GB por proceso a 1080p con 3–4 columnas. A 2160p se espera ~4×, así que la concurrencia es 1.
  - **Velocidad** en esta VM de 4 núcleos con preset medium: ~0,28× tiempo real (2 min de vídeo ≈ 7 min) con fuentes muy ruidosas. `veryfast` o los encoders por hardware (futuro) lo reducen mucho.
- **Descartado**:
  - grafo único para el render final: más memoria, crece con el número de clips, límite de expresiones, no hay reanudación, barridos inexactos cuando los anchos varían;
  - `xstack`;
  - máscaras `geq`;
  - `crop`/`sendcmd` con tamaño variable;
  - composición por fotograma (queda documentada como plan B).
