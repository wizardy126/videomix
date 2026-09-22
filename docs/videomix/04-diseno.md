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

Carpeta: `src/renderer/src/videomix/planner/`.

- **Entrada**: la lista ordenada de clips (duración e intervalo de proporciones de cada uno) y los ajustes (W, H, maxColumns, gap, reorderWindow, orden/semilla, duración de la transición).
- **Salida**: `MixPlan`.

### 3.1 Salida: `MixPlan`

```ts
interface ColumnPlacement {        // un clip reproduciéndose en una columna
  clipId: string,
  column: number,                  // identificador estable de columna (no su índice visual)
  startTime: number,               // en el vídeo final (s)
  endTime: number,                 // startTime + duración del clip
}

interface LayoutKeyframe {         // disposición de la fila a partir de un instante
  time: number,                    // inicio del cambio
  transitionDuration: number,      // 0 = cambio instantáneo; >0 = animación de anchos
  columns: { column: number, x: number, width: number }[],  // en píxeles de salida, izquierda→derecha
  fills: { x: number, width: number }[],                    // huecos sin clip (relleno)
}

interface MixPlan {
  width: number, height: number, duration: number,
  placements: ColumnPlacement[],
  layouts: LayoutKeyframe[],       // ordenados por tiempo; el primero en t=0
  crops: Record<string, Rect[]>,   // opcional: cache de recortes por clip/layout; el generador puede recalcular con geometry
  warnings: PlanWarning[],         // upscale > x2, letterbox forzado, clip demasiado corto, etc.
}
```

### 3.2 Reglas: invariantes que los tests deben verificar

1. **Todos los clips aparecen exactamente una vez**, enteros: `endTime − startTime = duración del clip`.
2. **Nunca hay más de `maxColumns` columnas visibles.**
3. En cada instante, la suma de anchos de las columnas visibles, más los huecos, más el relleno, es igual a `W`.
4. **Sustitución en columna**: el clip entrante empieza `transition.duration` antes de que termine el saliente. Ese solape es el xfade.
5. **El orden relativo de la lista solo se altera dentro de la ventana `reorderWindow`**: un clip no puede adelantarse ni retrasarse más de N posiciones respecto a su índice en la lista. En modo aleatorio, la lista base es una permutación determinista a partir de la semilla.
6. **Inicio**: todas las columnas iniciales empiezan en `t = 0`.
7. **Final**: cuando no quedan clips, las columnas que terminan se convierten en relleno y no hay re-layout.
8. **Determinismo**: la misma entrada produce el mismo plan.

### 3.3 Algoritmo base: simulación por eventos (guía, ajustable por el implementador)

1. **Estado inicial**. Se toma la cola de clips y se elige el conjunto inicial:
   - Se añaden clips en orden, respetando la ventana, mientras el conjunto sea factible (`Σ aMin ≤ T`) y `n ≤ maxColumns`.
   - Se para cuando `Σ aMax ≥ T`: el fotograma se llena.
   - Entre alternativas se elige la que minimice la puntuación de §3.4.
2. **Evento "fin de clip"** en `t`: la columna `c` queda libre en `t − D`, siendo `D` la duración de la transición.
   1. **Candidatos**: los clips de la ventana de la cola.
   2. **Sustitución directa**: si algún candidato admite exactamente el ancho de `c` (`w_c / H ∈ [aMin, aMax]`), se toma el primero en orden. No hay re-layout.
   3. **Re-layout**: si ninguno encaja, se evalúan estas opciones:
      - (a) un candidato con re-reparto de anchos de toda la fila;
      - (b) dos candidatos en el hueco, si `n < maxColumns`;
      - (c) eliminar la columna y expandir las demás;
      - (d) todas las combinaciones factibles dentro de la ventana.

      Se elige la de menor puntuación. El re-layout genera un `LayoutKeyframe` con `transitionDuration = D`, que empieza cuando empieza la transición del clip entrante.
   4. Si quedan clips en la cola pero **ninguna opción es factible**, se permite relleno.
3. **Eventos simultáneos**: si dos clips terminan a menos de `D` de distancia, se procesan juntos en un único re-layout. Así se evitan animaciones solapadas.
4. **Cola vacía**: las columnas que terminan pasan a ser relleno.

### 3.4 Puntuación (menor es mejor; pesos como constantes documentadas)

- Área de relleno (penalización fuerte).
- Número de re-layouts.
- Desviación respecto al orden de la lista.
- Upscale > ×2.
- Desviación de cada columna respecto a su `aPref`: mostrar menos de lo que el usuario marcó.
- Número de columnas lejos de 2–3: ligera preferencia por el rango habitual.

### 3.5 Aleatoriedad

PRNG con semilla (p. ej. mulberry32) implementado en el módulo. No se usa `Math.random`. Así se preserva el determinismo y los tests son estables.

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
