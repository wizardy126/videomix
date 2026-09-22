# 04 · Diseño técnico

Este documento describe **cómo** se implementan los requisitos de [01-requisitos.md](01-requisitos.md).

- Las decisiones que se tomen durante la ejecución se registran en `docs/videomix/decisiones/ADR-XXX-*.md` y se enlazan aquí.
- Las partes marcadas como **(provisional)** dependen de un ADR pendiente.

## 1. Modelo de datos

Ubicación: `src/renderer/src/videomix/types.ts`, o `src/common/videomix/types.ts` si main también lo necesita.

### 1.1 Coordenadas

- Los rectángulos se expresan en **píxeles de la fuente, ya orientada para su visualización**: tras aplicar la rotación de metadatos, como la muestra el `<video>` y como la decodifica ffmpeg con autorotate, que es su comportamiento por defecto.
- Se guardan como números enteros y se normalizan a valores pares al generar el grafo, porque yuv420p lo exige.

```ts
interface Rect { x: number, y: number, width: number, height: number }
```

### 1.2 Proyecto (`.vmx`, JSON5, zod)

```ts
interface MixSource {
  id: string,              // nanoid
  path: string,            // ruta relativa al fichero .vmx (o absoluta si el proyecto no está guardado)
  absolutePath: string,    // respaldo si la relativa no existe
  name: string,            // basename para mostrar
  // cache informativa (se refresca al abrir)
  width?: number | undefined, height?: number | undefined, duration?: number | undefined,
}

interface MixClip {
  id: string,              // nanoid; se usa también como segId en el timeline
  sourceId: string,
  name: string,
  color: number,           // índice de la paleta de colores de segmentos (como segColorIndex)
  start: number,           // segundos en la fuente
  end: number,
  maxRect: Rect,
  minRect?: Rect | undefined,   // opcional; si falta, mín = máx
  muted: boolean,
  gainDb: number,          // ganancia manual adicional (0 por defecto)
}

type TransitionType = 'fade' | 'dissolve' | 'fadeblack' | 'wipeleft' | 'wiperight' | 'wipeup' | 'wipedown'
  | 'slideleft' | 'slideright' | 'slideup' | 'slidedown' | 'smoothleft' | 'smoothright' | 'smoothup' | 'smoothdown' | 'circleopen';

interface MixSettings {
  resolution: '720p' | '1080p' | '2160p',   // 1080p
  fps: 24 | 25 | 30 | 50 | 60,              // 30
  crf: number,                              // 20
  preset: 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow',  // medium
  maxColumns: number,                       // 3
  gap: { width: number, color: string },    // { 0, '#000000' }
  reorderWindow: number,                    // 3
  order: { mode: 'list' | 'random', seed: number },
  transition: { type: TransitionType, duration: number },  // fade, 0.5
  fadeInOut: boolean,                       // true
  fill: { mode: 'blur' | 'color', color: string },          // blur, '#000000'
  music?: { path: string, absolutePath: string, volumeDb: number, loop: boolean } | undefined,
}

interface MixProject {
  version: 1,
  sources: MixSource[],
  clips: MixClip[],        // el orden del array es el orden de la lista
  settings: MixSettings,
  // cache de análisis de sonoridad, por clave (ver §5.1)
  loudnessCache?: Record<string, LoudnessMeasurement> | undefined,
}
```

**Reglas de validación** (zod más funciones puras):
- `0 ≤ start < end ≤ duración de la fuente`.
- `maxRect` dentro del fotograma de la fuente.
- `minRect ⊆ maxRect`.
- Anchos y altos ≥ 16 px.
- Duración del clip > 2 × duración de la transición. Si no se cumple, se avisa y la transición de ese clip se acorta.

Los esquemas llevan `version` para migraciones futuras, igual que `llcProjectV1Schema` / `V2`.

## 2. Geometría (pura)

Fichero `src/renderer/src/videomix/geometry.ts`. Sea `M` el rectángulo máx., `m` el mín. (`m = M` si no hay mín.) y `H` la altura del fotograma de salida.

### 2.1 Intervalo de proporciones de un clip

Un recorte `C` con proporción `a = C.w / C.h` es válido si `m ⊆ C ⊆ M`:

- `C.h ≥ m.h`, `a·C.h ≥ m.w`, `C.h ≤ M.h`, `a·C.h ≤ M.w`.
- Existe si y solo si `a ∈ [aMin, aMax]`, con **`aMin = m.w / M.h`** y **`aMax = M.w / m.h`**.
- **Proporción preferida**: `aPref = M.w / M.h` (se muestra todo el máx.), que siempre está dentro del intervalo.

### 2.2 Recorte para una proporción dada

Para una celda de proporción `a` dentro de `[aMin, aMax]`:

- **Tamaño**: se elige la altura máxima, para mostrar lo máximo posible: `C.h = min(M.h, M.w / a)` y `C.w = a·C.h`.
- **Posición**: se centra en el centro de `m` y se desplaza lo mínimo para que `C ⊆ M` (entonces contiene a `m` por construcción).

Si `a` está fuera del intervalo, el clip no puede llenar la celda:

- **`a > aMax`**: se usa `a = aMax`. El recorte se escala a la altura `H` y se centra en horizontal; los laterales se rellenan (fill).
- **`a < aMin`**: se usa `a = aMin`. El recorte se escala al ancho de la celda y se centra en vertical; arriba y abajo se rellenan.

El planificador intenta evitar estos casos, pero el generador debe soportarlos.

**Escalado**: `factor = H / C.h`, o `anchoCelda / C.w` en el caso letterbox. Si `factor > 2`, se avisa en la UI.

### 2.3 Reparto de anchos de una fila

- Datos: clips `i = 1..n` con intervalos `[aMin_i, aMax_i]` y `aPref_i`, y el ancho útil `Wu = W − (n−1)·gap`. En unidades de proporción, `T = Wu / H`.
- **Factible sin relleno** si y solo si `Σ aMin_i ≤ T ≤ Σ aMax_i`.
- **Reparto**: se parte de `aPref_i` y se reparte la diferencia `T − Σ aPref_i` (*water-filling*) proporcionalmente al margen disponible de cada clip hacia `aMax` o hacia `aMin`, saturando los que llegan al límite.
- **Si `Σ aMax_i < T`**: cada clip toma `aMax_i` y el sobrante queda como relleno, repartido de forma centrada entre las columnas o en los extremos. Lo concreta el planificador.
- **Si `Σ aMin_i > T`**: la combinación no es válida. El planificador no debe generarla; como último recurso aplica letterbox.
- Los anchos finales se redondean a pares y se ajusta el último para que la suma cuadre exactamente. *(Sustituido en T03 por el reparto de §2.4.)*

### 2.4 Redondeo a pares (concretado en T03)

- **Rectángulos normalizados**: todo el cálculo usa el máx. encogido a bordes pares y el mín. agrandado a bordes pares e intersecado con ese máx. (`normalizeClipRects`). Si los rectángulos ya son pares, no cambian; si no, el mín. puede perder 1 px donde toca un borde impar del máx. El intervalo `[aMin, aMax]` se calcula sobre estos rectángulos.
- **Recorte**: `x`, `y`, ancho y alto siempre pares; el lado no limitado se redondea al par más cercano (error ≤ 1 px) y la posición se redondea dentro del intervalo par que garantiza `m ⊆ C ⊆ M`.
- **Tolerancia**: si la proporción pedida se sale del intervalo menos de un 1 % (`ASPECT_TOLERANCE`), el resultado sigue siendo `fill` con el recorte del límite, estirado de forma imperceptible, en lugar de dejar una franja de relleno de 1–2 px.
- **Reparto de anchos** en píxeles de salida: cada clip tiene límites pares `[ceilPar(aMin·H), floorPar(aMax·H)]` (`getWidthRange`); si el intervalo es tan estrecho que no contiene ningún par (p. ej. 9:16 rígido a 1080p = 607,5 px), se usa el par más cercano a `aPref·H`. El reparto proporcional al margen satura todos los clips a la vez, así que no hace falta iterar. Después se redondea en unidades de 2 px por **mayor resto**, respetando los límites, en vez de ajustar solo el último (que podría salirse de su intervalo).
- **Escalado**: `factor = min(anchoCelda / C.w, H / C.h)` cubre los tres casos (`getScaleFactor`).
- **Separación impar**: con un número impar de huecos entre columnas, el ancho útil es impar y queda 1 px de relleno; `validateMixProject` avisa (`odd-gap`).

## 3. Planificador de montaje (puro)

Carpeta: `src/renderer/src/videomix/planner/` (implementado en T10; detalles y justificación en [T10](execution/T10-planificador.md)).

- **Entrada** (`PlanMixInput`): la lista ordenada de `PlannerClip = { id, duration, aspectRange, rects? }` y `PlannerSettings = { width, height, maxColumns, gap, reorderWindow, order, transitionDuration }`. `getPlannerInput(project)` (`plannerInput.ts`) la construye desde `MixClip`/`MixSettings`; `rects` (máx./mín.) solo sirve para el aviso y la puntuación de upscale.
- **Salida**: `MixPlan` (`planMix`). `validatePlan(plan, input)` comprueba las invariantes de §3.2 y devuelve la lista de problemas; `planMix` la ejecuta en desarrollo (`import.meta.env.DEV`). `formatPlan(plan)` da una vista textual compacta.

### 3.1 Salida: `MixPlan`

```ts
interface ColumnPlacement {        // un clip reproduciéndose en una columna
  clipId: string,
  column: number,                  // identificador estable de columna (no su índice visual)
  startTime: number,               // en el vídeo final (s)
  endTime: number,                 // startTime + duración del clip
  transitionIn: number,            // xfade con el clip anterior de la columna (0 si es el primero); ≤ D
}

interface LayoutKeyframe {         // disposición de la fila a partir de un instante
  time: number,                    // inicio del cambio
  transitionDuration: number,      // 0 = cambio instantáneo; >0 = animación lineal desde el keyframe anterior
  columns: { column: number, x: number, width: number }[],  // en píxeles de salida, izquierda→derecha
  fills: { x: number, width: number }[],                    // relleno estructural (la fila no llega a W)
}

type PlanWarning =
  | { type: 'upscale', clipId, factor }                 // factor máximo > 2 (necesita rects)
  | { type: 'pillarbox' | 'letterbox', clipId, time }   // la columna no encaja con el clip
  | { type: 'transition-shortened', clipId, duration }  // xfade de entrada < D
  | { type: 'fill', time, width };                      // keyframe con relleno estructural > 1 px

interface MixPlan {
  width: number, height: number, duration: number,
  placements: ColumnPlacement[],   // en orden de elección, que coincide con el orden de inicio
  layouts: LayoutKeyframe[],       // ordenados por tiempo; el primero en t=0; nunca se solapan
  warnings: PlanWarning[],
}
```

**Semántica de los keyframes** (contrato con T11/T15):

- Entre `time` y `time + transitionDuration` los `x`/anchos pasan linealmente del keyframe anterior a este; después quedan fijos hasta el siguiente keyframe.
- Una columna que **no estaba** en el keyframe anterior es nueva: crece desde ancho 0 y su primer clip empieza justo en `time` (sin xfade).
- Una columna que **desaparece** encoge hasta 0 y su último clip termina justo en `time + transitionDuration`.
- Las columnas contiguas están separadas exactamente por `gap`; el relleno estructural se reparte a izquierda y derecha (bloque de columnas centrado, la parte izquierda par) y toca a sus vecinos sin separación.
- **Final** (§4.3 de requisitos): cuando ya han empezado todos los clips, una columna cuyo clip termina **sigue en el layout sin clip**; su área se muestra como relleno y no se añade ningún keyframe (no hay re-layout ni re-expansión).
- Durante una animación, el clip saliente de la columna que la dispara (y el de una columna de un evento fusionado) se muestra con anchos distintos a los suyos: el generador lo recorta con `getCropForAspect` (que devuelve pillarbox/letterbox si hace falta).
- Se elimina `crops` del diseño original: el generador recalcula los recortes con `getCropForAspect(maxRect, minRect, width / H)`.

### 3.2 Reglas: invariantes que los tests deben verificar

1. **Todos los clips aparecen exactamente una vez**, enteros: `endTime − startTime = duración del clip`.
2. **Nunca hay más de `maxColumns` columnas visibles**, tampoco durante una animación (unión de las columnas de los dos keyframes).
3. En cada keyframe, columnas + huecos entre columnas + relleno cubren `[0, W]` sin solaparse.
4. **Sustitución en columna**: el clip entrante empieza `transitionIn` antes de que termine el saliente, con `transitionIn = min(D, saliente/2, entrante/2)` (se acorta además en los casos límite descritos en §3.3). Ese solape es el xfade.
5. **El orden solo se altera dentro de la ventana `reorderWindow`**: ordenando por `startTime` (empates por índice), ningún clip queda a más de N posiciones de su índice en la lista base. En modo aleatorio, la lista base es la permutación determinista de la semilla.
6. **Inicio**: todas las columnas iniciales empiezan en `t = 0`; las columnas nuevas empiezan en el `time` de su keyframe.
7. **Final**: no hay keyframes después del inicio del último clip; una columna que queda sin clip no desaparece (salvo si la quitó un re-layout justo cuando terminaba su último clip).
8. **Determinismo**: la misma entrada produce el mismo plan.

Además: los keyframes no se solapan (`time ≥ anterior.time + anterior.transitionDuration`) y `transitionDuration ≤ D`.

### 3.3 Algoritmo (implementado)

Simulación por eventos "termina el clip de una columna". `D` = duración de la transición; `p` = siguiente posición en el orden de reproducción.

1. **Ventana de orden**. Un conjunto de clips elegidos (en orden de índice base) ocupa las posiciones `p, p+1, …`; es válido si cada uno queda a ≤ N de su índice y el primer clip no elegido todavía cabe en su ventana (`p + m ≤ base + N`). Con esa comprobación siempre hay al menos una opción válida: tomar el primer clip pendiente.
2. **Fila inicial**: se evalúan todos los subconjuntos de 1..`maxColumns` candidatos de la ventana, se reparten con `distributeWidths` y se elige el de menor puntuación. Un clip solo que no cabe ni con su mín. se pone a ancho completo con letterbox.
3. **Evento** en `e` (fin del clip de la columna `c`; empates por posición visual):
   1. **Sustitución directa**: el primer candidato en orden de la ventana cuyo intervalo admite el ancho de `c` (con la tolerancia `ASPECT_TOLERANCE`). Entra con `transitionIn` y no cambia el layout. Tiene prioridad absoluta, como piden los requisitos.
   2. Si no hay ninguno, se puntúan y se elige la mejor de:
      - **en su sitio con relleno**: un candidato en el ancho actual de `c`, con pillarbox o letterbox;
      - **re-layout "sustituir"**: `c` recibe un candidato y, si caben, se añaden columnas nuevas a su derecha (todas las combinaciones de la ventana, lo que cubre las opciones a, b y d del diseño original);
      - **re-layout "quitar"**: `c` desaparece y las demás se reparten el ancho (opción c).

      El keyframe empieza cuando empieza el xfade del clip entrante en `c` (o `e − min(D, saliente/2)` si se quita) y dura lo mismo que ese xfade. Si el reparto deja todos los anchos iguales, no se genera keyframe.
   3. **Eventos fusionados**: si hay re-layout, las columnas cuyo clip termina antes de `e + D` (o a la vez) se deciden en la misma opción: reciben su clip entrante (que empieza cuando le toca) y su ancho sale del mismo reparto. Así ninguna animación se solapa con otra. Solo pueden quedarse sin clip si con esa decisión se acaban los clips.
   4. **Orden de inicio monótono**: el xfade se acorta si hace falta para que ningún clip empiece antes que el último elegido, y una opción se descarta si algún clip de la fila terminaría antes del último inicio. Así el orden de elección coincide con el de inicio. Un re-layout tampoco puede empezar antes de que acabe la animación anterior (se acorta su xfade o se descarta la opción).
4. **Cola vacía**: las columnas se van quedando sin clip y su área es relleno; no hay más keyframes.

**Poda y complejidad**: por evento se evalúan como mucho `SUBSET_BUDGET` = 1000 subconjuntos (la lista de candidatos se recorta, conservando los más antiguos, que son los que la ventana obliga a tomar). Cada evaluación cuesta `O(maxColumns)` más `distributeWidths`. Total `O(clips × 1000 × maxColumns)` en el peor caso; 200 clips con `maxColumns` = 6 y ventana 10 se planifican en unos 100 ms.

### 3.4 Puntuación (menor es mejor; constantes en `planMix.ts`)

| Término | Peso | Cálculo |
|---|---|---|
| Relleno de la fila | `FILL_WEIGHT` = 60 | fracción de `W` × segundos; se cuenta hasta que termina el primer clip que sigue en la fila, con un máximo de `ROW_FILL_SECONDS` = 5 s |
| Pillarbox / letterbox de un clip | `FILL_WEIGHT` | área equivalente en ancho × duración del clip; letterbox suma además `LETTERBOX_WEIGHT` = 10 |
| Re-layout | `RELAYOUT_WEIGHT` = 3 | por re-layout que cambia anchos |
| Orden | `ORDER_WEIGHT` = 1 | por posición de desplazamiento de cada clip elegido |
| Recorte respecto a `aPref` | `PREF_WEIGHT` = 4 | por columna, fracción del máx. que no se ve (`1 − min(a/aPref, aPref/a)`) |
| Upscale > ×2 | `UPSCALE_WEIGHT` = 5 | por columna, por unidad de factor por encima de 2 (estimado con los rects) |
| Columnas fuera de 2–3 | `COLUMN_COUNT_WEIGHT` = 0,5 | por columna de distancia |

Escala orientativa: 1 % de relleno durante 5 s ≈ un re-layout ≈ 3 posiciones de desorden.

### 3.5 Aleatoriedad

`random.ts`: PRNG mulberry32 con semilla y barajado Fisher-Yates determinista (`getBaseOrder`). No se usa `Math.random`.

## 4. Render de vídeo con ffmpeg (provisional → ADR-001)

El **spike T09** decidirá la estrategia concreta y la documentará en `decisiones/ADR-001-render.md`. Las restricciones y la propuesta de partida son estas.

### 4.1 Restricciones

- Salida `libx264` + AAC en MP4, `yuv420p`, `-r fps`, resolución `W×H`.
- Cada clip se lee con `-ss start -t dur -i path`, o bien con el filtro `trim`.
- La cadena de cada clip: `fps` → `crop` → `scale` → `setsar=1` → `format`.
- **Sustitución en columna**: `xfade` con el tipo global. Requiere que ambas entradas tengan el mismo tamaño, algo que se cumple cuando no hay re-layout simultáneo.
- **Re-layout animado**: los anchos varían durante `D` segundos. `crop` y `scale` no cambian de tamaño de salida por frame de forma fiable. Alternativas a evaluar en el spike:
  - (a) Capas del ancho máximo durante la animación, `overlay` con `x` en función de `t` y ocultación por orden de apilado o máscara (`alphamerge` / `geq`).
  - (b) `crop` con expresiones `x(t)` sobre capas más anchas + `overlay`.
  - (c) Render por tramos: los tramos estables con layout fijo y el tramo de animación a frames interpolados.
  - (d) Si nada es viable o es demasiado lento: **fallback** a la transición global de fotograma completo entre layout viejo y nuevo. Habría que consultarlo con el usuario, porque eligió la animación.
- **Relleno con desenfoque**: la copia del clip adyacente se escala para cubrir, pasa por `boxblur`/`gblur` y se recorta al hueco. En letterbox, la copia es del propio clip.
- **Separación** (gap): lienzo `color=c=<gap.color>:s=WxH` de fondo y columnas con `overlay` en su `x`.
- **Fade inicio/fin**: `fade=t=in` / `fade=t=out` sobre el resultado final (y `afade` en el audio).
- **Rendimiento**: un solo `filter_complex` con decenas de entradas puede ser lento o consumir mucha memoria. Hay que evaluar el **render por bloques** (cortes en instantes sin transiciones activas), con los bloques concatenados mediante el concat demuxer sin recodificar. Esto además da progreso por bloque y permite reanudar.

### 4.2 Módulos

- **`render/buildVideoGraph.ts`** (puro): recibe `MixPlan`, clips y fuentes y devuelve `{ inputs: string[][], filterComplex: string, maps: string[] }`, o un array de bloques.
- **`render/buildAudioGraph.ts`** (puro): ver §5.
- **`render/buildRenderArgs.ts`** (puro): compone los argumentos finales de ffmpeg.
- **Ejecución**: `runFfmpegWithProgress` (main) con la duración total, o por bloques, más `concat`.
- **Tests**: snapshots de argumentos para planes de ejemplo e invariantes, como que las etiquetas del grafo están todas conectadas y que ningún `crop` se sale del frame. Además, un test opcional con ffmpeg real si está disponible, que se omite si no.

## 5. Audio

### 5.1 Análisis de sonoridad

- **Nueva función en main** (`src/main/videomix/loudness.ts`, expuesta como `ffmpeg`/`videomix` en `remoteApiLegacy`):

  ```
  ffmpeg -hide_banner -ss <start> -t <dur> -i <path> -map 0:a:0 -af loudnorm=I=-23:TP=-2:LRA=11:print_format=json -f null -
  ```

  Parsea el bloque JSON de stderr (`input_i`, `input_tp`, `input_lra`, `input_thresh`).
- **Clave de cache**: `sha1(absolutePath + mtime + size + start + end)`. Se guarda en `loudnessCache` del proyecto.
- **Clips sin pista de audio**: `hasAudio: false`, y se excluyen de la mezcla.
- **Silencio** (`input_i = -inf`): se trata como sin audio.

### 5.2 Mezcla

1. **Por clip**:
   - `atrim` o `-ss/-t`;
   - `aresample=48000`, `aformat=channel_layouts=stereo`, reutilizando `getFixChannelLayoutFilter` para layouts raros;
   - `volume=<gananciaNormalización + gainDb>dB`, con `gananciaNormalización = objetivo − input_i` (objetivo **−16 LUFS**): la segunda pasada es una ganancia lineal y estática, y evita el bombeo;
   - `afade=t=in:d=D` y `afade=t=out:st=dur−D:d=D`;
   - `adelay` hasta su `startTime`.
2. **Suma**: `amix=inputs=N:normalize=0:duration=longest`.
3. **Compensación de simultaneidad**: ganancia por tramos `volume='…':eval=frame` en función de `n(t)`, el número de clips con audio sonando. El valor es `−10·log10(n)` dB, con rampas de duración `D`. Alternativamente, se aplica por clip. La implementación puede elegir y lo documenta.
4. **Música**:
   - `-stream_loop -1` si `loop`, y `atrim` a la duración total;
   - `volume=volumeDb`;
   - `afade=t=out` final de 2 s o `D`, el mayor;
   - `amix` con la mezcla de clips.
5. **Salida**: `alimiter` para evitar el clipping y `afade` in/out global si `fadeInOut`. AAC 192 kbps, 48 kHz, estéreo.

## 6. Interfaz y flujo

### 6.1 Layout de la ventana (modo VideoMix)

```
┌ TopMenu (proyecto: Nuevo/Abrir/Guardar, Montar, Ajustes de montaje) ─────────────┐
│ Fuentes │            Player + overlay de rectángulos            │  Clips (todos)   │
│ (lista) │                                                       │  dnd, nombre,    │
│         │                                                       │  color, mute, dB │
├─────────┴──────────── Timeline de la fuente activa ─────────────┴──────────────────┤
│ BottomBar (controles de reproducción, marcar inicio/fin, "Añadir clip")             │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

La vista **Timeline del montaje** (plan) es una pestaña o panel alternativo al timeline de la fuente activa.

### 6.2 Proyecto y fuentes

- **`useMixProject`** (hook nuevo, en `App.tsx` **por encima** de `resetState`, de modo que no se borre al cambiar de fuente):
  - Estado `MixProject` con historial (undo/redo), `projectPath` y `dirty`.
  - Acciones CRUD de fuentes, clips y ajustes.
- **Activar una fuente**: se reutiliza `loadMedia({ filePath })`, pero en modo VideoMix:
  - no se carga ni se autoguarda `.llc`;
  - no se importan capítulos;
  - no se pregunta por la acción de apertura.

  Hay que aislarlo con un flag o parámetro mínimo en los puntos de `App.tsx` afectados.
- **Añadir ficheros** (arrastrar o diálogo) los añade como fuentes; no los abre como fichero único.
- **Guardar / Abrir** `.vmx` con los diálogos de remote (patrón de `edlStore.ts`).
- **Recuperación**: autoguardado con debounce en `userData/videomix-recovery/<sessionId>.vmx-recovery` (ver T04). Al arrancar, si existe uno más reciente que el guardado, se ofrece recuperarlo.
- **Fuentes que faltan**: se prueba la ruta relativa, luego la absoluta y, si ninguna existe, se pide al usuario que la localice.

### 6.3 Clips ↔ segmentos (recomendación; lo concreta T07)

- **Fuente de verdad**: `MixProject.clips`.
- **Al activar una fuente**: `loadCutSegments` con los clips de esa fuente, usando `segId = clip.id`.
- **Al cambiar los segmentos en el timeline**: los cambios de inicio/fin se sincronizan hacia los clips (mapeo por `segId`).
- **"Añadir clip"**: crea un segmento y un clip. El rectángulo por defecto es el fotograma completo.
- **Undo/redo**: se unifica en el historial del proyecto. Los atajos `undo`/`redo` en modo VideoMix apuntan al proyecto.
- **Alternativa aceptable**, si la sincronización bidireccional resulta frágil: el timeline muestra los clips de la fuente activa como segmentos derivados y las ediciones se hacen con acciones del proyecto. La decisión se documenta en un ADR.

### 6.4 Overlay de rectángulos

- **Posición**: un componente absoluto sobre el `<video>` que calcula el rectángulo real de la imagen dentro del elemento (`object-fit: contain`: escala `min(cw/vw, ch/vh)` y *offset* centrado). Convierte entre coordenadas de pantalla y de la fuente.
- **Dibujo**: SVG con dos rectángulos (máx. en el color del clip, sólido; mín. discontinuo) y 8 tiradores cada uno. Arrastrar dentro de un rectángulo lo mueve.
- **Restricciones al editar**: `min ⊆ max ⊆ frame` y tamaño mínimo de 16 px.
- **Información**: el tamaño en px de la fuente, la proporción y la orientación (horizontal/vertical).
- **Proporciones fijas**: al crear o editar, se ofrecen presets de proporción (libre, 9:16, 3:4, 1:1, 16:9) para el máx.
- **Compatibilidad**: el overlay funciona con el reproductor compat (`MediaSourcePlayer`) y con la rotación (las coordenadas en espacio orientado).

### 6.5 Lista de clips

- **Todos los clips del proyecto**, virtualizados y reordenables con dnd-kit (patrón de `SegmentList`).
- **Cada fila muestra**:
  - miniatura (captura del frame de inicio recortada al máx.);
  - nombre (editable) y color;
  - fuente;
  - duración;
  - icono de orientación;
  - mute y ganancia en dB;
  - avisos (clip corto, upscale).
- **Seleccionar un clip**: activa su fuente (si no lo está), hace seek a `start` y muestra sus rectángulos en el overlay.
- **Acciones**: duplicar, eliminar, "ir a la fuente".

### 6.6 Montaje, previsualización y render

- **Diálogo "Ajustes de montaje"** con todos los `MixSettings`.
- **"Previsualizar"**:
  1. Se calcula el plan y se muestra el *Timeline del montaje*: carriles por columna a lo largo del tiempo, bloques con el color o nombre del clip, marcas de re-layout y zonas de relleno.
  2. Se renderiza a baja resolución (640×360, `ultrafast`, CRF alto) en un fichero temporal.
  3. Se reproduce en un diálogo.
- **"Montar"**:
  1. Se elige el fichero de salida.
  2. Se analiza la sonoridad (con progreso y cache).
  3. Se renderiza (con progreso y cancelación, reutilizando `setWorking` / `abortFfmpegs`).
  4. Se muestra el diálogo de fin (abrir carpeta).

## 7. Integración con el código existente (resumen de puntos de contacto)

| Fichero existente | Cambio previsto |
|---|---|
| `package.json` | `name`, `productName`, `appId`, `description` y `build` |
| `src/main/index.ts` | Exponer las funciones de `src/main/videomix/*` en `remoteApiLegacy`; nombre de la app y del directorio de config |
| `src/main/menu.ts` | Menú Proyecto (Nuevo, Abrir, Guardar, Guardar como, Montar, Previsualizar) |
| `src/common/types.ts` | Nuevas `KeyboardAction` de VideoMix, si hacen falta |
| `src/renderer/src/App.tsx` | Montar `useMixProject`, los paneles nuevos y el flag VideoMix en `loadMedia`/`userOpenFiles`/autosave |
| `hooks/useSegmentsAutoSave.ts` | Desactivado en VideoMix |
| `Timeline.tsx` / `SegmentList.tsx` | Sin cambios o mínimos; `SegmentList` queda sustituido por `ClipList` |
| `.github/workflows/build.yml` | Desactivado |
