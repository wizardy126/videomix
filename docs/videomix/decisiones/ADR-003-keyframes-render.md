# ADR-003 · Recorte animado (keyframes de paneo y zoom) en el render

- **Tarea**: T48 (mini-spike + implementación) · **Estado**: aceptada
- **Afecta a**: render (`render/buildVideoGraph.ts`), previsualización en vivo (`preview/previewDraw.ts`), miniaturas (`thumbnails.ts`); amplía [ADR-001](ADR-001-render.md)

## Resumen

- **Columna de ancho constante** (el caso normal: un clip animado dentro de un bloque estable): **`crop` fijo de la unión de los recortes → `perspective` (`sense=source`, `eval=frame`, interpolación lineal) → `scale` fijo a la celda**. `perspective` lleva las cuatro esquinas del recorte de cada fotograma, **en coordenadas reales (sub-píxel)**, a una imagen de tamaño fijo; el resto del camino es el estático de siempre (`scale` a la celda, pillarbox/letterbox con fondo desenfocado, `xfade`).
- **Columna de ancho variable** (el clip animado coincide con un re-layout): la **capa de columna de ADR-001** (`crop` de la unión → `scale eval=frame` → `overlay`), con el recorte animado de cada fotograma. Mantiene su cuantización de 2 px, aceptada en ADR-001 para animaciones cortas.
- **Coste** (1080p, 4 vCPU, sin codificar): `perspective` añade **~8–11 ms por fotograma** frente al recorte estático, lo mismo que la capa de columna a 1080p y el doble a 720p. Con x264 medium a 1080p (~21 ms/fotograma) un clip animado encarece su bloque ~1,5×. Con una fuente 4K el coste sube a ~31 ms, así que la unión se **pre-escala** cuando la fuente tiene al menos el doble de la resolución que necesita el fotograma más ampliado (4K en una columna de 640 px: 31 → 7 ms).
- **Precisión** (puntos blancos sobre negro, error del centroide frente a la posición exacta): `perspective` **0,04–0,11 px** de media y **0,05 px** de "vibración" (cambio del error de un fotograma al siguiente); la capa de columna, 0,7–1 px de media, hasta 3 px, y **~1–1,6 px de vibración**: en un paneo lento (medio píxel por fotograma) se ve a saltos.
- **Sin keyframes el grafo no cambia** (snapshots existentes idénticos). Un clip animado que no se mueve en todo el bloque (mantiene un keyframe, o está antes/después de ellos) usa el camino estático con ese encuadre redondeado a px pares.

## Contexto

- A9 (01-requisitos §12): se animan posición y escala del máx. y el mín. juntos, **sin cambiar su proporción**, dentro del fotograma de la fuente; curvas suave (smoothstep), lineal y mantener. Modelo y fórmulas en T44 (`clipKeyframes.ts`, 04-diseno §10.3).
- En ffmpeg, **`crop` no admite un tamaño de salida que cambie por fotograma** (ADR-001 §3: `w`/`h` se evalúan al configurar; `sendcmd` corrompe la imagen). El recorte de un zoom cambia de tamaño en cada fotograma, así que hace falta otra técnica.
- El recorte de cada fotograma debe ser el mismo que calculan las funciones de encaje (`getCropForAspect`/`getExtendedCropForAspect`, con la tolerancia de T44b y la ampliación E7) sobre los rectángulos animados, y convivir con SAR (B1), giros (E9), re-layouts, cadenas, transiciones y la caché incremental (T28).

## Entorno de medida

La misma VM que ADR-001: 4 vCPU Xeon @ 2,1 GHz, `ffmpeg n8.0-23` (BtbN). Las medidas se tomaron con otro agente trabajando en paralelo: los tiempos varían ±20 % entre repeticiones; se da el mínimo de 3.

## Reproducir

```bash
node script/videomix/spike/keyframeSpike.ts 1280 720    # celda 1280x720 (también 1920 1080, 640 360)
```

Salidas en `test-media/spike-out/keyframes/` (ignorado por git): los grafos de cada técnica y dos fuentes generadas (`dots.mp4`, sin pérdidas; `src-2160p.mp4`).

- **Animación**: 90 fotogramas a 30 fps. 1,5 s de paneo lineal lento (30 px de fuente en 45 fotogramas, ~0,5 px de salida por fotograma) y 1,5 s de zoom *smoothstep* a la mitad del tamaño (recorte de 1600×900 a 800×450, 16:9 como la celda).
- **Precisión**: fuente 1920×1080 estática con cuatro puntos blancos de 12×12 px. En cada fotograma de salida se mide el centroide de cada punto visible y se compara con su posición exacta `(P − C.xy) · celda / C.tamaño`. "Vibración" = RMS del cambio del error medio entre fotogramas consecutivos.
- **Coste**: solo decodificar y filtrar (`-f null`) `h-1080p-10s.mp4` (T02), menos el mismo grafo con un recorte estático (`crop` + `scale`). Para 4K, la misma animación al doble de tamaño sobre una `testsrc2` 3840×2160 generada.

## Opciones evaluadas y medidas

| Técnica | Celda 1280×720: coste | Error medio / máx. | Vibración | Celda 1920×1080: coste | Error medio / máx. | Vibración |
|---|---|---|---|---|---|---|
| Capa de columna, recortes pares por fotograma (como `getClipRectsAt`) | +3,1 ms/fot. | 0,81 / 3,04 px | 1,20 px | +6,3 ms | 0,97 / 3,14 px | 1,58 px |
| Capa de columna, recortes reales | +3,0–3,5 ms | 0,78 / 2,69 px | 0,95 px | +7,1–8,8 ms | 0,77 / 2,64 px | 1,12 px |
| **`perspective` lineal** | **+7,8 ms** | **0,07 / 0,41 px** | **0,05 px** | **+7,6–11,2 ms** | **0,11 / 0,67 px** | **0,06 px** |
| `perspective` cúbica | +13,8 ms | 0,07 / 0,42 px | 0,04 px | +14–18 ms | 0,12 / 0,63 px | 0,07 px |
| `scale eval=frame` + `crop` de tamaño fijo con `x`/`y` por fotograma | +1,4–3,2 ms | 0,52 / 2,01 px | 0,74 px | +2,5–2,8 ms | 0,50 / 2,24 px | 0,60 px |
| `zoompan` | descartado sin medir (ver abajo) | | | | | |

Referencias: el recorte estático cuesta 0,23–0,27 s para los 90 fotogramas; **x264 medium** sobre ese recorte, **12,8 ms/fotograma a 1280×720 y 20,8 ms a 1920×1080** (4,5 ms a 640×360).

**Fuente 4K** (la unión de `perspective` es de hasta 3200×1800):

| | Celda 640×360 | Celda 1280×720 | Celda 1920×1080 |
|---|---|---|---|
| Capa de columna | +2,8 ms | +3,7 ms | +5,8 ms |
| `perspective` | +31,1 ms | +30,4 ms | +31,4 ms |
| `perspective` pre-escalada (`k` = 0,4 / 0,8 / 1) | **+6,6 ms** | +22,0 ms | +30,9 ms |

Observaciones:

1. **Capa de columna** (ADR-001): funciona sin cambios con cualquier recorte por fotograma, pero `overlay` coloca en px pares (yuv420p) y `scale` da tamaños pares. En los re-layouts (0,5 s, todo en movimiento rápido) es invisible; en un paneo lento de varios segundos se ve **a saltos** (el error cambia ~1–1,6 px de un fotograma a otro). Redondear además los rectángulos a px pares de la fuente (como `getClipRectsAt`) lo empeora un poco.
2. **`perspective`** con `sense=source` recibe las cuatro esquinas del recorte en coordenadas de su entrada (números reales) y remuestrea toda la imagen: el recorte queda exacto al sub-píxel y con tamaño de salida fijo (el de su entrada, la unión). La **interpolación cúbica** cuesta casi el doble sin mejorar la precisión medida: se elige la lineal (el `scale` bicúbico posterior hace el cambio de tamaño principal).
   - Coste proporcional al tamaño de la unión, no de la celda: con 4K sube a ~31 ms. Pre-escalar la unión al tamaño que necesita el fotograma más ampliado lo reduce (6,6 ms con `k` = 0,4), a cambio de un remuestreo más.
   - **Trampa encontrada**: sus expresiones no tienen `t`, solo `in`/`on` (número de fotograma) y **`in` empieza en 1**. Con `gte(in,m)` el recorte llegaba un fotograma tarde (error de hasta 17 px en el zoom); con `gte(in,m+1)`, 0,07 px. El render la usa justo tras la cabecera del clip (`trim` + `setpts`), así que `in` = fotograma del clip en el bloque + 1.
3. **`scale eval=frame` + `crop` fijo con `x`/`y` por fotograma**: en esta versión de ffmpeg da buen resultado, pero depende de que `crop` acepte fotogramas de tamaño distinto al de su enlace (no documentado; con recortes fuera del fotograma falla sin más) y sigue redondeando posición y tamaño al píxel. Descartado.
4. **`zoompan`**: su recorte es siempre `iw/zoom × ih/zoom`, con la **proporción de la entrada**, no la de la celda; además redondea `x`/`y` a enteros (la conocida vibración de `zoompan`) y crea un contexto de `swscale` por fotograma. No encaja: descartado sin medir.

## Decisión

1. **Recorte de cada fotograma** (`animatedCrop.getAnimatedCellCrop`, puro, compartido con la previsualización): el recorte **estático** de los rectángulos base para la proporción de la celda (`getExtendedCropForAspect`, con tolerancia T44b y E7), **movido y escalado con la misma transformación** que el máx. (centro y escala del keyframe, limitados al fotograma par con `clampTransform`). En números reales: redondear cada fotograma a px pares haría vibrar los paneos lentos. Sin keyframes devuelve exactamente el recorte estático.
   - Como el mín. y el recorte se transforman igual que el máx., el recorte sigue dentro del máx. animado y dentro del fotograma, y su proporción no cambia (la de la celda, o la del límite en pillarbox/letterbox).
   - **E7**: la ampliación se aplica sobre el recorte animado: `extra · escala` a lo largo del mismo eje, centrada en el máx. animado y desplazada dentro del fotograma como `extendMaxRect`; el recorte se centra en el recorte del límite animado y se desplaza dentro de ella como `getExtendedCropForAspect`. Si el fotograma no deja sitio para toda la ampliación, el recorte se corta en el borde: en ese fotograma queda algo estirado (dentro de la tolerancia) o con pillarbox/letterbox.
2. **Bloque en el que la columna tiene ancho constante**, por colocación:
   - si el recorte no cambia en todo el bloque: **camino estático** con ese recorte redondeado a px pares alrededor de su centro (idéntico al de un clip sin keyframes con esos rectángulos);
   - si cambia y mantiene encaje y proporción (lo normal): **`perspective`**:

     ```
     <cabecera>,crop=<U en px codificados del fotograma sin girar>[,<giro>][,scale=<pre-escala>],
       perspective=x0=X0:y0=Y0:x1=X1:y1=Y0:x2=X0:y2=Y2:x3=X1:y3=Y2:interpolation=linear:sense=source:eval=frame,
       scale=<w>:<h>:flags=bicubic,setsar=1
     ```

     `U` = unión de los recortes, crecida a px pares y dentro del fotograma. `X0…Y2`: esquinas del recorte de cada fotograma en px de la imagen tras el `crop` (y el giro), como suma plana de escalones sobre `in` (`v0+Δ*gte(in,m+1)…`, redondeadas a 1/1000 px; nunca `if()`). En pillarbox/letterbox, `split` tras `perspective` como en el camino estático; el fondo desenfocado recibe la proporción del recorte, porque la imagen de `perspective` tiene la de `U`.
   - si el encaje cambia durante el bloque (solo E7 sin sitio en el borde del fotograma): capa de columna.
3. **Bloque con re-layout** (ancho variable): capa de columna de ADR-001 con el recorte animado de cada fotograma (`U` = unión real crecida a pares dentro del fotograma).
4. **SAR (B1) y giros (E9)**: `U` se pasa al fotograma sin girar y a px codificados como cualquier recorte (`getUnrotatedCrop` + `toCodedRect`). Las esquinas se refieren a lo que muestra realmente ese recorte codificado (sus bordes pares vueltos a px de visualización y girados), con el factor de escala de cada eje: la imagen de `perspective` puede ser anisótropa, el `scale` explícito posterior + `setsar=1` fija la proporción.
5. **Pre-escala**: si `k` = máx. por fotograma de `tamaño en la celda / tamaño del recorte en px de la imagen` es ≤ 0,5, la unión se escala antes de `perspective` a `k` veces su tamaño (bicúbico). Umbral conservador: por debajo de la mitad el ahorro es grande (4K) y el remuestreo extra no pierde detalle, porque el fotograma más ampliado sigue teniendo al menos los px de la celda.
6. **Continuidad entre bloques**: cada bloque evalúa la misma función por tiempo de la fuente, así que el movimiento es continuo al cortar un bloque en mitad de una animación (el test real corta cada segundo). Única excepción aceptada: un bloque en el que el clip está quieto usa el encuadre redondeado a px pares (≤ 1 px de fuente de diferencia con el sub-píxel del bloque vecino), solo si el corte cae justo donde empieza o acaba el movimiento.
7. **Caché incremental** (T28): la clave de cada bloque es el contenido de su grafo, que incluye los recortes animados; un cambio de keyframes invalida exactamente los bloques en los que cambia el encuadre (test en `renderCache.test.ts`). No hace falta cambiar `RENDER_CACHE_VERSION`.
8. **Previsualización en vivo**: `getAnimatedCellCrop` en el tiempo real de la fuente (entre fotogramas también); el canvas dibuja rectángulos reales. **Miniaturas**: el máx. animado en el inicio del clip (`getClipRectsAt(clip, clip.start, …)`, pares), que entra en la clave de su caché; sin keyframes, la de siempre.

## Consecuencias

- Los clips animados cuestan más de render: ~8–11 ms por fotograma y clip en pantalla a 1080p (similar a la capa de columna), frente a ~13–21 ms por fotograma de x264 medium. Con fuentes 4K en celdas grandes (sin pre-escala) ~31 ms.
- Grafos más largos: 4 expresiones distintas (escritas en las 8 opciones de `perspective`) de hasta un término por fotograma, ≈ 5 kB por segundo de animación y clip; van siempre en fichero.
- Durante un re-layout el clip animado mantiene la cuantización de 2 px de ADR-001 (medido en el test real: error medio 0,4 px, máximo 2,9 px).
- Tests con ffmpeg real (`render/keyframes.ffmpeg.test.ts`): fuente sintética de puntos, posición de cada punto en cada fotograma (error medio 0,06–0,08 px, máximo < 0,4 px, vibración 0,05 px) en px cuadrados, fuente anamórfica y clip girado, con cortes de bloque en mitad de la animación y un salto *hold* en su fotograma exacto; y un re-layout simultáneo (capa de columna).
- **Descartado**: `zoompan` (proporción de la entrada, posiciones enteras), `crop` de tamaño fijo tras `scale eval=frame` (comportamiento no documentado), `perspective` cúbica (el doble de coste sin mejora medible) y la capa de columna para columnas estáticas (vibración visible en paneos lentos).
