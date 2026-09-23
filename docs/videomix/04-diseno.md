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
  version: 2,              // v1 (sin overlays) se migra al abrir, ver §8.1
  sources: MixSource[],
  clips: MixClip[],        // el orden del array es el orden de la lista
  settings: MixSettings,
  // cache de análisis de sonoridad, por clave (ver §5.1)
  loudnessCache?: Record<string, LoudnessMeasurement> | undefined,
  overlays: MixOverlay[],  // desde v2 (§8.1); el orden es el orden de capas
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

Carpeta: `src/renderer/src/videomix/planner/` (implementado en T10 y ajustado en T10b; detalles y justificación en [T10](execution/T10-planificador.md) y [T10b](execution/T10b-ajuste-planificador.md)).

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
  transitionOut?: number,          // (T10b) fundido al relleno al final del vídeo; ausente = 0 (ver abajo)
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

- Entre `time` y `time + transitionDuration` los `x`/anchos pasan con curva `smoothstep` (ver T11) del keyframe anterior a este; después quedan fijos hasta el siguiente keyframe.
- Una columna que **no estaba** en el keyframe anterior es nueva: crece desde ancho 0 y su primer clip empieza justo en `time` (sin xfade).
- Una columna que **desaparece** encoge hasta 0 y su último clip termina justo en `time + transitionDuration`.
- Las columnas contiguas están separadas exactamente por `gap`; el relleno estructural se reparte a izquierda y derecha (bloque de columnas centrado, la parte izquierda par) y toca a sus vecinos sin separación.
- **Colapso a ancho 0** (ADR-001): durante la animación, una columna que falta en uno de los dos keyframes está en ese extremo con ancho 0 y `x` = `x` de su vecina derecha (la primera columna posterior a ella que existe en ambos keyframes) − `gap`; si no tiene vecina derecha, `x = W + gap` (fuera del fotograma con su separación; T16). `getAnimatedColumn(layout, other, column, W, gap)` (`validatePlan.ts`) implementa esta regla y el render (`renderTimeline.ts`) usa la misma. Si durante la animación se abre un hueco mayor que `gap` entre dos columnas, el relleno de ese hueco toca a la columna izquierda y la separación queda pegada a la derecha; así, cuando la columna derecha está fuera (x ≥ W), ese relleno coincide con el relleno derecho y no aparece de golpe una barra de separación (T11, dudas). El planificador crea las columnas nuevas justo a la derecha de la columna liberada, así que crecen desde el borde derecho de esa columna: es compatible con la regla.
- **Orden estable** (ADR-001): las columnas presentes en los dos keyframes conservan su orden izquierda→derecha, y ninguna animación añade y quita columnas en el mismo sitio. Con la regla de colapso, ninguna columna se solapa con otra en ningún instante de la animación.
- **Final** (§4.3 de requisitos): cuando ya han empezado todos los clips, una columna cuyo clip termina **sigue en el layout sin clip**; su área se muestra como relleno y no se añade ningún keyframe (no hay re-layout ni re-expansión).
- **Fundido de salida al final** (T10b, `ColumnPlacement.transitionOut`): un clip que termina sin sucesor en su columna, cuya columna sigue en el layout (no la quita un re-layout) y que no termina con el vídeo hace un fundido **hacia el relleno** durante `[endTime − transitionOut, endTime]`, con el tipo de la transición global. `transitionOut = min(D, duración/2)`, igual que un xfade, así que nunca se solapa con su `transitionIn`. En los demás casos el campo no está (equivale a 0): con sucesor, el xfade es el `transitionIn` del siguiente; en una columna quitada, el clip encoge a 0; y el clip que termina con el vídeo queda cubierto por el fundido a negro global (§4.5 de requisitos). El fundido puede coincidir con una animación de otra columna (p. ej. en un evento fusionado): como con los xfades, T11 fusiona los intervalos en un mismo bloque de render.
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
9. **Orden estable durante una animación** (ADR-001, T10b): las columnas comunes a dos keyframes consecutivos están en el mismo orden.
10. **Colapso junto a la vecina derecha** (ADR-001, T10b): aplicando la regla de colapso de §3.1, ningún par de columnas se solapa en los extremos de la animación (y, como las posiciones son mezclas de los extremos, tampoco en medio).
11. **Fundido de salida** (T10b): `transitionOut` vale `min(D, duración/2)` exactamente en los clips descritos en §3.1 y 0 (o falta) en los demás.

Además: los keyframes no se solapan (`time ≥ anterior.time + anterior.transitionDuration`) y `transitionDuration ≤ D`.

### 3.3 Algoritmo (implementado)

Simulación por eventos "termina el clip de una columna". `D` = duración de la transición; `p` = siguiente posición en el orden de reproducción.

1. **Ventana de orden**. Un conjunto de clips elegidos (en orden de índice base) ocupa las posiciones `p, p+1, …`; es válido si cada uno queda a ≤ N de su índice y el primer clip no elegido todavía cabe en su ventana (`p + m ≤ base + N`). Con esa comprobación siempre hay al menos una opción válida: tomar el primer clip pendiente.
2. **Fila inicial**: se evalúan todos los subconjuntos de 1..`maxColumns` candidatos de la ventana, se reparten con `distributeWidths` y se elige el de menor puntuación. Un clip solo que no cabe ni con su mín. se pone a ancho completo con letterbox.
3. **Evento** en `e` (fin del clip de la columna `c`; empates por posición visual):
   1. **Sustitución directa**: el primer candidato en orden de la ventana cuyo intervalo admite el ancho de `c` (con la tolerancia `ASPECT_TOLERANCE`). Entra con `transitionIn` y no cambia el layout.
      - Si la fila **no tiene relleno estructural** (≤ 1 px), tiene prioridad absoluta (evita animaciones innecesarias).
      - Si la fila **tiene relleno** (T10b, "relleno antes que sustitución directa"), se puntúan los re-layouts del paso 2 que lo **reducen claramente** (dejan como mucho `CLEAR_FILL_REDUCTION` = 50 % del relleno actual, o ≤ 1 px) y no dejan ningún clip con pillarbox/letterbox. Si hay alguno, gana el mejor; si no, la sustitución directa.
   2. Si no hay sustitución directa, se puntúan y se elige la mejor de:
      - **en su sitio con relleno**: un candidato en el ancho actual de `c`, con pillarbox o letterbox;
      - **re-layout "sustituir"**: `c` recibe un candidato y, si caben, se añaden columnas nuevas a su derecha (todas las combinaciones de la ventana, lo que cubre las opciones a, b y d del diseño original);
      - **re-layout "quitar"**: `c` desaparece y las demás se reparten el ancho (opción c).

      El keyframe empieza cuando empieza el xfade del clip entrante en `c` (o `e − min(D, saliente/2)` si se quita) y dura lo mismo que ese xfade. Si el reparto deja todos los anchos iguales, no se genera keyframe.
   3. **Eventos fusionados**: si hay re-layout, las columnas cuyo clip termina antes de `e + D` (o a la vez) se deciden en la misma opción: reciben su clip entrante (que empieza cuando le toca) y su ancho sale del mismo reparto. Así ninguna animación se solapa con otra. Solo pueden quedarse sin clip si con esa decisión se acaban los clips.
   4. **Orden de inicio monótono**: el xfade se acorta si hace falta para que ningún clip empiece antes que el último elegido, y una opción se descarta si algún clip de la fila terminaría antes del último inicio. Así el orden de elección coincide con el de inicio. Un re-layout tampoco puede empezar antes de que acabe la animación anterior (se acorta su xfade o se descarta la opción).
4. **Cola vacía**: las columnas se van quedando sin clip y su área es relleno; no hay más keyframes. Al final, una pasada marca con `transitionOut` los clips que hacen fundido al relleno (§3.1).

**Poda y complejidad**: por evento se evalúan como mucho `SUBSET_BUDGET` = 1000 subconjuntos (la lista de candidatos se recorta, conservando los más antiguos, que son los que la ventana obliga a tomar). Cada evaluación cuesta `O(maxColumns)` más `distributeWidths`. Total `O(clips × 1000 × maxColumns)` en el peor caso; 200 clips con `maxColumns` = 6 y ventana 10 se planifican en unos 100 ms.

### 3.4 Puntuación (menor es mejor; constantes en `planMix.ts`)

| Término | Peso | Cálculo |
|---|---|---|
| Relleno de la fila | `FILL_WEIGHT` = 60 | fracción de `W` × segundos; se cuenta hasta que termina el primer clip que sigue en la fila, con un máximo de `ROW_FILL_SECONDS` = 5 s |
| Pillarbox / letterbox de un clip | `FILL_WEIGHT` | área equivalente en ancho × duración del clip; letterbox suma además `LETTERBOX_WEIGHT` = 10 |
| Re-layout | `RELAYOUT_WEIGHT` = 3 | por re-layout que cambia anchos |
| Orden | `ORDER_WEIGHT` = 1 | por posición de desplazamiento de cada clip elegido |
| Recorte respecto a `aPref` | `PREF_WEIGHT` = 4 hasta `MAX_CROP_LOSS` = 0,4; `EXCESS_CROP_WEIGHT` = 40 por encima | por columna, fracción del máx. que no se ve (`1 − min(a/aPref, aPref/a)`): `4 · min(p, 0,4) + 40 · max(0, p − 0,4)` |
| Upscale > ×2 | `UPSCALE_WEIGHT` = 5 | por columna, por unidad de factor por encima de 2 (estimado con los rects) |
| Columnas fuera de 2–3 | `COLUMN_COUNT_WEIGHT` = 4 | por columna de distancia |

Escala orientativa: 1 % de relleno durante 5 s ≈ un re-layout ≈ 3 posiciones de desorden.

**Criterio equilibrado de columnas** (T10b, requisitos §4.3): una fila de una sola columna cuesta 4, más que recortar dos clips hasta el umbral (2 × 0,4 × 4 = 3,2). Así se prefieren 2–3 columnas, estrechando los horizontales flexibles hacia su mín., salvo que haya que perder más de ~40 % del máx. de algún clip; entonces gana el clip a pantalla completa. Ejemplos a 1920×1080: un 16:9 flexible junto a un 9:16 se queda en 1312 px (pierde el 32 %) → 2 columnas; junto a un 1:1 rígido se quedaría en 840 px (pierde el 56 %) → pantalla completa; dos 16:9 a 960 px pierden el 50 % cada uno → pantalla completa.

### 3.5 Aleatoriedad

`random.ts`: PRNG mulberry32 con semilla y barajado Fisher-Yates determinista (`getBaseOrder`). No se usa `Math.random`.

## 4. Render de vídeo con ffmpeg

Decidido en el spike T09: **[ADR-001](decisiones/ADR-001-render.md)**, con las medidas, los comandos reproducibles y un ejemplo comentado (`script/videomix/spike/example-anim-chunk.sh`).

### 4.1 Estrategia

- **Salida**: `libx264` + AAC en MP4, `yuv420p`, `-r fps`, `W×H`.
- **Render por bloques**:
  - Se corta siempre al principio y al final de cada re-layout animado, y en los tramos estables largos (> 15 s) en fotogramas sin transición activa.
  - Cada bloque es un proceso ffmpeg con su grafo. Se ejecutan **2 en paralelo**; 1 a 2160p o con menos de 4 núcleos.
  - Los bloques se unen con el **concat demuxer `-c copy`**.
  - El audio va en **una pasada aparte** para toda la duración, y se mezcla al unir.
  - Límites en fotogramas: `round(t·fps)`.
- **Grafo por fichero** siempre: `-/filter_complex <ruta>`. El grafo único de 2 min ya ocupa ~23k caracteres, y Windows admite 32 767.
- **Entrada por clip**: `-ss <s−p> -t <dur+0,5+p> -i`, con un margen previo `p = min(0,1 s, s)`.
  - Cabecera: `setpts=PTS-p/TB,fps=F:start_time=0,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=N,setpts=PTS-STARTPTS`.
  - Nunca `setpts=PTS-STARTPTS` antes de `fps`: desincroniza hasta un fotograma.
- **Columna de ancho constante en el bloque**: `crop` (de `geometry.ts`) → `scale=w:H` → `setsar=1`. En pillarbox/letterbox, sobre el fondo desenfocado del propio clip.
- **Columna de ancho variable** (re-layout animado): técnica **"capa de columna"**.
  1. Por fotograma se calcula `w(t)` (`smoothstep` entre `LayoutKeyframe`), `C(t) = getCropForAspect(max, min, w/H)` y la escala `H/C.h`.
  2. Se aplica `crop` fijo de la unión de los `C(t)`.
  3. `scale=…:eval=frame` (tamaño variable).
  4. `overlay=x=…:y=…:eval=frame` sobre una base fija del ancho máximo de la columna en el bloque.

  La ventana visible es `[0, w(t))` de la capa.
- **Sustitución en columna**: `xfade` entre capas del mismo tamaño, encadenadas con su `offset`.
  - En bloques estables es exacto con cualquier tipo.
  - Durante un re-layout, los tipos con geometría (`wipe*`, `slide*`, `smooth*`, `circleopen`) se calculan sobre el ancho máximo de la capa: una pequeña desviación aceptada.
- **Composición**:
  1. Lienzo `color=<gap.color>`.
  2. Columnas con `overlay` **de izquierda a derecha**: cada capa tapa el sobrante de la anterior.
  3. Barras de separación en `x(t)` si hay animación.
  4. Rellenos encima.
  5. `fade` in/out global en el primer y el último bloque.
- **Relleno desenfocado**: la copia de la columna adyacente (o del propio clip en pillarbox/letterbox) se escala a 1/8 para cubrir, pasa por `boxblur` y se reescala al tamaño del hueco. Es 2,5× más rápido que `gblur` a resolución completa. El relleno final aparece con un fundido alfa de `D`.
- **Expresiones por fotograma**: se escriben como suma plana de escalones `v0+Δ1*gte(t,T1)+…`, **nunca `if()` anidado**, porque ffmpeg falla a partir de ~98 niveles.
- **Progreso**: fotogramas de los bloques terminados más `frame=` de los bloques en curso (`-progress`), dividido entre los fotogramas totales. El audio y la unión son < 2 %.
- **Invariantes que necesita el render** (a cargo del planificador):
  - las columnas conservan su orden durante una animación;
  - una columna que aparece o desaparece lo hace con ancho 0 junto a su vecina derecha;
  - las transiciones que coinciden con una animación caen dentro de su intervalo.

### 4.2 Módulos (implementados en T11)

Todos en `src/renderer/src/videomix/render/`, puros (sin React ni Electron). Detalles en [T11](execution/T11-grafo-video.md).

- **`renderTimeline.ts`**: `getRenderTimeline(plan, { fps, gap, transitionDuration })` pasa el plan a fotogramas una sola vez (`f = round(t·fps)`): colocaciones con `[f0, f1)`, clip anterior/siguiente de la columna y fundido final hacia el relleno (`endsInFill`, `fadeOutFrames` desde `transitionOut`); keyframes con `[f0, f1]`.
  - `getColumnsAtFrame(tl, f)`: geometría de cada columna del layout en un fotograma. Durante un re-layout interpola con **`smoothstep`** (ADR-001; 04-diseno §3.1 dice "con curva `smoothstep` (ver T11)": el render suaviza, T15 puede usar el `smoothstep` exportado). Las columnas que aparecen o desaparecen usan `getAnimatedColumn` del planificador.
  - `getFillSpansAtFrame(tl, columns)`: rellenos `L`, `R` y los huecos que se abren entre dos columnas durante un re-layout.
- **`renderChunks.ts`**: `getRenderChunks(tl, { maxChunkSeconds = 15 })` → `RenderChunk { index, f0, f1, animated }[]`. Intervalos ocupados: xfades (`[inicio del entrante, fin del saliente]`), fundidos hacia el relleno y cambios de layout (animados o instantáneos). Cortes obligatorios en los extremos de los intervalos con cambio de layout; los tramos estables largos se parten fuera de los intervalos ocupados.
- **`buildVideoGraph.ts`**: `buildVideoGraph({ timeline, clips, sourcePaths, settings, chunk })` → `VideoGraph { inputs: string[][], filterComplex, outLabel: 'vout', frames }`, según el esqueleto del ADR.
  - `RenderClip = Pick<MixClip, 'id' | 'sourceId' | 'start' | 'maxRect' | 'minRect'>`; `sourcePaths`: `sourceId` → ruta.
  - Recortes con el `getCropForAspect` real (pares) y, en la capa de columna, escala anisótropa en los fotogramas `fill` (igual que el camino estático, que estira hasta ±1 %).
  - Columnas y rellenos se componen como "elementos" de izquierda a derecha; los rellenos toman como fuente la columna más cercana que se reproduce durante todo el bloque (o color, en modo `color`, sin fuente o con menos de 16 px).
  - Fundido final de un clip hacia el relleno: `xfade` con el tipo global entre la capa del clip y una capa de relleno del tamaño de la columna (concat si dura 0).
  - Fundido global a/desde negro: capa negra con alfa (`fade` con `start_frame`/`nb_frames`, `trim`), exacto aunque caiga partido entre bloques. Duración = `D` (la misma que el audio, `getGlobalFadeDuration`).
- **`buildRenderJob.ts`**: `buildRenderJob({ plan, clips, sourcePaths, settings, encoding?, workDir, outPath, maxChunkSeconds?, buildAudioGraph?, join? })` → `RenderJob`:
  - `files`: `{ path, content }[]` que hay que escribir antes de ejecutar nada (grafos y lista del concat);
  - `chunks`: `{ chunk, args, frames, duration, outPath, graphPath, fileName }[]`, independientes entre sí (concurrencia: `getChunkConcurrency({ height, cpuCount })`);
  - `audio`: la pasada de audio (independiente de los bloques);
  - `concat`: el último paso (concat demuxer `-c copy` + mux del audio, `-t` exacto, `+faststart`);
  - `tempPaths`: todo lo que hay que borrar al terminar o cancelar; `totalFrames` y `duration` para el progreso.
  - Los `args` no llevan el binario; empiezan por `-hide_banner -nostdin -y`. Codificación común: `libx264 -preset -crf -pix_fmt yuv420p -r fps`, `-an`, `-frames:v N`. `encoding` sustituye CRF/preset (previsualización). El plan ya viene calculado para la resolución de salida.
  - **Hook de audio (T12/T13)**: `buildAudioGraph: (input: AudioGraphInput) => AudioGraph`, con `AudioGraphInput = { plan, clips, sourcePaths, settings, duration }` (`duration` = fotogramas/fps) y `AudioGraph = { inputs, filterComplex, outLabel }`. El job escribe el grafo en `audio.graph.txt` y codifica AAC 192 kbps, 48 kHz, estéreo en `audio.m4a`. Por defecto (`buildSilentAudioGraph`) genera silencio. T13: `buildAudioGraph: (input) => buildAudioGraph({ ...input, clips: project.clips, loudness })`.
- **`verifyFilterGraph.ts`**: comprobaciones estructurales para los tests (etiquetas producidas y consumidas una vez, entradas existentes y usadas, `crop` de las entradas dentro del fotograma y par, `split=n`, sin `if()`).
- **Ejecución** (T13, `render/runRenderJob.ts`, con dependencias inyectadas): escribe `files`, ejecuta la pasada de audio y los bloques con `getChunkConcurrency` (`runFfmpegWithProgress`), luego el `concat` a un nombre parcial (`<nombre>.<id>.part.mp4`) que se renombra al final; borra el directorio temporal siempre y el parcial si falla o se cancela. Progreso = Σ fotogramas / `totalFrames` (la razón de tiempo de main se pasa a fotogramas), más un 1 % para audio y otro para el `concat` (`render/renderProgress.ts`). Orquestación y previsualización en `hooks/useMixRender.ts` (ver [T13](execution/T13-render.md)).
- **Script de desarrollo**: `node script/videomix/renderPlan.ts [proyecto.vmx] [--size WxH] [--fixture <plan>] [--frames t1,t2]` (sin proyecto, escribe y renderiza un ejemplo con los medios de T02).
- **Tests**: snapshots de argumentos y grafos de 5 planes escritos a mano (`renderTestFixtures.ts`), verificador sobre 25 planes aleatorios del planificador y test con ffmpeg real (`buildRenderJob.ffmpeg.test.ts`, 320×180, se omite sin ffmpeg o sin los medios).

## 5. Audio

Implementado en T12 (detalles y medidas en [T12](execution/T12-audio.md)); la normalización de la música es de T12b ([T12b](execution/T12b-normalizar-musica.md)).

### 5.1 Análisis de sonoridad

- **Main**: `measureLoudness({ filePath, start?, end?, abortSignal? })` en `src/main/videomix/loudness.ts`, expuesta en `remoteApiLegacy` como `videomix.measureLoudness`. Devuelve `LoudnessMeasurement`. `start`/`end` son opcionales desde T12b: si se omiten los dos, no se pasan `-ss`/`-t` y mide el fichero completo (lo usa la música).
  1. `ffprobe -select_streams a:0` → canales y layout de la primera pista de audio. Sin pista → `{ hasAudio: false }`.
  2. Primera pasada de `loudnorm` sobre esa pista:

     ```
     ffmpeg -hide_banner -nostats [-ss <start> -t <dur>] -i <path> -map 0:a:0 -af [channelmap,]loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -
     ```

  3. `loudnessParse.ts` (puro, con tests) parsea el bloque JSON de stderr (`input_i`, `input_tp`, `input_lra`, `input_thresh`).
  - **Silencio** (`input_i = -inf` o ≤ −70 LUFS, la puerta absoluta de EBU R128): `{ hasAudio: false }`.
  - **Sin `dual_mono`**: la mezcla convierte mono en estéreo con la matriz por defecto de swresample (−3 dB por canal), que conserva la sonoridad medida en un canal. Comprobado con el script de demo.
  - La medida guarda además `channels` y `channelLayout` (opcionales en el esquema) para aplicar `getFixChannelLayoutFilter` también al mezclar.
- **Renderer**: `ensureLoudness({ project, music?, onProgress?, abortSignal?, onCacheEntries?, deps?, concurrency = 2 })` en `videomix/loudness.ts`.
  - Mide solo los clips no silenciados con duración > 0 cuya clave no está en `loudnessCache`; los clips con el mismo fichero y rango comparten medida.
  - `music` (T12b, opcional, aditivo): `{ absolutePath }` de la música del proyecto. Si se pasa, mide también el fichero completo (clave propia, `getMusicLoudnessCacheKey`, con el rango centinela `[0, Infinity)` de `getLoudnessCacheKey`, que ningún clip real puede producir) y añade esa medida al mapa de salida bajo `MUSIC_LOUDNESS_KEY` (exportada por `render/buildAudioGraph.ts`). El tipo de retorno no cambia (`Record<string, LoudnessMeasurement>`), así que sigue encajando sin cambios en el cierre de T13 sobre `buildAudioGraph`.
  - `onCacheEntries` recibe las entradas nuevas (pasar `setLoudnessCache` de `useMixProject`), también las ya medidas si se cancela o falla.
  - Devuelve las medidas **por id de clip** (más la de la música, si se pidió), la entrada de `buildAudioGraph`.
  - Cancelación: `abortSignal` llega a `runFfmpeg` como `cancelSignal`; `abortFfmpegs` también sirve.
- **Clave de cache**: `sha1(absolutePath \n mtimeMs \n size \n start \n end)` en hexadecimal (`getLoudnessCacheKey`, Web Crypto), con `fs.stat` de `MixSource.absolutePath`.

### 5.2 Mezcla (`render/buildAudioGraph.ts`, puro)

**Firma** (encaja en el *hook* `buildAudioGraph` de `buildRenderJob`, T11):

```ts
buildAudioGraph({ plan, clips, sourcePaths, settings, duration?, loudness }): AudioPass
// clips: Pick<MixClip, 'id' | 'sourceId' | 'start' | 'muted' | 'gainDb'>[]
// sourcePaths: sourceId → ruta (MixSource.absolutePath, la misma que se midió)
// duration: duración exacta del vídeo (fotogramas / fps); por defecto plan.duration
// loudness: medidas por id de clip (ensureLoudness); la de la música (T12b), si la hay, bajo MUSIC_LOUDNESS_KEY
// AudioPass = { inputs: string[][], filterComplex: string, outLabel: 'aout' }, igual que AudioGraph de T11
```

El `RenderClip` del *hook* no lleva `muted` ni `gainDb`, así que el llamador (T13) cierra sobre los clips completos: `buildAudioGraph: (input) => buildAudioGraph({ ...input, clips: project.clips, loudness })`. La codificación (AAC 192 kbps, 48 kHz, estéreo, `.m4a`) la pone `buildRenderJob`.

1. **Por clip audible** (no silenciado y `hasAudio`):
   - entrada `-vn -ss <start> -t <dur + 0,1> -i <ruta>`;
   - `asetpts=PTS-STARTPTS`, `channelmap` si el layout es raro, `aresample=48000`, `aformat=fltp:stereo`, `atrim=duration=dur`;
   - `volume=<normalización + gainDb>dB`. **Normalización** = `min(−16 − input_i, 24, 5 − input_tp)` (`LOUDNESS_TARGET` = −16 LUFS, `MAX_NORMALIZATION_GAIN` = 24 dB, `MAX_NORMALIZED_PEAK` = +5 dBTP): una ganancia lineal y estática, sin bombeo;
   - `afade` in/out con `curve=qsin` (potencia constante) según `getPlacementFades`:
     - sustitución en la columna: el `transitionIn` del clip entrante, en los dos clips;
     - columna que aparece o desaparece en un re-layout: la duración de esa animación;
     - final del vídeo hacia el relleno: `transitionOut` (T10b);
     - corte seco: 10 ms (`DECLICK_DURATION`) para evitar chasquidos;
   - `adelay=<muestras>S:all=1` hasta su `startTime`.
2. **Suma**: `amix=inputs=N:normalize=0:duration=longest` (o `anullsrc` si no hay ningún clip audible: siempre hay pista de audio) y `apad` hasta la duración.
3. **Compensación de simultaneidad**: global, sobre la suma, con `volume='<expr>':eval=frame` (`getCompensationExpr`).
   - Ganancia `1/√n` (−10·log10(n) dB), con `n` = clips audibles sonando.
   - Un clip cuenta desde la mitad de su fundido de entrada hasta la mitad del de salida: en una sustitución el entrante empieza a contar justo cuando el saliente deja de hacerlo, así que la ganancia no cambia. Con fundidos de potencia constante, la potencia se mantiene.
   - Cada cambio es una rampa lineal centrada en ese instante y tan larga como el fundido que lo causa. Se escribe como suma plana `g0 ± Δ·clip((t−a)/r,0,1) …`, sin `if()` anidados.
   - Se descartó la compensación por clip: exigiría también ganancias variables por clip.
4. **Música**: `-stream_loop -1` si `loop`; `aresample`/`aformat`, `atrim` a la duración, `volume=<normalización + volumeDb>dB` (T12b: **normalizada como un clip** —mismos topes—, así que 0 dB suena tan alto como los clips; sin medida, solo `volumeDb`, con aviso en el código), `afade=t=out` final de `max(2 s, D)`; `amix` de 2 entradas con `normalize=0:duration=first`. Valor por defecto de `volumeDb` al elegir un fichero: −12 dB (`DEFAULT_MUSIC_VOLUME_DB`).
5. **Salida**: `atrim` a la duración, `alimiter=limit=−1 dBFS:level=disabled:latency=1` (`latency=1` compensa el retardo del *lookahead*: sin él, el audio llega 5 ms tarde), `afade` in/out global de `getGlobalFadeDuration(settings)` (= `D` si `fadeInOut`; el vídeo debe usar la misma) y `aformat` final estéreo 48 kHz.

**Demo**: `node script/videomix/audioDemo.ts [--music] [--columns n]` mezcla los medios de T02 con el planificador real y mide la sonoridad integrada de cada tramo. Para cargar módulos del renderer desde Node, `script/videomix/rendererImports.ts` registra un *hook* de resolución (imports sin extensión e `import.meta.env`).

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

### 6.3 Clips ↔ segmentos (concretado en T07 → [ADR-002](decisiones/ADR-002-clips-segmentos.md))

Se implementa la sincronización bidireccional recomendada. Los detalles (todo segmento con fin es un clip, marcadores fuera del proyecto, agrupación de pasos de undo, clip seleccionado = segmento actual) están en el ADR.

Recomendación original:

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

## 8. Elementos superpuestos (overlays)

Requisitos: [01-requisitos §9](01-requisitos.md). Tareas: T19–T23.

### 8.1 Modelo (T19)

`MixProject` pasa a **`version: 2`**, con migración automática desde v1 (`overlays: []`). Se guarda siempre en v2. Esquemas zod en `videomix/types.ts`; la lógica, en `videomix/overlays/`. Detalle completo y API en las notas de [T19](execution/T19-overlays-modelo.md).

```ts
type OverlayAnchor =
  | { kind: 'absolute', time: number }                                        // time ≥ 0
  | { kind: 'clip', clipId: string, edge: 'start' | 'end', offset: number }
  | { kind: 'element', elementId: string, edge: 'start' | 'end', offset: number };

interface OverlayBase { id: string, name: string, anchor: OverlayAnchor }
// Caja en fracciones del fotograma de salida (0..1). El rango lo comprueba validateMixProject, no el esquema.
interface OverlayBox { x: number, y: number, width: number, height: number }
// Colores: '#rrggbb' o '#rrggbbaa'. Grosores de borde y desplazamientos de sombra: "px de referencia" de una salida de
// 1080 px de alto (OVERLAY_REFERENCE_HEIGHT), escalados con overlayPxToOutput(valor, altoSalida).

interface ImageOverlay extends OverlayBase { type: 'image', path: string, absolutePath: string, duration: number, box: OverlayBox, fadeIn: number, fadeOut: number }
interface CountdownOverlay extends OverlayBase {
  type: 'countdown', duration: number,
  box: OverlayBox,                    // box.height = tamaño de letra; texto centrado en vertical
  align: 'left' | 'center' | 'right', // alineación horizontal dentro de la caja (refinamiento de T19)
  decimals: 0 | 1 | 2 | 3, leadingZeros: boolean, color: string,
  font?: { path: string, absolutePath: string } | undefined,   // por defecto, la fuente incluida
  border: { width: number, color: string }, shadow?: { x: number, y: number, color: string } | undefined, fadeOut: number,
}
interface ProgressBarOverlay extends OverlayBase {
  type: 'progressBar', duration: number, linkedCountdownId?: string | undefined, box: OverlayBox,
  fillColor: string, backgroundColor: string /* '#00000000' = sin fondo */, border: { width: number, color: string },
  direction: 'ltr' | 'rtl' | 'btt' | 'ttb', mode: 'fill' | 'empty',
}
interface SoundOverlay extends OverlayBase { type: 'sound', path: string, absolutePath: string, gainDb: number }

type MixOverlay = ImageOverlay | CountdownOverlay | ProgressBarOverlay | SoundOverlay;
// MixProject.overlays: MixOverlay[]  (el orden es el orden de capas: el último va encima)
```

- **Resolución de tiempos** (`overlays/resolveOverlayTimes.ts`: `resolveOverlayTimes(project, plan, { soundDurations }) → Map<id, { start, end, rawStart, rawEnd, warnings }>`, pura y O(n)):
  - orden topológico de los anclajes y detección de ciclos (cada elemento depende como mucho de otro: grafo funcional);
  - los anclajes a clips usan `ColumnPlacement.startTime` / `endTime`; los anclajes a elementos usan los tiempos sin recortar (`rawStart`/`rawEnd`);
  - la duración de los sonidos llega en `soundDurations` (T21); si falta, dura 0 con aviso;
  - la barra con `linkedCountdownId` toma el inicio y el fin del contador;
  - ciclos y referencias rotas no lanzan: el elemento se trata como absoluto en `max(0, offset)`, con aviso;
  - `start`/`end` se recortan a `[0, plan.duration]`, con aviso (`clipped` u `outside-video`).
- **Borrado**: `removeClip`, `removeSource` y `removeOverlay` reciben los tiempos resueltos antes del borrado; los elementos anclados a lo borrado pasan a absolutos en su inicio actual y las barras vinculadas a un contador borrado se desvinculan conservando su inicio y duración.

### 8.2 Render de vídeo (T20)

Implementado en `render/overlayFilters.ts` (grafo) y `overlays/overlayFrames.ts` (valores por fotograma compartidos con la UI). Detalles en [T20](execution/T20-overlays-render.md).

- Se aplica **sobre la salida compuesta de cada bloque** (después de columnas, rellenos y separaciones, antes del *fade* global), en orden de capas. Solo entran en el grafo de un bloque los elementos visibles en él.
- **Todo en fotogramas absolutos** (`round(t·fps)`, como el resto del render): el fotograma local `n` del bloque es el `f0 + n` del vídeo, así que las expresiones son aritmética entera y exactas en los cortes. `enable='between(t,(lo−½)/fps,(hi−½)/fps)'`.
- **PNG**: entrada `-f image2 -pattern_type none -i`, `scale` a la caja (px pares) una sola vez y `loop` del fotograma; `fade` con alfa sobre una base de tiempos que empieza en el inicio del elemento, y `overlay` con `enable`.
- **Contador**: `drawtext` con `fontfile` y el texto por expresión (`%{eif:…}`), valor `ceil(restantes·10^d/fps)` en fotogramas. Dos `drawtext` si hace falta (`M:SS` mientras el valor es ≥ 60 s y `SS` después; el fotograma del cambio se calcula en JS), sin `if()`. Borde, sombra y `alpha` para el *fade*. Texto y ruta de la fuente con doble escapado (opción y grafo). Fuente por defecto: Open Sans Bold (OFL) en `resources/fonts`, `extraResources` → `fonts`, localizada con `getDefaultOverlayFontPath()` (`src/main/ffmpeg.ts`).
- **Barra**: capa RGBA del tamaño de la caja con el fondo, una capa de relleno del tamaño interior que entra desde el lado que crece (`overlay` con `x`/`y` por fotograma, recortada por la capa) y el borde encima (`drawbox … replace=1`); después `overlay` sobre el lienzo.
- La mini vista del fotograma (T15/T22) dibuja las cajas de los elementos visibles con `getVisibleOverlayBoxes` (mismo redondeo a fotogramas que el render).

### 8.3 Audio (T21)

- Los efectos de sonido se miden con `ensureLoudness` (clave de cache propia) y se normalizan a −16 LUFS más `gainDb`.
- Entran en la pasada de audio con `adelay` y se suman después de la compensación de simultaneidad y antes del limitador.

### 8.4 UI (T22)

- Carriles nuevos en `MixPlanView` y un panel de propiedades.
- Edición de posición y tamaño sobre la mini vista del fotograma (reutiliza la lógica de arrastre de `overlayMath`).
- Undo/redo mediante el reducer del proyecto.
