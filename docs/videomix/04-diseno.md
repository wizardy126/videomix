# 04 · Diseño técnico

Este documento describe **cómo** se implementan los requisitos de [01-requisitos.md](01-requisitos.md).

- Las decisiones que se tomen durante la ejecución se registran en `docs/videomix/decisiones/ADR-XXX-*.md` y se enlazan aquí.
- Las partes marcadas como **(provisional)** dependen de un ADR pendiente.

## 1. Modelo de datos

Ubicación: `src/renderer/src/videomix/types.ts`, o `src/common/videomix/types.ts` si main también lo necesita.

### 1.1 Coordenadas

- Los rectángulos se expresan en **píxeles de visualización de la fuente**: tras aplicar la rotación de metadatos y la proporción de píxel (SAR), como la muestra el `<video>` (`videoWidth`/`videoHeight`, y `drawImage` en la previsualización en vivo).
  - Con píxeles cuadrados coinciden con los que da ffmpeg con autorotate, que es su comportamiento por defecto.
  - **Fuentes anamórficas (B1, T35)**: `MixSource.sar` guarda el SAR del fotograma ya orientado (el autorotate de ffmpeg lo invierte en un cuarto de vuelta). El tamaño de visualización sigue la regla de Chromium: se agranda una dimensión (SAR > 1, el ancho; SAR < 1, el alto). En el render y las miniaturas el rectángulo se convierte a píxeles codificados **solo en el `crop`** (`sampleAspect.toCodedRect`); el escalado posterior a tamaño explícito con `setsar=1` corrige la proporción.
- **Clips girados (E9, T38d)**: los rectángulos de un clip con `rotation` están en el fotograma de visualización **girado** por ese giro (sentido horario), y todo lo que solo mira los rectángulos (intervalos de proporción, orientación, planificador) no cambia. Ver §2.6.
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
  sar?: { num: number, den: number } | undefined,  // v3 (B1): SAR del fotograma orientado; sin definir = píxeles cuadrados
  blackBars?: BlackBarsDetection | undefined,       // v5 (A7, T44): caché de la detección de bandas negras, ver §10.5
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
  pinTime?: number | undefined,  // v3 (A4): inicio fijado en el vídeo final (s)
  groupId?: string | undefined,  // v3 (A4): los clips con el mismo id empiezan juntos (≥ 2 clips)
  extendBeyondMax?: boolean | undefined,  // v4 (E7, T38b): ampliar más allá del máx. si hace falta; sin definir = true
  rotation?: 90 | 180 | 270 | undefined,  // v4 (E9, T38d): giro horario de la imagen; sin definir = 0 (solo se guarda un giro)
  keyframes?: MixClipKeyframe[] | undefined,  // v5 (A9, T44): paneo y zoom del encuadre, ordenados por tiempo; ver §10.3
}

type TransitionType = 'fade' | 'dissolve' | 'fadeblack' | 'wipeleft' | 'wiperight' | 'wipeup' | 'wipedown'
  | 'slideleft' | 'slideright' | 'slideup' | 'slidedown' | 'smoothleft' | 'smoothright' | 'smoothup' | 'smoothdown' | 'circleopen';

interface MixSettings {
  output: { aspect: '16:9' | '9:16' | '1:1', resolution: '720' | '1080' | '2160' },  // v3; 16:9, 1080 (lado corto, getOutputSize)
  encoder: { codec: 'h264' | 'h265', hardware: 'auto' | 'none' | 'nvenc' | 'qsv' | 'videotoolbox' | 'vaapi' },  // v3; h264, auto
  fps: 24 | 25 | 30 | 50 | 60,              // 30
  crf: number,                              // 20
  preset: 'ultrafast' | 'veryfast' | 'fast' | 'medium' | 'slow',  // medium
  maxColumns: number,                       // 3
  gap: { width: number, color: string },    // { 0, '#000000' }
  reorderWindow: number | 'unlimited',      // 3; E8 (T38c): entero ≥ 0 sin tope, o ilimitada (aditivo, sigue en v4)
  order: { mode: 'list' | 'random', seed: number },
  planPriority: 'duration' | 'fill',        // v6 (G2, T52): 'duration'; criterio de la red de seguridad del planificador, §3.10
  transition: { type: TransitionType, duration: number },  // fade, 0.5
  fadeInOut: boolean,                       // true
  fill: { mode: 'blur' | 'color', color: string },          // blur, '#000000'
  musicPlaylist: {                                          // v3 (sustituye a `music?`, ver §9)
    tracks: { id: string, path: string, absolutePath: string, volumeDb: number }[],  // [] = sin música
    crossfade: number,                                      // 2 s
    loop: boolean,                                          // true
    ducking: { enabled: boolean, amountDb: number },        // false, −10 dB
  },
  autoCropBlackBars: boolean,               // v5 (A7, T44): true; los clips nuevos nacen sin bandas negras
}

interface MixProject {
  version: 6,              // v1…v5 se migran al abrir (v4 → v5 y v5 → v6 son aditivas, T44 y T52), ver §8.1, §9, §10 y §3.10
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
- `maxRect` dentro del fotograma de la fuente (girado por el giro del clip, E9).
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

El planificador intenta evitar estos casos, pero el generador debe soportarlos. A menos de un 1 % fuera del intervalo no hay relleno: ver la tolerancia (§2.4 y §2.7).

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
- **Tolerancia**: si la proporción pedida se sale del intervalo menos de un 1 % (`ASPECT_TOLERANCE`), el resultado sigue siendo `fill` en lugar de dejar una franja de relleno de pocos px. Desde T44b el desajuste se absorbe sin deformar siempre que se pueda (§2.7).
- **Reparto de anchos** en píxeles de salida: cada clip tiene límites pares `[ceilPar(aMin·H), floorPar(aMax·H)]` (`getWidthRange`); si el intervalo es tan estrecho que no contiene ningún par (p. ej. 9:16 rígido a 1080p = 607,5 px), se usa el par más cercano a `aPref·H`. El reparto proporcional al margen satura todos los clips a la vez, así que no hace falta iterar. Después se redondea en unidades de 2 px por **mayor resto**, respetando los límites, en vez de ajustar solo el último (que podría salirse de su intervalo). Si con esos límites quedaría relleno o la fila no cabe, se prueba la tolerancia del 1 % (§2.7).
- **Escalado**: `factor = min(anchoCelda / C.w, H / C.h)` cubre los tres casos (`getScaleFactor`).
- **Separación impar**: con un número impar de huecos entre columnas, el ancho útil es impar y queda 1 px de relleno; `validateMixProject` avisa (`odd-gap`).

### 2.5 Ampliar más allá del máx. (E7, T38b)

- **Dirección**: el eje principal del plan (`horizontal` en columnas, `vertical` en filas). `getExtensionRoom(max, fuente, dirección)`: píxeles pares que le quedan a la fuente fuera del máx. en esa dirección (los dos lados juntos; 0 si el máx. no está dentro del fotograma).
- **Máx. ampliado**: `extendMaxRect(max, fuente, dirección, extra)`: el máx. normalizado crece `extra` (par, como mucho `room`), **centrado en el máx.** y desplazado (asimétrico) si un lado llega al borde; conserva la posición y el tamaño en el otro eje.
- **Recorte**: `getExtendedCropForAspect(max, mín, máxAmpliado, a)` es `getCropForAspect` salvo cuando la celda es más larga en el eje principal de lo que permite el máx. (pillarbox en columnas, letterbox en filas). Entonces parte del recorte del límite del intervalo (el ancho del máx. con la altura del mín., y su posición) y lo alarga hasta la proporción de la celda, centrado en el máx. y desplazado dentro del máx. ampliado. Si no llega, usa todo el ampliado y el resto sigue siendo pillarbox/letterbox. Continuo con el recorte normal en `aMax` (sirve para las animaciones). Todo en píxeles de visualización; el render lo pasa a codificados en el `crop` (T35).

- **Tolerancia (T44b)**: si la celda es algo más larga de lo que permite el máx. pero dentro del 1 % (§2.7) y el clip tiene mín., el recorte del límite se amplía unos píxeles con el máx. ampliado en vez de estirarse (`strategy: 'extend'`). `extendPlan` calcula esa ampliación como la del pillarbox (§3.8).

### 2.6 Girar un clip (E9, T38d)

Detalle y verificación en las notas de [T38d](execution/T38d-v3-girar-clip.md). Módulo `clipRotation.ts` (puro).

- **Fotograma del clip**: `getClipFrame(clip, fuente)` = tamaño de visualización de la fuente (§1.1) girado por `rotation`. Lo usan la validación (`max-rect-outside-frame`), `getPlannerInput` (material de E7, §2.5 y §3.8) y el reescalado de B2 (`rotateFrameChange`).
- **Cambiar el giro**: `rotateClipRects(rects, fuente, de, a)` gira el máx. y el mín. con la imagen (`rotateRect`), así que se conserva el encuadre. Es exacto (ida y vuelta, pares) con un fotograma par; uno impar se ajusta a pares (±1 px). Acción del reducer `rotateClip` (no hace nada si no se conoce el tamaño de la fuente); duplicar o dividir un clip copia el giro.
- **Lectura de la imagen**: el rectángulo se lleva al fotograma sin girar (`getUnrotatedCrop`, inversa de `rotateRect`), se recorta ahí y se gira solo el recorte.
  - **Render**: `crop` (en píxeles codificados, T35) → `transpose=clock` / `transpose=cclock` / `hflip,vflip` → `scale` explícito + `setsar=1`. El `transpose` invierte el SAR, pero el escalado a tamaño explícito lo ignora; el fondo desenfocado recibe la proporción girada.
  - **Miniaturas**: el mismo `crop` más el filtro de giro (`getThumbnailCrop`); el giro entra en la clave de caché solo si lo hay.
  - **Previsualización en vivo**: las operaciones de dibujo llevan `rotation` y el canvas dibuja el rectángulo sin girar del `<video>` girado alrededor del centro del destino.
  - **Editor**: con un clip girado seleccionado, el reproductor (el `<video>` y el reproductor compat, dentro de un envoltorio común) se gira con CSS `rotate(giro) scale(k)` para que la imagen girada quepa (`getTurnedVideoView`), y el overlay, sin girar, trabaja en el fotograma girado.

### 2.7 Tolerancia de encaje del 1 % sin deformar (F1, T44b)

Detalle, validación y cambios de planes en las notas de [T44b](execution/T44b-v4-tolerancia.md). Decisión del usuario (01-requisitos §12, F1): el desajuste de hasta un 1 % entre la proporción de la celda y el intervalo del clip se absorbe sin deformar siempre que se pueda.

- **Anchos tolerados** (`getTolerantWidthRange`): `[ceilPar(aMin·(1 − 1 %)·H), floorPar(aMax·(1 + 1 %)·H)]` (unidos a los de `getWidthRange`), exactamente los anchos a los que `getCropForAspect` y `getColumnFit` dan `fill`.
- **Reparto** (`distributeWidths`): primero, exactamente como antes con los límites exactos. Solo si quedaría relleno (Σ máx. < útil) o la fila no cabe (Σ mín. > útil), **y la tolerancia lo resuelve del todo**, los clips salen de su intervalo: desde su ancho máx. (o mín.), solo los px necesarios, repartidos en proporción al margen de tolerancia de cada uno (mayor resto, pares). Si ni con la tolerancia desaparece el relleno, el resultado es el de antes (anchos máx. y relleno; E7 puede ampliarlos después). Así la tolerancia nunca se usa cuando los intervalos exactos bastan, ni para reducir a medias un relleno que va a quedar igualmente.
- **Planificador**: usa `distributeWidths` en todas sus opciones; las cotas de poda de §3.9 usan los anchos tolerados para seguir siendo exactas (sin relleno si la tolerancia lo cubre; si no, el de los máx.), y la clave de encaje de E8 (`getFitKey`) cuenta como encaje lo que entra con la tolerancia, como ya hacía la sustitución directa.
- **Recorte de una celda** (`getCropForAspect` → `{ crop, fit, strategy }`), dentro de la tolerancia y fuera del intervalo, en este orden:
  1. **`crop`, recortar dentro del máx.**: solo un clip **sin mín.** (el máx. entero es lo "deseado", no un límite duro): pierde hasta un 1 % en el eje del desajuste (celda más ancha: alto, repartido arriba y abajo; más estrecha: ancho), centrado en el máx. y con bordes pares, y se escala de forma uniforme. Con mín., el recorte del límite del intervalo ya ocupa todo el mín. en ese eje (`aMax = M.w / m.h`, `aMin = m.w / M.h`), así que no se puede recortar más ("el mín. toca ese borde").
  2. **`extend`, ampliar unos píxeles fuera del máx.** (`getExtendedCropForAspect`): con mín., E7 activo y material en la fuente, solo en el eje principal (el de E7): celda más ancha en columnas, más alta en filas. El máx. ampliado lo pone `extendPlan` en la colocación. Estos pocos px **no generan el aviso `extended`** (sustituyen a un estiramiento ≤ 1 %); solo lo generan las ampliaciones de E7 más allá de la tolerancia (decisión del usuario).
  3. **`stretch`, estirar ≤ 1 %**: el recorte del límite, estirado a la celda (lo de antes de T44b).
  - `none`: no hace falta tolerancia (la proporción sale con el redondeo par del tamaño) o la celda está más allá del 1 % (pillarbox/letterbox).
- **Coherencia**: render (`buildVideoGraph`), previsualización en vivo (`previewDraw.getClipCellDraw`) y avisos (`getPlanWarnings`) usan la misma función con el mismo `extendedMaxRect` del plan, así que no pueden divergir. Las miniaturas recortan el máx. entero (no dependen de la celda) y no cambian.
- **Encaje en fracciones** (§10.2): `fits` incluye la tolerancia; `extends` es lo que necesita E7 más allá. El imán y "Ajustar a" siguen apuntando a la proporción exacta.

## 3. Planificador de montaje (puro)

Carpeta: `src/renderer/src/videomix/planner/` (implementado en T10 y ajustado en T10b; detalles y justificación en [T10](execution/T10-planificador.md) y [T10b](execution/T10b-ajuste-planificador.md)).

- **Entrada** (`PlanMixInput`): la lista ordenada de `PlannerClip = { id, duration, aspectRange, rects?, pinTime?, groupId? }`, `PlannerSettings = { width, height, maxColumns, gap, reorderWindow, order, transitionDuration, axis?, linkTransition?, maxDuration?, priority?, bestOfWindows? }` (los dos últimos desde T52, §3.10) y, desde T38, `chains?` (listas de ids) y `sequence?` (ids de la secuencia siempre visible). `getPlannerInput(project)` (`plannerInput.ts`) la construye desde `MixClip`/`MixSettings` (cadenas con `getClipChains` sobre los clips válidos); `rects` (máx./mín.) solo sirve para el aviso y la puntuación de upscale.
- **Salida**: `MixPlan` (`planMix`; `planMixBest` devuelve además la ventana elegida por la red de seguridad y la calidad del plan, §3.10). `validatePlan(plan, input)` comprueba las invariantes de §3.2 y devuelve la lista de problemas; `planMix` la ejecuta en desarrollo (`import.meta.env.DEV`). `formatPlan(plan)` da una vista textual compacta.

### 3.1 Salida: `MixPlan`

```ts
interface ColumnPlacement {        // un clip reproduciéndose en una columna
  clipId: string,
  column: number,                  // identificador estable de columna (no su índice visual)
  startTime: number,               // en el vídeo final (s)
  endTime: number,                 // startTime + duración del clip
  transitionIn: number,            // xfade con el clip anterior de la columna (0 si es el primero); ≤ D
  transitionOut?: number,          // (T10b) fundido al relleno al final del vídeo; ausente = 0 (ver abajo)
  extendedMaxRect?: Rect,          // (E7, T38b) máx. ampliado por el planificador; recortes con getExtendedCropForAspect
}

interface LayoutKeyframe {         // disposición de la fila a partir de un instante
  time: number,                    // inicio del cambio
  transitionDuration: number,      // 0 = cambio instantáneo; >0 = animación lineal desde el keyframe anterior
  columns: { column: number, x: number, width: number }[],  // en píxeles de salida, izquierda→derecha  (T29: a lo largo del eje; en filas, y/alto)
  fills: { x: number, width: number }[],                    // relleno estructural (la fila no llega a W)
}

type PlanWarning =
  | { type: 'upscale', clipId, factor }                 // factor máximo > 2 (necesita rects)
  | { type: 'pillarbox' | 'letterbox', clipId, time }   // la columna no encaja con el clip
  | { type: 'transition-shortened', clipId, duration }  // xfade de entrada < D
  | { type: 'fill', time, width }                       // keyframe con relleno estructural > 1 px
  | { type: 'pin-shifted', clipId, pinTime, time }      // (T30) un clip fijado no empieza en su momento sino en `time`
  | { type: 'group-split', groupId, clipIds }           // (T30) los clips de un grupo no empiezan todos a la vez
  | { type: 'truncated', time, seconds, clipIds, cutClipIds } // (T38, truncatePlan) corte en la duración máxima
  | { type: 'extended', clipId, pixels, time, endTime };      // (E7, T38b) píxeles de fuente mostrados fuera del máx. en [time, endTime]

interface MixPlan {
  width: number, height: number, duration: number,
  placements: ColumnPlacement[],   // por orden de inicio (sin clips fijados, es también el orden de elección)
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
- Se elimina `crops` del diseño original: el generador recalcula los recortes con `getCropForAspect(maxRect, minRect, width / H)` o, desde T38b, `getExtendedCropForAspect(maxRect, minRect, placement.extendedMaxRect, width / H)` (igual si no hay ampliación).

### 3.2 Reglas: invariantes que los tests deben verificar

1. **Todos los clips aparecen exactamente una vez**, enteros: `endTime − startTime = duración del clip`.
2. **Nunca hay más de `maxColumns` columnas visibles**, tampoco durante una animación (unión de las columnas de los dos keyframes).
3. En cada keyframe, columnas + huecos entre columnas + relleno cubren `[0, W]` sin solaparse.
4. **Sustitución en columna**: el clip entrante empieza `transitionIn` antes de que termine el saliente, con `transitionIn = min(D, saliente/2, entrante/2)` (se acorta además en los casos límite descritos en §3.3). Ese solape es el xfade.
5. **El orden solo se altera dentro de la ventana `reorderWindow`**: ordenando por `startTime` (empates por índice), ningún clip queda a más de N posiciones de su índice en la lista base. En modo aleatorio, la lista base es la permutación determinista de la semilla. Con `'unlimited'` (E8), N = ∞ (`getReorderWindowSize`).
6. **Inicio**: todas las columnas iniciales empiezan en `t = 0`; las columnas nuevas empiezan en el `time` de su keyframe.
7. **Final**: no hay keyframes después del inicio del último clip; una columna que queda sin clip no desaparece (salvo si la quitó un re-layout justo cuando terminaba su último clip).
8. **Determinismo**: la misma entrada produce el mismo plan.
9. **Orden estable durante una animación** (ADR-001, T10b): las columnas comunes a dos keyframes consecutivos están en el mismo orden.
10. **Colapso junto a la vecina derecha** (ADR-001, T10b): aplicando la regla de colapso de §3.1, ningún par de columnas se solapa en los extremos de la animación (y, como las posiciones son mezclas de los extremos, tampoco en medio).
11. **Fundido de salida** (T10b): `transitionOut` vale `min(D, duración/2)` exactamente en los clips descritos en §3.1 y 0 (o falta) en los demás.
12. **Clips fijados** (T30): un clip fijado empieza exactamente en su `pinTime` efectivo (§3.6) o hay un aviso `pin-shifted` con su inicio real; no hay avisos de clips no fijados ni avisos que no correspondan.
13. **Grupos** (T30): los clips de un grupo empiezan a la vez o hay un aviso `group-split` del grupo (y solo entonces). En la ventana de orden (regla 5) los clips fijados no cuentan, los clips sueltos se comparan entre sí y un grupo, que ocupa una sola posición entre las unidades ordenadas (la de su primer clip), no puede empezar más de N posiciones antes; sí puede empezar después (espera a tener sitio).
14. **Cadenas** (E2, T38): los clips de una cadena están en la misma columna, seguidos (nada entre medias) y en su orden, con `transitionIn` = 0 (`linkTransition: 'cut'`) o exactamente `min(D, a/2, b/2)` (`'global'`). En la ventana de orden una cadena es un clip suelto (el primero); los demás no cuentan. La regla 7 ("columna vacía con clips pendientes") solo mira los inicios de unidades: al final, una cadena o la secuencia puede seguir sola mientras otras columnas pasan a relleno.
15. **Secuencia siempre visible** (E5, T38): es una cadena cuyo primer clip empieza en `t = 0`; con la regla 14 y las de columnas, está en pantalla (en una columna de ancho > 0) hasta que se acaba.
16. **Plan truncado** (E4, T38): con aviso `truncated`, `duration` = `time` (≤ `maxDuration` de los ajustes), ningún clip empieza en el límite o después ni termina después, los clips que faltan son exactamente `clipIds` (y una cadena solo pierde su final), los cortados son `cutClipIds` y ningún keyframe empieza en el límite o después. El resto de reglas se comprueban sobre las duraciones sin cortar.

17. **Ampliación** (E7, T38b): `extendedMaxRect` solo en clips con `extendBeyondMax`; pares, dentro del fotograma de la fuente, contiene el máx. y solo crece en el eje principal. Un aviso `extended` corresponde a un clip ampliado y cae dentro de su intervalo. Los tests comprueban además que el relleno de cada keyframe no aumenta, que las decisiones (clips, columnas, tiempos, keyframes) son las mismas que sin ampliación y que ningún recorte sale de la fuente, en los tres formatos.

Además: los keyframes no se solapan (`time ≥ anterior.time + anterior.transitionDuration`) y `transitionDuration ≤ D`.

### 3.3 Algoritmo (implementado)

Simulación por eventos "termina el clip de una columna". `D` = duración de la transición; `p` = siguiente posición en el orden de reproducción.

1. **Ventana de orden**. Un conjunto de clips elegidos (en orden de índice base) ocupa las posiciones `p, p+1, …`; es válido si cada uno queda a ≤ N de su índice y el primer clip no elegido todavía cabe en su ventana (`p + m ≤ base + N`). Con esa comprobación siempre hay al menos una opción válida: tomar el primer clip pendiente.
2. **Fila inicial**: se evalúan todos los subconjuntos de 1..`maxColumns` candidatos de la ventana, se reparten con `distributeWidths` y se elige el de menor puntuación. Un clip solo que no cabe ni con su mín. se pone a ancho completo con letterbox.
3. **Evento** en `e` (fin del clip de la columna `c`; empates por posición visual):
   1. **Sustitución directa**: el primer candidato en orden de la ventana cuyo intervalo admite el ancho de `c` (con la tolerancia `ASPECT_TOLERANCE`; desde T44b el recorte absorbe ese desajuste sin deformar, §2.7). Entra con `transitionIn` y no cambia el layout.
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

**Poda y complejidad**: por evento se evalúan como mucho `SUBSET_BUDGET` = 1000 subconjuntos (la lista de candidatos se recorta, conservando los más antiguos, que son los que la ventana obliga a tomar; con una ventana grande, ver §3.9). Cada evaluación cuesta `O(maxColumns)` más `distributeWidths`. Total `O(clips × 1000 × maxColumns)` en el peor caso. Desde T38c, antes de construir cada opción de re-layout se descartan las que no pueden ganar (cota inferior exacta, §3.9), sin cambiar ningún plan. 200 clips con `maxColumns` = 6 y ventana 10 se planifican en unos 100–450 ms (primera llamada, con la validación de desarrollo; el peor caso es 1:1 con fijados, grupos y cadenas).

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

**Duración máxima** (E4, T38): hay *presión* mientras `t + contenido pendiente / LIMIT_DENSITY (2 columnas) > maxDuration` (contenido pendiente: clips por empezar con sus cadenas, fijados y lo que le queda a la fila). Con presión, cada columna por debajo de `maxColumns` cuesta `LIMIT_COLUMN_WEIGHT` = 4, no se penaliza pasar de 3 columnas, el recorte "barato" sube a `LIMIT_MAX_CROP_LOSS` = 0,55 y la sustitución directa pierde su prioridad absoluta mientras la fila tenga sitio para más columnas. Ejemplo a 16:9 con 3 columnas: dos 16:9 flexibles a 960 px (50 % de recorte) cuestan 2 × 4 × 0,5 + 4 = 8 frente a 4 + 2 × 4 = 12 de uno a pantalla completa. Sin límite, o si el contenido cabe, la puntuación no cambia. La puntuación global (`PlanScore`, 1:1) no depende del límite.

**Criterio equilibrado de columnas** (T10b, requisitos §4.3): una fila de una sola columna cuesta 4, más que recortar dos clips hasta el umbral (2 × 0,4 × 4 = 3,2). Así se prefieren 2–3 columnas, estrechando los horizontales flexibles hacia su mín., salvo que haya que perder más de ~40 % del máx. de algún clip; entonces gana el clip a pantalla completa. Ejemplos a 1920×1080: un 16:9 flexible junto a un 9:16 se queda en 1312 px (pierde el 32 %) → 2 columnas; junto a un 1:1 rígido se quedaría en 840 px (pierde el 56 %) → pantalla completa; dos 16:9 a 960 px pierden el 50 % cada uno → pantalla completa.

### 3.5 Aleatoriedad

`random.ts`: PRNG mulberry32 con semilla y barajado Fisher-Yates determinista (`getBaseOrder`). No se usa `Math.random`.

### 3.6 Clips fijados y grupos (A4, T30)

Detalle, ejemplos y justificación en las notas de [T30](execution/T30-v2-plan-manual.md). Entrada: `PlannerClip.pinTime?` y `groupId?` (de `MixClip`).

- **Unidades** (`units.ts`, compartido con `validatePlan`): los clips empiezan en unidades.
  - Un clip suelto, un grupo (≥ 2 clips; un grupo de uno se ignora) o un clip o grupo fijado.
  - Un grupo ocupa el lugar de su primer clip en el orden base (lista o barajado) y sus clips le siguen en ese orden.
  - Un grupo con más clips que `maxColumns` se parte en trozos de `maxColumns`, que empiezan uno detrás de otro (aviso `group-split`).
  - Un grupo con algún clip fijado queda fijado entero en el **menor** `pinTime` de sus clips. Los `pinTime` no válidos se ignoran.
- **Ventana de orden**: los clips sueltos se ordenan entre sí como antes. Los clips fijados quedan fuera. Un grupo no puede adelantarse más de N posiciones y, cuando llega al final de su ventana, pasa a ser obligatorio.
- **Fijar un momento** `P`:
  - Es un evento más de la simulación: los clips fijados entran como **columnas nuevas a la derecha** en un keyframe en `P`, con una animación que termina antes de que acabe cualquier clip de la fila y antes del siguiente clip fijado.
  - **Reserva**: antes de `P`, las opciones de cada evento se comparan primero por la falta de sitio que dejan en los momentos fijados (`Option.violation`: columnas de más ocupadas en `P`, o 1 si hay columnas pero los clips no caben a su mín.) y luego por coste. Así se libera una columna a tiempo (quitándola en un re-layout, o dándole un clip que termine antes).
  - Si en `P` no hay sitio, el clip espera: entra en el siguiente evento (en su columna, con un xfade que empieza en `P` exactamente si la columna termina dentro de una transición) o se quita esa columna para hacerle sitio. Aviso `pin-shifted`. Los fijados conservan su orden: si dos no caben a la vez, se desplaza el posterior.
  - Nunca se deja un hueco: si los demás clips se acaban antes de `P`, el clip fijado entra antes (también con aviso).
  - Con `maxColumns` = 1 solo es exacto si un clip termina dentro de una transición después de `P`; si no, entra en el siguiente corte.
- **Grupos**: todos sus clips empiezan en el mismo `time`: en la columna que se libera y en columnas nuevas a su derecha (en un evento normal, en la familia "sustituir"; si es obligatorio, también en las columnas que terminan a la vez). Si no hay sitio, se quita la columna que termina hasta que lo haya. Un grupo cede el sitio a un clip fijado pendiente.
- **Filas apretadas**: si los clips que deben empezar juntos no caben ni a su mín., todos los de la fila se estrechan en la misma proporción (letterbox, con su aviso) antes que retrasarlos.
- Sin clips fijados ni grupos el algoritmo no cambia (mismos planes y snapshots). `placements` se ordena por inicio al final, porque un clip fijado puede empezar antes que otro elegido antes.

### 3.7 Cadenas, secuencia siempre visible y duración máxima (E2, E4, E5, T38)

Detalle, ejemplos antes/después y justificación en las notas de [T38](execution/T38-v3-planificador.md).

- **Entrada**: `getPlanLinks` (`units.ts`, compartido con `validatePlan`) limpia `chains` y `sequence`:
  - la secuencia se queda con sus clips conocidos, sin repetir, y **manda sobre fijaciones y grupos** (sus clips pierden `pinTime`/`groupId`);
  - una cadena pierde los clips desconocidos, de la secuencia, fijados, agrupados (regla de T36) o ya usados en otra cadena; si le quedan menos de 2, se ignora.
- **Cadenas** (E2):
  - Una cadena es **una unidad suelta**: ocupa una posición en la ventana de orden, la de su clip más temprano en el orden base (lista o barajado); se representa por su primer clip, que lleva el resto enlazado (`Clip.next`, y `tail` = segundos que le quedan a la cadena tras ese clip).
  - Cuando termina un clip con `next`, el evento es **de cadena** (`resolveChainEvent`): el siguiente clip entra en la misma columna, `chainTransition` antes (`linkTransition: 'cut'` → 0, concat en el render; `'global'` → `min(D, a/2, b/2)`, sin acortar por otras columnas).
    - Si encaja en el ancho y la fila no tiene relleno, no cambia el layout (como una sustitución directa).
    - Si no, se elige entre dejarlo en su sitio (pillarbox/letterbox) y un **re-layout animado que empieza en el cambio**: con las mismas columnas, o con columnas nuevas a su derecha para clips de la ventana. La animación dura la transición de la cadena (o `D` si es un corte), termina antes de que acabe cualquier clip de la fila y del siguiente fijado, y no puede empezar durante otra; si no hay margen, el clip queda en su sitio.
    - Con relleno y un clip que encaja, se aplica la misma regla de "relleno antes que sustitución directa" (§3.3).
  - Una columna a mitad de cadena **está ocupada hasta `end + tail`**: no entra en eventos fusionados, no se quita (re-layout "quitar", drenado, forzados) y cuenta como ocupada en la reserva de los fijados. Los siguientes clips de una cadena no cuentan en el orden de inicio (`lastStart`).
- **Secuencia siempre visible** (E5): es una cadena fijada en 0 que va **siempre** en la fila inicial (antes que los fijados en 0), a la derecha de los clips elegidos. Cuenta para `maxColumns`. Su posición cambia con los re-layouts (las columnas nuevas entran junto a la que se libera). Sus clips van uno detrás de otro con la misma transición que las cadenas (`links.transition`). Cuando se acaba, su columna es una más: recibe clips o se quita.
- **Final**: si no quedan clips por empezar ni fijados, la simulación sigue solo con las columnas que tienen cadena: las demás pasan a relleno al acabar (sin re-expansión), y un clip de cadena que no encaja se queda en su sitio si alguna columna ya ha terminado.
- **Duración máxima** (E4): el planificador **no corta**; solo cambia la puntuación con presión (§3.4). El corte es `truncatePlan(plan, maxDuration)` (`truncatePlan.ts`, puro):
  - quita los clips que empezarían en el límite o después y corta en el límite los que siguen (`endTime` = límite, sin `transitionOut`);
  - quita los keyframes desde el límite (una animación en curso se queda: el vídeo acaba durante ella);
  - `duration` = límite, así que el *fade* global de vídeo y audio queda en el corte;
  - filtra los avisos de clips perdidos o posteriores al límite y añade `truncated` con los segundos perdidos, los clips perdidos y los cortados (cortar dos veces acumula).
  - Overlays y sonidos: `resolveOverlayTimes` ya los recorta a `plan.duration`; se resuelven con los *placements* del plan completo y la duración cortada (`getOverlayTimesPlan`, T39), para que un overlay anclado a un clip perdido quede fuera del vídeo en vez de perder el ancla.
- **Integración (T39)**: `planRender` aplica `truncatePlan` si hay `maxDuration` y devuelve `{ plan, fullPlan }`. El render, la previsualización renderizada, la vista Mix y la previsualización en vivo usan `plan` (cortado); la estimación "≈ m:ss" de E3 usa `fullPlan`. Todos resuelven los overlays con `getOverlayTimesPlan`. El aviso `truncated` va el primero en la confirmación previa al render (segundos y clips perdidos y cortados) y en el *tooltip* de los bloques cortados; la vista Mix muestra además "Se corta en m:ss". La caché incremental no cambia: los fragmentos anteriores al corte tienen las mismas claves (comprobado con ffmpeg real).
- Sin cadenas, secuencia ni límite (o si el contenido cabe en el límite), los planes no cambian (mismos snapshots).

### 3.8 Ampliar más allá del máx. (E7, T38b)

Detalle y ejemplos en las notas de [T38b](execution/T38b-v3-ampliar-max.md).

- **Entrada**: `PlannerClip.extendBeyondMax = { frame }` (tamaño de visualización de la fuente) si el flag del clip no es `false` y se conoce el tamaño (`getPlannerInput({ clips, settings, sources })`). Sin `sources` (p. ej. la estimación de duración, que no depende de esto) no se amplía nada.
- **Último recurso**: las opciones, la puntuación y la elección del eje en 1:1 no cambian (el `PlanScore` es el del plan sin ampliar). `extendPlan` (`extendPlan.ts`, puro) es una pasada sobre el plan terminado, antes de los avisos:
  1. **Relleno estructural → columnas más largas**: en cada keyframe con relleno, cada columna puede crecer lo que permitan **todos** los clips que muestra mientras el keyframe está quieto (`[time + transitionDuration, siguiente)`): `min(floorPar((máx + room)·cruce / mín_cruce) − ancho)`, 0 si alguno no es ampliable. El relleno (par) se reparte en proporción a esa capacidad (material disponible), en unidades de 2 px por mayor resto y saturando; lo que no cabe sigue siendo relleno, centrado como en `buildLayout`. Las posiciones se recalculan con la separación; el orden y las columnas no cambian (ADR-001 se mantiene).
  2. **Cada colocación** cuyas celdas (keyframes quietos que la solapan) son más largas de lo que permite su máx. —su propio pillarbox/letterbox o una columna recién alargada— recibe `extendedMaxRect` con la ampliación máxima que necesitan (limitada a `room`). El recorte de cada fotograma lo da `getExtendedCropForAspect`, así que en celdas más cortas usa menos. Desde T44b cuentan también las celdas dentro de la tolerancia del 1 % que un clip con mín. tendría que estirar (`strategy: 'stretch'`, unos pocos px; §2.7); un clip sin mín. se recorta dentro de su máx. y no se amplía por eso.
- **Final del vídeo**: no se añade ningún keyframe; las columnas que terminan sin sucesor pasan a relleno como antes (no se re-expande).
- **Avisos**: `extended` por clip (píxeles de fuente fuera del máx. y tramo en que se usan; solo las ampliaciones de E7 más allá de la tolerancia: los pocos px de la tolerancia, T44b, no se avisan); `pillarbox`/`letterbox`, `upscale` y `fill` se calculan con los recortes y keyframes ampliados. `truncatePlan` recorta el tramo al límite.
- **Render y previsualización en vivo** usan `placement.extendedMaxRect` con la misma función (`buildVideoGraph`, `previewDraw.getClipCellDraw`), así que no pueden divergir.
- Sin clips ampliables, el plan es el mismo (mismos snapshots).

### 3.9 Ventana de reorden grande o ilimitada (E8, T38c)

Detalle, mediciones y justificación en las notas de [T38c](execution/T38c-v3-reorden-ilimitado.md).

- **Modelo**: `settings.reorderWindow: number | 'unlimited'` (entero ≥ 0 sin tope; ampliación aditiva, sigue en v4). En el planificador, `getReorderWindowSize` da `Infinity` para `'unlimited'`; `validatePlan` lo acepta igual (regla 5 con N = ∞).
- **Hasta `LARGE_WINDOW` = 10** (el máximo de la antigua barra) el planificador es exactamente el de antes: mismos planes (comprobado con miles de proyectos aleatorios con fijados, grupos, cadenas, secuencia y límite) y mismos snapshots.
- **Ventana grande** (> 10, o ilimitada):
  - **Coste de orden**: la distancia hacia delante, con tope en 10 posiciones; un clip que se ha quedado atrás cuesta 0. Así un clip que encaja puede venir de cualquier sitio a un precio acotado (unos 3 re-layouts), y el orden de la lista sigue desempatando entre opciones igual de buenas: el más antiguo gana los empates y un clip saltado vuelve en cuanto es tan bueno como los demás. La ventana (regla 5) sigue siendo un límite duro si es finita. La puntuación global (`PlanScore`) usa la misma medida.
  - **Poda por encaje**: si la ventana no cabe en `SUBSET_BUDGET`, los candidatos son, por prioridad, los que la ventana obliga a tomar, los más antiguos hasta `OLDEST_SHARE` = 75 % del cupo y, el resto, los que mejor **encajan** en el hueco (`getFitKey`): primero los que llenan el espacio libre sin relleno (columna liberada + relleno, solos o junto a los candidatos más antiguos), luego los que caben en una columna liberada o en un reparto a partes iguales del espacio, y después por cercanía (log del cociente de anchos); empates por antigüedad. Se devuelven en orden base y el resultado es determinista. En la fila inicial el espacio es el fotograma (menos los fijados en 0); en un cambio de cadena, lo que deja el clip de la cadena más el relleno.
  - La sustitución directa y las opciones "en su sitio" ya recorrían toda la ventana: con ventana ilimitada, la sustitución directa toma el primer clip de la lista (en cualquier posición) que encaja en el hueco.
  - **Clips debidos** (G1, T52): ver §3.10.
- **Cotas** (todas las ventanas): cada término del coste es ≥ 0, así que una opción de re-layout se descarta antes de construirla si su orden + re-layout + número de columnas + el relleno mínimo que dejan los máx. de su fila ya no mejora la mejor opción sin violación; y si los mín. de su fila no caben (como en `distributeWidths`). Es exacto: no cambia ningún plan. (T44b: con los anchos tolerados, §2.7.)
- **Rendimiento** (200 clips, primera llamada, con la validación de desarrollo): < 1 s en todos los casos. Con ventana ilimitada, 90–210 ms sin fijados ni grupos y 140–590 ms con fijados, grupos, cadenas, secuencia y límite. El peor caso es 1:1 con 6 columnas, que planifica los dos ejes.

### 3.10 Ventana ilimitada: clips debidos y red de seguridad (G1, G2, T52)

Detalle, banco de pruebas y mediciones en las notas de [T52](execution/T52-v5-planificador.md).

- **Causa** (G1): con una ventana grande el planificador sigue siendo voraz evento a evento. En cada hueco toma el clip que mejor encaja (a menudo por sustitución directa, que gana sin puntuar), venga de donde venga, y un clip saltado no cuesta nada (§3.9). Los clips que encajan mal con los demás (a menudo largos) se aplazan una y otra vez y se acumulan al final, donde ya no queda con quién acompañarlos: suenan solos o en pocas columnas, con el resto de la fila como relleno. El vídeo sale más largo y con más relleno. Ni la puntuación de cada evento ni `PlanScore` lo veían: no miden la duración y no cuentan como relleno las columnas vacías del final. Con ventana 3 o 10 la propia ventana obligaba a colocarlos antes.
- **Arreglo: clips debidos** (solo con ventana > `LARGE_WINDOW`; hasta 10 el planificador no cambia). En cada evento normal (`getDueUnit`), un clip suelto es **debido** si su contenido `c` (con el resto de su cadena) cumple `c · (maxColumns − 1) · DUE_CONTENT_FACTOR ≥ resto`. `resto` es el contenido pendiente sin él: clips por empezar, fijados, cadenas y lo que le queda a la fila. `DUE_CONTENT_FACTOR` = 1: entra mientras las otras columnas aún tienen material para acompañarlo.
  - Se toma el primero de la lista que lo cumple y que la ventana deja empezar.
  - Ese evento solo admite opciones que lo empiecen: `getOrderCost` rechaza las demás, así que sustitución directa, "en su sitio" o re-layouts con él. Si no hay ninguna, el evento se resuelve como antes.
  - No afecta a la fila inicial, a los cambios de cadena ni a los forzados (grupos, fijados).
- **Red de seguridad** (`planMixBest`): el plan se calcula con la ventana del proyecto y con las menores de `SAFETY_NET_WINDOWS` = 10, 3 y 0 (`getSafetyNetWindows`). Gana el mejor según la prioridad del proyecto (`comparePlanQuality`) y, en empate, la ventana mayor.
  - Todos los candidatos cumplen la ventana del proyecto. Los candidatos de una ventana incluyen los de cualquier ventana menor, así que **una ventana mayor nunca sale peor** según la prioridad.
  - En 1:1, cada ventana elige su eje por `PlanScore`, como antes (T29).
  - `bestOfWindows: false` desactiva la red. La previsualización renderizada usa la ventana y el eje que eligió el render final (`planRender`).
- **Calidad** (`PlanQuality`, medida sobre el plan sin la ampliación de E7, como `PlanScore`):
  - `duration`;
  - `fill`: fracción del fotograma × s sin clip (relleno de la fila, barras de pillarbox/letterbox por su área y columnas vacías al final del vídeo);
  - `order`: posiciones de desplazamiento respecto a la lista base, sin tope;
  - `relayouts`: número de cambios de layout.
- **Prioridad** (G2, `settings.planPriority` → `PlannerSettings.priority`, Ajustes → Orden → "Priorizar"):
  - `duration` (por defecto): duración → relleno → orden → re-layouts;
  - `fill`: relleno → duración → orden → re-layouts.
  - Las duraciones se comparan en pasos de `DURATION_STEP` = 0,05 s y los rellenos en pasos de `FILL_STEP` = 0,01 (redondeados, no con tolerancia, para que la comparación sea un orden total).
- **Coste**: con prioridad `duration` se abandona un candidato en cuanto seguro que dura más que el mejor. La cota (`getDurationBound`) es el máximo entre el fin de lo ya colocado y `t − D` + (lo que le queda a la fila + lo pendiente, menos un fundido por clip) / `maxColumns`. Es exacta: no cambia la elección.
  - En proyectos realistas de 200 clips: 30–180 ms.
  - En el peor caso sintético (1:1, 6 columnas, fijados, grupos, cadenas, secuencia y límite): unos 0,7 s, frente a unos 0,4 s con una sola ventana.
- **Modelo**: v6, migración v5 → v6 aditiva (`planPriority` se rellena con `'duration'`).

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
- **Columna de ancho constante en el bloque**: `crop` (de `geometry.ts`) → `scale=w:H` → `setsar=1`. En pillarbox/letterbox, sobre el fondo desenfocado del propio clip. Un clip girado (E9, §2.6) añade el giro del recorte justo después del `crop`.
- **Columna de ancho variable** (re-layout animado): técnica **"capa de columna"**.
  1. Por fotograma se calcula `w(t)` (`smoothstep` entre `LayoutKeyframe`), `C(t) = getCropForAspect(max, min, w/H)` y la escala `H/C.h`.
  2. Se aplica `crop` fijo de la unión de los `C(t)`.
  3. `scale=…:eval=frame` (tamaño variable).
  4. `overlay=x=…:y=…:eval=frame` sobre una base fija del ancho máximo de la columna en el bloque.

  La ventana visible es `[0, w(t))` de la capa.
- **Clip con keyframes de encuadre** (A9, T48): decidido en **[ADR-003](decisiones/ADR-003-keyframes-render.md)**. El recorte de cada fotograma es el estático de los rectángulos base movido y escalado con el keyframe (`animatedCrop.getAnimatedCellCrop`, sub-píxel, compartido con la previsualización).
  - En una columna de ancho constante: `crop` fijo de la unión → `perspective` (`sense=source`, `eval=frame`, esquinas por fotograma como suma de escalones sobre `in`, que empieza en 1) → el `scale` a la celda del camino estático. Si el recorte no cambia en el bloque, el camino estático con ese encuadre a px pares.
  - Durante un re-layout: la capa de columna con el recorte animado de cada fotograma.
  - Sin keyframes, el grafo es exactamente el de antes.
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
- **Caché de render** (T28, `render/renderCache.ts`, puro): ver [T28](execution/T28-v2-render-incremental.md).
  - Clave por paso (bloque o pasada de audio) = SHA-256 de sus argumentos sin rutas temporales (el fichero del grafo se sustituye por su contenido y la salida por un marcador) más la identidad (tamaño + mtime) de cada fichero del proyecto que lee (entradas `-i` y fuentes del grafo). Los argumentos del encoder resuelto forman parte de la clave.
  - `applyRenderCache(job, …)`: cada paso escribe en `<clave>.<run>.part.mp4` dentro de la caché y el ejecutor lo renombra a `v-<clave>.mp4` / `a-<clave>.m4a` al terminar (escritura atómica); el `concat` lee de la caché con rutas absolutas entre comillas.
  - `runRenderJob` comprueba antes de empezar qué pasos están en caché (`verifyCached`: no vacío y duración de ffprobe dentro de 1 fotograma, 0,1 s el audio) y los cuenta como hechos.
  - Carpeta `.<nombre>.vmx.cache/` junto al proyecto (sin guardar: `userData/videomix-cache/<id de sesión>`), con `render/` y `preview-<W>x<H>/` separados (y `converted/<hash>/` con las conversiones de previsualización de fuentes no reproducibles, T42, que ni la poda ni "Clear render cache" tocan, T43). Tras un render correcto, `pruneRenderCache` borra lo que no usó ese render en su carpeta y aplica el máximo global `renderCacheMaxBytes` (configStore, 5 GB por defecto, 0 = sin caché) por LRU. Menú Project → "Clear render cache".
- **Script de desarrollo**: `node script/videomix/renderPlan.ts [proyecto.vmx] [--size WxH] [--fixture <plan>] [--frames t1,t2] [--cache <dir>]` (sin proyecto, escribe y renderiza un ejemplo con los medios de T02).
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
- **Renderer**: `ensureLoudness({ project, musicTracks?, sounds?, onProgress?, abortSignal?, onCacheEntries?, deps?, concurrency = 2 })` en `videomix/loudness.ts`.
  - Mide solo los clips no silenciados con duración > 0 cuya clave no está en `loudnessCache`; los clips con el mismo fichero y rango comparten medida.
  - `musicTracks` (T12b; por pista desde T24): `{ id, absolutePath }[]` de las pistas de música. Mide cada fichero completo (clave de cache propia por fichero, `getMusicLoudnessCacheKey`, con el rango centinela `[0, Infinity)` de `getLoudnessCacheKey`, que ningún clip real puede producir) y añade cada medida al mapa de salida **bajo el id de su pista**. El tipo de retorno no cambia (`Record<string, LoudnessMeasurement>`).
  - `onCacheEntries` recibe las entradas nuevas (pasar `setLoudnessCache` de `useMixProject`), también las ya medidas si se cancela o falla.
  - Devuelve las medidas **por id de clip** (más las de las pistas de música y los sonidos, si se pidieron), la entrada de `buildAudioGraph`.
  - Cancelación: `abortSignal` llega a `runFfmpeg` como `cancelSignal`; `abortFfmpegs` también sirve.
- **Clave de cache**: `sha1(absolutePath \n mtimeMs \n size \n start \n end)` en hexadecimal (`getLoudnessCacheKey`, Web Crypto), con `fs.stat` de `MixSource.absolutePath`.

### 5.2 Mezcla (`render/buildAudioGraph.ts`, puro)

**Firma** (encaja en el *hook* `buildAudioGraph` de `buildRenderJob`, T11):

```ts
buildAudioGraph({ plan, clips, sourcePaths, settings, duration?, loudness }): AudioPass
// clips: Pick<MixClip, 'id' | 'sourceId' | 'start' | 'muted' | 'gainDb'>[]
// sourcePaths: sourceId → ruta (MixSource.absolutePath, la misma que se midió)
// duration: duración exacta del vídeo (fotogramas / fps); por defecto plan.duration
// loudness: medidas por id de clip (ensureLoudness); las de las pistas de música, bajo el id de cada pista (T24)
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
     - **corte directo con el clip siguiente de la columna** (una cadena con `links.transition: 'cut'`, o un `transitionIn` acortado a 0; T39): los dos fundidos por separado bajarían a silencio justo en el corte. En su lugar hay un fundido cruzado de `CUT_CROSSFADE` = 20 ms (como mucho, la mitad del clip entrante): el audio del saliente sigue esos 20 ms tras su fin (`tail`: su `atrim` es `dur + tail`) mientras entra el siguiente. La curva es **lineal** (`tri`) si el entrante continúa al saliente en la misma fuente (mismo audio: la suma es exactamente la fuente) y `qsin` en los demás casos (`getJoinCurve`). La compensación no cambia en el corte (el saliente cuenta hasta `fin + tail/2`, justo cuando empieza a contar el entrante). La previsualización en vivo cambia de clip en el corte sin fundidos (aplica las ganancias una vez por fotograma);
   - `adelay=<muestras>S:all=1` hasta su `startTime`.
2. **Suma**: `amix=inputs=N:normalize=0:duration=longest` (o `anullsrc` si no hay ningún clip audible: siempre hay pista de audio) y `apad` hasta la duración. Detrás de **cada** `amix` va `asetpts=N/SR/TB` (T27): con ffmpeg 8.0, `amix` a veces saca fotogramas sin *timestamps* (una carrera entre los hilos de sus entradas); entonces la `t` de la compensación es NaN (volumen 0), los *fades* se descolocan y la salida puede acabar al final del primer clip. Pasaba en ~1 de cada 4 renders con música.
3. **Compensación de simultaneidad**: global, sobre la suma, con `volume='<expr>':eval=frame` (`getCompensationExpr`).
   - Ganancia `1/√n` (−10·log10(n) dB), con `n` = clips audibles sonando.
   - Un clip cuenta desde la mitad de su fundido de entrada hasta la mitad del de salida: en una sustitución el entrante empieza a contar justo cuando el saliente deja de hacerlo, así que la ganancia no cambia. Con fundidos de potencia constante, la potencia se mantiene.
   - Cada cambio es una rampa lineal centrada en ese instante y tan larga como el fundido que lo causa. Se escribe como suma plana `g0 ± Δ·clip((t−a)/r,0,1) …`, sin `if()` anidados.
   - Se descartó la compensación por clip: exigiría también ganancias variables por clip.
4. **Música** (lista de T27, C2): `getMusicSchedule` coloca las pistas en orden; cada una empieza `crossfade` segundos antes del final de la anterior (como mucho, la mitad de la más corta de las dos) y, si `loop`, la lista se repite hasta el final del vídeo (tope `MAX_MUSIC_OCCURRENCES` = 500). La duración de cada pista sale de su medida (`LoudnessMeasurement.duration`).
   - Una entrada por aparición: `aresample`/`aformat`, `atrim` a su duración, `volume=<normalización + volumeDb>dB` (T12b: **normalizada como un clip** —mismos topes—, así que 0 dB suena tan alto como los clips), `afade` `qsin` de entrada y salida para los fundidos cruzados (10 ms antichasquidos si no hay) y `adelay` hasta su inicio. Se suman con `amix` y después van `atrim` a la duración y `afade=t=out` final de `max(2 s, D)`.
   - Sin medida: solo `volumeDb`, y la pista suena hasta el final (con `-stream_loop -1` si la lista se repite).
   - **Ducking** (C1, si `ducking.enabled` y hay clips audibles): la suma de los clips (tras la compensación) se divide con `asplit`; una copia, subida 30 dB y recortada a 0 dBFS (`volume`, `asoftclip=type=hard`), es la señal de control de `sidechaincompress` sobre la música. El umbral se calcula para que, con la señal de control saturada, el ratio 20 reste exactamente `amountDb` (`getDuckingFilter`); *knee* 1, ataque 50 y relajación 400 (`DUCKING_ATTACK`/`DUCKING_RELEASE`). Así la música baja `amountDb` con cualquier clip por encima de unos −30 dBFS y nunca más, y el ruido de fondo por debajo de −40 dBFS apenas la mueve.
   - `amix` de 2 entradas (clips + música) con `normalize=0:duration=first`. Valor por defecto de `volumeDb` al elegir un fichero: −12 dB (`DEFAULT_MUSIC_VOLUME_DB`).
5. **Salida**: `atrim` a la duración, `alimiter=limit=−1 dBFS:level=disabled:latency=1` (`latency=1` compensa el retardo del *lookahead*: sin él, el audio llega 5 ms tarde), `afade` in/out global de `getGlobalFadeDuration(settings)` (= `D` si `fadeInOut`; el vídeo debe usar la misma) y `aformat` final estéreo 48 kHz.

**Demo**: `node script/videomix/audioDemo.ts [--music] [--playlist] [--ducking [amountDb]] [--columns n]` mezcla los medios de T02 con el planificador real y mide la sonoridad integrada de cada tramo; con `--playlist` y `--ducking` comprueba los fundidos de la lista y la bajada de la música (T27). Para cargar módulos del renderer desde Node, `script/videomix/rendererImports.ts` registra un *hook* de resolución (imports sin extensión e `import.meta.env`).

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
- **Cadenas y secuencia (T39, `clipLinks.ts`)**:
  - Indicador de cadena en las filas (icono de enlace y "posición/longitud", las mismas cadenas que el planificador: `getClipLinkInfos`). El icono de un clip enlazado rompe el enlace con el anterior; un enlace roto a mano se muestra con otro icono que lo vuelve a crear. En el menú contextual: "Romper enlace con el anterior" / "Enlazar con el anterior". `getSetClipLinkAction` solo guarda `link` si difiere de la regla automática (`'break'` o `'force'`), así que volver a enlazar un par que la regla ya enlaza quita el campo.
  - Sección **Siempre visible** encima de la lista: la secuencia en orden, ordenable con dnd-kit (mismo `DndContext` que la lista, ids con prefijo), con botón para quitar cada clip; se añaden clips arrastrándolos desde la lista (al final o delante de un clip de la secuencia) o con el menú contextual (los clips seleccionados si el clip lo está). Las filas de la lista muestran un indicador con su número en la secuencia.
  - Vista Mix: los bloques de una cadena van seguidos en el mismo carril y el enlazado se marca con un borde discontinuo y un icono; los de la secuencia llevan una franja verde e icono de ojo.

### 6.6 Montaje, previsualización y render

- **Diálogo "Ajustes de montaje"** con todos los `MixSettings`.
- **"Previsualizar"**:
  1. Se calcula el plan y se muestra el *Timeline del montaje*: carriles por columna a lo largo del tiempo, bloques con el color o nombre del clip, marcas de re-layout y zonas de relleno.
     - **Filas compactas (G3, T53)**: el planificador da un id nuevo a cada columna que abre más tarde, así que las columnas que no coinciden en el tiempo comparten carril (`mixPlanLayout.getMixLanes`): tantos carriles como columnas a la vez. Una columna ocupa su carril desde que entra en el layout hasta que termina su último clip (una columna quitada por un re-layout lo sigue ocupando mientras encoge). Se asignan en orden de inicio (coloreado voraz de intervalos, óptimo); entre los carriles libres se elige el que queda entre los de sus vecinos en su primer *keyframe* (arriba = izquierda), y si no hay ninguno libre se inserta uno nuevo ahí. Una columna nunca cambia de carril, así que el orden arriba-abajo = izquierda-derecha se cumple "en lo posible" (≈ 91 % de los *keyframes* en los tests).
     - **Zoom y scroll (A3, T53)**: `zoom` de sesión (no se guarda) en `MixPlanView`; los carriles miden `zoom` × el ancho visible dentro de un contenedor con scroll horizontal, así que todas las posiciones siguen siendo porcentajes de la duración. Eje de tiempo *sticky* encima de los carriles (solo dibuja las marcas visibles). Cálculos puros en `mixPlanZoom.ts`.
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

`MixProject` pasa a **`version: 2`**, con migración automática desde v1 (`overlays: []`). Desde T24 se guarda en v3 (§9). Esquemas zod en `videomix/types.ts`; la lógica, en `videomix/overlays/`. Detalle completo y API en las notas de [T19](execution/T19-overlays-modelo.md).

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

// v3 (T24, §9): TextOverlay { type: 'text', text, duration, box, align, color, font?, border, shadow?, lineSpacing, fadeIn, fadeOut, entry }
type MixOverlay = ImageOverlay | CountdownOverlay | ProgressBarOverlay | SoundOverlay | TextOverlay;
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
- Estado de la UI en `hooks/useMixOverlays.ts` (plan, tiempos resueltos, selección, cursor de la vista "Mix"); lógica pura en `overlayTimeline.ts` (carriles, arrastres, cajas) y `overlayRemoval.ts`. El panel (`components/OverlayPanel.tsx`) ocupa la barra derecha mientras hay un elemento seleccionado en la vista "Mix".
- **Borrados**: `useMixProject.dispatch` añade `resolved` a toda acción que borre algo de lo que dependan elementos (también dentro de `batch`) y avisa con un toast; así ningún punto de llamada puede olvidarlo.
- **Duración de los sonidos en la UI**: se obtiene con ffprobe (`getDuration`) la primera vez que aparece cada fichero y se guarda en memoria durante la sesión (`hooks/useOverlaySoundDurations.ts`). El render usa la de T21.

## 9. Mejoras v2 (T24–T34)

Requisitos: [01-requisitos §10](01-requisitos.md). Resumen técnico; cada task-doc concreta los detalles.

- **Formato v3** (T24, implementado): todos los cambios de modelo en una sola migración v2 → v3 (v1 → v2 → v3 encadenada). Se guarda siempre en v3. Detalle, API y decisiones en las notas de [T24](execution/T24-v2-modelo.md).
  - `settings.output = { aspect: '16:9' | '9:16' | '1:1', resolution: '720' | '1080' | '2160' }` sustituye a `resolution` (`'1080p'` → `{ aspect: '16:9', resolution: '1080' }`). La resolución es el **lado corto**; tamaños exactos en `mixOutputSizes` y `getOutputSize(output)` (1280×720, 720×1280, 720×720…).
  - `settings.encoder = { codec: 'h264' | 'h265', hardware: 'auto' | 'none' | 'nvenc' | 'qsv' | 'videotoolbox' | 'vaapi' }`, por defecto `h264` / `auto` (esquema en `src/common/videomix/encoder.ts`, para main). Hasta T25 el render usa siempre libx264.
  - `settings.music?` pasa a ser `settings.musicPlaylist = { tracks: { id, path, absolutePath, volumeDb }[], crossfade: 2, loop, ducking: { enabled: false, amountDb: -10 } }`. La música de v2 se migra a una pista (id `'music'`) y conserva `loop`; sin música, `tracks: []`. La medida de sonoridad va por pista (clave de cache por fichero; en el mapa de `ensureLoudness`, bajo el id de la pista). Desde T27, `buildAudioGraph` usa la lista completa, con fundidos cruzados y *ducking* (§5.2).
  - Nuevo overlay `type: 'text'`: `text` (multilínea con `\n`), `duration`, `box`, `align`, `color`, `font?`, `border`, `shadow?`, `lineSpacing` (fracción del tamaño de letra), `fadeIn`, `fadeOut` y `entry: { kind: 'none' | 'slide' | 'typewriter', from?: 'left' | 'right' | 'top' | 'bottom', duration }`. T26 añade `fontSize?` (fracción del alto del fotograma, aditivo: si falta, sale de la caja como antes) y lo dibuja (ver [§9.1](#91-textos-y-presets-t26)).
  - En los clips, `pinTime?: number` (fijar a un momento) y `groupId?: string` (agrupar; un grupo necesita ≥ 2 clips: el reducer disuelve los grupos que se quedan con uno). El planificador los usa desde T30 (§3.6).
- **Ajustes manuales del plan** (T30, implementado): planificador en §3.6. UI: selección múltiple de clips (Ctrl/Cmd y Mayús) en la lista y en la vista Mix; menú de clip con "Fijar aquí" (en el cursor de Mix), "Quitar fijación", "Agrupar seleccionados" y "Desagrupar"; chincheta y color de grupo; arrastrar un bloque en la vista Mix lo fija donde se suelta (un paso de deshacer). Lógica pura en `clipGroups.ts`; hook `hooks/useMixClipPins.ts`.

  Los presets (B2) no van en el proyecto: se guardan en la configuración global (`configStore`, clave `overlayStylePresets`, T26). Su tipo, `OverlayStylePreset` (`src/common/videomix/overlayStyles.ts`), guarda solo propiedades de estilo; los esquemas de los overlays de texto, contador y barra se construyen a partir de los mismos esquemas de estilo.
- **Salida vertical** (T29, implementado): el planificador trabaja en un **eje principal** (`LayoutAxis = 'columns' | 'rows'`, `geometry.ts`).
  - `MixPlan.axis` (ausente = `columns`, `getPlanAxis`). En `layouts`, `x`/`width` son desplazamiento y longitud **a lo largo del eje**: x/ancho de salida en columnas, y/alto en filas; una fila ocupa todo el ancho. `getCellRect` da el rectángulo de salida.
  - En 9:16 se trasponen las proporciones (`a → 1/a`, `transposeAspectRange`) y los rectángulos (`transposeRect`) de los clips y el planificador de columnas trabaja sin cambios sobre el eje vertical: filas a ancho completo apiladas, nunca lado a lado. Un plan en filas es exactamente el plan en columnas de los clips traspuestos (test).
  - En 1:1, `planMix` planifica en ambos ejes (`planMixAxis`) y gana el de menor `PlanScore` (relleno, recortes/upscale/letterbox por clip ponderados por tiempo, re-layouts y orden, con los pesos de §3.4); empate → columnas. Se decide una vez por proyecto. La previsualización usa el eje que elige el render final.
  - Avisos (`pillarbox`, `letterbox`, `upscale`) siempre en términos de salida; el `fill` lleva la longitud en el eje (un alto en filas). `validatePlan` comprueba además el tamaño y el eje esperado.
  - `renderTimeline` y `buildVideoGraph` usan la longitud del eje (`getPlanAxisLengths`): capas de fila a ancho completo ancladas arriba, `overlay=x=0:y=…`, barras de separación horizontales, rellenos y animaciones igual que en columnas. Los overlays (cajas 0..1) no cambian.
  - UI: selector de proporción en Ajustes → Salida; la mini vista dibuja filas y los carriles del timeline son las filas de arriba abajo. Previsualización: lado corto de 360 px con la proporción de la salida (`getPreviewSize`).
- **Render incremental** (T28, implementado): clave de bloque = hash del grafo del bloque + ficheros de entrada (ruta, mtime, tamaño) + parámetros de codificación. Los bloques y la pasada de audio se guardan en `.<proyecto>.vmx.cache/` (oculta en macOS/Linux); el concat final reutiliza los que existan. Hay limpieza de bloques huérfanos tras cada render y un tamaño máximo global. Detalle en §4.2.
- **Encoders** (T25): se detectan en main con `ffmpeg -encoders` más una prueba de codificación corta. Los argumentos se mapean por encoder, con un control de calidad equivalente a CRF.
- **Previsualización en vivo** (T32, implementado; detalle en [T32](execution/T32-v2-preview-vivo.md)): en la pestaña Mix, el área del player muestra la composición en un `<canvas>` (`components/MixLivePreview.tsx`, `hooks/useMixLivePreview.ts`, `preview/`).
  - Lógica pura con tests en `preview/`: reloj maestro y corrección de deriva (`previewClock.ts`), qué vídeos y pistas cargar y su *pool* de elementos (`previewSchedule.ts`), lista de dibujo por fotograma con la geometría del render (`previewDraw.ts`: `getColumnsAtFrame`, `getFillSpansAtFrame`, `getCropForAspect`), overlays con `overlayFrames`/`textLayout` (`previewOverlays.ts`) y ganancias de audio (`previewAudio.ts`: normalización, `getPlacementFades`, `getCompensationSteps`, `getMusicSchedule`, *ducking* aproximado).
  - `previewCanvas.ts` pinta con `drawImage` y el recorte de la fuente; `previewEngine.ts` aplica todo al DOM (elementos `<video>`/`<audio>`, grafo WebAudio, `requestAnimationFrame`).
  - Aproximaciones: todas las transiciones se ven como fundido cruzado; el desenfoque del relleno es un desenfoque barato de la columna más cercana; el *ducking* sigue la actividad de los clips y no la señal; el limitador es un `DynamicsCompressorNode`; solo se usa la sonoridad ya cacheada.
  - El reloj de la previsualización manda sobre los vídeos (salto si la deriva supera 0,15 s; ajuste de `playbackRate` de ±5 % si es menor).

### 9.1 Textos y presets (T26)

Detalle en las notas de [T26](execution/T26-v2-textos-presets.md).

- **Tamaño y caja**: `fontSize` es una fracción del alto del fotograma. La UI mantiene la caja **ajustada a las líneas** (`alto = n · tamaño + (n − 1) · lineSpacing · tamaño`, `overlays/textLayout.ts`): al cambiar el texto, el tamaño o el interlineado, la caja crece o encoge y el tamaño no cambia; al redimensionar la caja en la mini vista, cambia el tamaño. El render centra el bloque de líneas en la caja, así que una caja desajustada (proyecto editado a mano) sigue funcionando.
- **Render** (`render/overlayFilters.ts#addText`):
  - un `drawtext` por línea, con `expansion=none` (texto literal) y el doble escapado de T20; cada línea se alinea en la caja por su propio `text_w`;
  - posición vertical por métricas de la fuente: `y_align=font` e `y = centroLínea − (font_a + font_d)/2`, así todas las líneas tienen la misma base aunque cambien sus glifos;
  - *fades* con `alpha` lineal (fotogramas absolutos, como el contador);
  - *slide*: `x` o `y` con *ease-out* cúbico `pow(1 − min(1, fotogramasDesdeInicio/E), 3)`, desde fuera del fotograma por el lado elegido;
  - *typewriter*: un `drawtext` por paso con su `enable`, sin `if()`. Un prefijo se dibuja como `prefijo\nlínea entera` con `line_spacing` enorme, de modo que la línea entera queda fuera del fotograma pero `text_w` es el de la línea entera: el prefijo aparece ya en su sitio final con cualquier alineación.
- **Mini vista**: misma disposición (CSS con `line-height = 1 + lineSpacing`), *fades*, desplazamiento del *slide* y prefijo del *typewriter* en ese instante; la fuente es la del sistema.
- **Presets (B2)**: `Config.overlayStylePresets: OverlayStylePreset[]` (por defecto `[]`; al arrancar se descartan las entradas no válidas). El renderer los lee y escribe con `configStore` (`hooks/useOverlayStylePresets.ts`); lógica pura en `overlayStylePresets.ts`. Aplicar un preset sustituye todo el estilo (también quita fuente o sombra) y, en un texto, reajusta la caja. Exportar/importar: JSON `{ format: 'videomix-overlay-styles', version: 1, presets }`; al importar, los ids repetidos se renuevan y las entradas no válidas se ignoran.

## 10. Mejoras v4 (T44–T50)

Requisitos: [01-requisitos §12](01-requisitos.md). Modelo y lógica pura en T44 (detalle, contratos y decisiones en las notas de [T44](execution/T44-v4-modelo.md)); UI y render en T45–T49.

### 10.1 Modelo v5 (T44)

Migración v4 → v5 **aditiva** (solo cambia `version`); `settings.autoCropBlackBars` se rellena con el valor por defecto (`true`) como el resto de ajustes que faltan.

```ts
type MixKeyframeInterpolation = 'smooth' | 'linear' | 'hold';

interface MixClipKeyframe {
  time: number,        // segundos de la fuente (como start/end)
  centerX: number,     // centro del máx. animado, px del fotograma (girado) del clip
  centerY: number,
  scale: number,       // tamaño relativo al maxRect base (> 0; 1 = mismo tamaño, < 1 = zoom de acercamiento)
  interpolation?: MixKeyframeInterpolation | undefined,  // hacia el siguiente; sin definir = 'smooth'
}

interface BlackBarsDetection {
  rect: Rect,                                   // zona con imagen, px de visualización de la fuente (todo el fotograma si no hay bandas)
  frame: { width: number, height: number },     // tamaño de visualización al que se refiere
  file: { size: number, mtimeMs: number },      // identidad del fichero (fs.stat) al analizarlo
}
```

- `MixClip.keyframes?` (ordenados; lista vacía = no se guarda), `MixSource.blackBars?` y `MixSettings.autoCropBlackBars`.
- Reducer: `updateClip` normaliza `keyframes` (orden y vacía → sin definir); `rotateClip` gira los keyframes con los rectángulos; `relinkSource` (B2) los reescala; `setSourceBlackBars` guarda la detección. `useMixProject().setSourceBlackBars` la aplica **sin historial ni `dirty`**, como `setSourceMeta`.
- Validación: `invalid-keyframes` (error) si hay valores no finitos o tiempos desordenados o repetidos.

### 10.2 Encaje en fracciones, imán y "Ajustar a" (F1, F2; `fitFractions.ts`)

- **Celda de una fracción** `k/n` (1/3, 1/2, 2/3, completo) en el eje principal: `L = k·Tₙ/n + (k − 1)·gap`, con `Tₙ = floorEven(principal − (n − 1)·gap)`, el ancho útil que `distributeWidths` reparte entre n columnas. 2/3 son dos tercios más una separación. En filas (9:16, o 1:1 en filas) es un alto: todo se calcula traspuesto.
- **Estado**: con los rectángulos normalizados a pares y `getTolerantWidthRange(getMainAspectRange(...), transversal)` = `[wmin, wmax]` (T44b: con la tolerancia del 1 %, §2.7; `exact: true` usa `getWidthRange`):
  - `fits` si `wmin ≤ L ≤ wmax` (para 1/n equivale exactamente a que `distributeWidths` de n clips iguales no deje relleno: test);
  - `extends` si `L > wmax`, E7 activo y `L ≤ floorEven((principalMáx + margen)·transversal / transversalMín)` (el `maxLength` de `extendPlan`): necesita ampliar más allá de lo que da la tolerancia;
  - `no`, con `missing` (el máx. debe crecer en el eje principal) o `excess` (el mín., o el máx. sin mín., debe encoger): el menor número **par** de px de la fuente que cumple la condición con el redondeo de los límites (con la tolerancia, ~1 % menos que sin ella).
- **Imán** (`snapRectEdge`): el borde arrastrado del máx. o del mín. se engancha a la **proporción exacta de la celda** (ancho = alto × proporción al arrastrar izquierda/derecha; alto = ancho / proporción al arrastrar arriba/abajo), redondeado a par, si la diferencia es ≤ umbral (px de fuente) y no se sale de los límites.
- **"Ajustar a" sin mín.** (`fitMaxRectToFraction`): máx. con la proporción de la celda; conserva su longitud transversal si puede (si no, la más cercana que cabe en el fotograma), centrado en el máx. actual y desplazado dentro del fotograma; bordes pares.
- **"Ajustar a" con mín.** (G5, v5, T54: `fitMinRectToFraction`): en vez del máx., se ajusta **el mín.**, solo en el eje principal y centrado en el propio mín. (su longitud transversal, su posición en el eje transversal y el máx. quedan igual), para que el ancho más estrecho del clip (`min.w / max.h`, el extremo inferior de `getAspectRange`) sea exactamente la fracción; crece o encoge según haga falta. Si el máx. no es lo bastante ancho para contener ese mín. (no "alcanza" la fracción), se ensancha en el eje principal, centrado en sí mismo, lo justo para contenerlo (mín. = máx. en ese eje), recortado al fotograma; si ni todo el fotograma basta, falla con `no-room`. Ambas apuntan al encaje exacto (ajuste de ±2 px por el redondeo); si solo se alcanza con la tolerancia (T44b) también vale. La barra elige una función u otra según haya mín.
- **Clips rígidos** (sin mín.): exactamente solo encajan si `L` es un número par de px de salida (p. ej. 1/3 de 1280 = 426,67 no lo es). Desde T44b encajan con la tolerancia: el planificador coloca tres iguales sin relleno, recortando < 1 % de alto (o de ancho) a alguno (§2.7).
- **UI (T45; G5 en T54)**, detalle en las notas de [T45](execution/T45-v4-encaje-ui.md) y [T54](execution/T54-v5-ajustar-min.md):
  - **Eje**: el de la salida; en 1:1, el del último plan calculado (la vista Mix), o columnas si aún no hay ninguno (`useFitLayout`).
  - **Chips** (`FitChips`) sobre el recorte, con los rectángulos de cada paso del arrastre: debajo del máx. (fuera de sus tiradores) o, si no hay sitio, dentro de él justo encima de los tiradores de abajo; sin eventos de puntero. **Lista de clips**: las fracciones con ✓ (verde) o ↔ (ámbar), ✗ si ninguna; el detalle en el tooltip.
  - **Imán** (`snapRectDrag`): toggle de la barra, preferencia de la app `fitMagnet` (desactivado por defecto); Alt durante el arrastre lo invierte (también al pulsarlo o soltarlo sin mover el ratón). Umbral de 8 px de pantalla; en una esquina engancha el borde del eje principal; no engancha si el máx. tiene la proporción bloqueada ni si el máx. enganchado dejaría fuera al mín.
  - **"Ajustar a 1/3 / 1/2 / 2/3"**: un paso de historial (`updateClip`, del mín. y quizá el máx. si hay mín., si no del máx.); quita el bloqueo de proporción; si falla (`min-too-large` sin mín., `no-room` con mín.), aviso con el motivo.

### 10.3 Keyframes del encuadre (A9; `clipKeyframes.ts`)

- **Representación**: cada keyframe es una transformación del `maxRect` base: centro (`centerX`, `centerY`) y escala uniforme `scale`. Máx. animado = tamaño del base × `scale`, centrado en el centro; el mín. se escala igual y conserva su posición relativa dentro del máx. **La proporción no cambia nunca**, así que el intervalo de proporciones, el encaje y el planificador siguen usando los rectángulos base.
- **Curvas**: entre dos keyframes todos los bordes se mueven con el mismo peso `w = ease(u)`, `u = (t − t₀)/(t₁ − t₀)`, según la interpolación del primero: `smooth` = `u²·(3 − 2u)` (smoothstep), `linear` = `u`, `hold` = 0 hasta el siguiente. `centro = c₀ + w·(c₁ − c₀)`, `escala = s₀ + w·(s₁ − s₀)`. Antes del primero y después del último se mantienen los extremos (los que quedan fuera del tramo del clip se conservan).
- **Dentro del fotograma**: `clampTransform` limita primero la escala (el máx. cabe) y luego el centro. `getClipRectsAt(clip, t, fotograma)` devuelve los rectángulos pares y dentro del fotograma; sin keyframes, exactamente los guardados.
- **Transformaciones**: `rotateKeyframes` (E9), `rescaleKeyframes` (B2, A5), `shiftKeyframes` (A5).
- **Render, previsualización y miniaturas** (T48, [ADR-003](decisiones/ADR-003-keyframes-render.md)): `getAnimatedCellCrop({ clip, aspect, time, frame, extendedMaxRect })` (`animatedCrop.ts`) da el recorte de una celda en un instante de la fuente: el de `getExtendedCropForAspect` sobre los rectángulos base, movido y escalado con la transformación limitada al fotograma, en números reales; E7 amplía `extra · escala` alrededor del máx. animado, dentro del fotograma. Lo usan el render (por fotograma: `perspective` en columnas estables, capa de columna en re-layouts) y la previsualización en vivo (tiempo real de la fuente). Las miniaturas muestran el máx. animado en `clip.start` (`getThumbnailMaxRect`, pares).

- **Edición (T49)**, detalle en las notas de [T49](execution/T49-v4-keyframes-ui.md):
  - **"Animar"** (cronómetro de la barra): primer keyframe en el cursor con la transformación base (`getBaseTransform`). Desactivarlo (con confirmación) borra los keyframes y deja como rectángulos base el encuadre del cursor (`getClipRectsAt`); igual al borrar el último keyframe.
  - **Auto-key** (`ClipRectEditor` + `getAnimatedRectsEdit`): con keyframes, el overlay muestra `getClipRectsAt(clip, cursor)`; mover o escalar el máx. (proporción bloqueada a la base, imán desactivado sobre él) añade o actualiza el keyframe del instante (`setKeyframe`, `KEYFRAME_TIME_EPSILON`); editar el mín. cambia el mín. base (relativo al máx.: en todos los keyframes). Un gesto = un paso de historial (edición transitoria + commit); el instante se congela al empezar el gesto.
  - **Barra**: las acciones sobre la proporción o el mín. (proporción, "Ajustar a", "Rellenar fotograma", mín.) editan los rectángulos base: cada keyframe conserva centro y escala relativa. "Quitar bandas negras" recorta la base y limita cada keyframe a la imagen (`limitKeyframesToRect`; al ser lineales los bordes entre keyframes, toda la animación queda dentro). Pegar el encuadre (A5) sustituye los keyframes del destino por los copiados (o los quita si el copiado no está animado).
  - **Marcas** (rombos) de los keyframes del clip activo en la línea de tiempo; anterior / siguiente (`Mayús+,` / `Mayús+.`), añadir y borrar (`Mayús+Retroceso`) el del cursor e interpolación del keyframe del cursor en la barra (`useClipKeyframes`).
  - **La barra del editor** va en una franja encima del reproductor (portal a `useMixToolbarSlot`; el área del reproductor empieza debajo), así nunca tapa tiradores ni etiquetas.

### 10.4 Copiar y pegar el encuadre (A5; `clipFraming.ts`)

- `copyClipFraming` guarda máx., mín., giro, keyframes, el fotograma (girado) del clip y su inicio. `getPasteFramingAction` genera un `batch` de `updateClip` (un paso de historial): el destino toma el giro; si su fotograma girado es de otro tamaño, rectángulos como B2 (`rescaleClipRects`) y centros de keyframes con el mismo mapeo; los keyframes conservan su desfase respecto al inicio del clip. Devuelve los clips con otra proporción (aviso) y los omitidos (tamaño de fuente desconocido). No se copian E7 ni el audio.

### 10.5 Bandas negras (A7; `blackBars.ts`, `common/videomix/cropDetect.ts`)

- `parseCropDetectOutput`: unión de los límites crudos (`x1…y2`) de todas las líneas de `cropdetect` (varias muestras), ignorando las vacías (fotogramas negros).
- `cropDetectToDisplayRect`: píxeles codificados (tras el autorotate de ffmpeg) → visualización: eje estirado × SAR, redondeo hacia fuera, dentro del fotograma; `turn` opcional si se analizó sin autorotate.
- `getPictureRect`: ignora bandas < 4 px (`BLACK_BARS_MIN_SIZE`), bordes pares hacia dentro. `getNewClipMaxRect`: máx. inicial de un clip nuevo (con `autoCropBlackBars` y detección válida para el tamaño). `removeBlackBarsFromRects`: botón "Quitar bandas negras" (recorta el máx., nunca lo agranda, y el mín. con él).
- Caché por fuente en `MixSource.blackBars`; `isBlackBarsDetectionValid` la invalida si cambia el tamaño de visualización o la identidad del fichero (tamaño, mtime).
