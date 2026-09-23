# T09 · Spike: estrategia de render ffmpeg (ADR-001)

- **Hito**: M3 · **Modelo**: Opus · **Depende de**: T02 · **Estado**: hecha

## Objetivo

Decidir con **pruebas reales con ffmpeg** cómo se renderiza el montaje:
- composición en columnas;
- `xfade` por columna;
- re-layout animado;
- relleno con desenfoque;
- separación;
- render por bloques.

Documentarlo en `docs/videomix/decisiones/ADR-001-render.md`.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4, §5, §6
- [04-diseno](../04-diseno.md) §3.1 (`MixPlan`), §4 (restricciones y alternativas) y §5.2
- Medios de prueba de T02 (`yarn generate-test-media`) y ffmpeg en `ffmpeg/linux-x64/lib/`

## Alcance

Prototipos **fuera del código de la app**, en `script/videomix/spike/`: pueden ser shell o TS, y no es necesario que pasen lint si se excluyen. Se decide si se conservan o se borran, y se documenta. Deben responder a:

1. **Columnas estáticas**: 2–3 clips recortados y escalados a sus anchos con separación y fondo de color. Comparar `overlay` sobre un lienzo con `hstack` / `xstack` (rendimiento y flexibilidad).
2. **Sustitución en una columna con `xfade`** mientras otra columna sigue reproduciéndose, sin desincronizar el audio ni los PTS. Probar con fuentes de fps distintos (25 y 30) y el `fps` común.
3. **Re-layout animado** de 0,5 s: evaluar las alternativas (a)–(c) de 04-diseno §4.1, más cualquier otra que encuentres (p. ej. `crop` / `scale` con comandos vía `sendcmd`, o capas anchas con `overlay` y `x(t)`). Criterios:
   - calidad visual (sin saltos);
   - que el contenido de cada columna se mantenga centrado en su recorte;
   - complejidad del generador;
   - rendimiento.
4. **Relleno desenfocado**: pillarbox y hueco final.
5. **Rendimiento**: un vídeo de ~2 min con ~15 clips en 1080p. Grafo único frente a bloques más concat demuxer (`-c copy`). Medir tiempo, memoria y detectar problemas de límites de argumentos (longitud del comando o el número de `-i`).
6. **Audio**: validar la mezcla propuesta en 04-diseno §5.2: `adelay` + `amix normalize=0` + compensación, y `-stream_loop` para la música. Solo un prototipo mínimo; los detalles son de T12.

## Entregables

- **`docs/videomix/decisiones/ADR-001-render.md`**:
  - contexto, opciones evaluadas con los datos medidos, decisión y consecuencias;
  - **esqueleto del grafo** que T11 debe generar, con un ejemplo real comentado;
  - cómo se parte en bloques y cómo se calcula el progreso.
- Actualizar 04-diseno §4, quitando "(provisional)", con un resumen y un enlace al ADR.
- **Si el re-layout animado no es viable** con calidad o rendimiento aceptables: detente y documenta el fallback (transición de fotograma completo). El orquestador lo consultará con el usuario.

## Fuera de alcance

- Código de producción: lo hacen T11, T12 y T13.

## Criterios de aceptación

- El ADR es concreto y reproducible: comandos que funcionan con los medios de T02.
- Los tiempos medidos están anotados.

## Notas de ejecución

### Resultado

**El re-layout animado es viable**. No hace falta el fallback de transición de fotograma completo. La decisión está en [ADR-001](../decisiones/ADR-001-render.md) y el resumen, en [04-diseno §4](../04-diseno.md) (sin "provisional").

- **Técnica "capa de columna"**:
  - `crop` fijo de la unión de recortes;
  - `scale … eval=frame`, con tamaño variable, que `overlay` acepta;
  - `overlay` con `x`/`y` por fotograma sobre una base fija;
  - composición de izquierda a derecha, con barras de separación redibujadas.

  Aguanta zoom, `xfade` simultáneo y columnas que aparecen o desaparecen.
- **Render por bloques** + concat `-c copy` + audio en pasada aparte, con **2 bloques en paralelo**.
- **Máquina**: 4 vCPU Xeon 2,1 GHz, 15 GB, ffmpeg 8.0.
- **Medidas con 2 min, 15 clips, 1080p, x264 medium** y fuentes con ruido (pesimista):

  | Modo | Tiempo real | Pico de memoria |
  |---|---|---|
  | Bloques, secuencial | 550 s | 1,1 GB |
  | Bloques, 2 en paralelo | 427 s | ~1,06 GB por proceso |
  | Grafo único | 400 s | 2,7 GB |

  En todos los casos, 3540 fotogramas exactos.

### Hallazgos que T11 debe respetar

Todos están en el ADR.

- **Ni `crop` ni `xfade` admiten tamaño variable**: `crop` con `w(t)` no cambia de tamaño y con `sendcmd` produce una imagen corrupta; `xfade` con entradas variables también. Probado.
- **`if()` anidado** falla a partir de ~98 niveles. Se usa una suma plana de escalones, probada con 2000 términos.
- **`setpts=PTS-STARTPTS` antes de `fps`** tras `-ss` desplaza el clip hasta un fotograma. Hace falta `fps=F:start_time=0`.
- **El *accurate seek*** descarta el fotograma en pantalla en el punto de corte: se abre la entrada 0,1 s antes y se compensa con `setpts=PTS-0.1/TB`.
- **Longitud del comando**: el grafo único de 2 min ocupa ~23k caracteres, frente al límite de 32 767 en Windows. Siempre `-/filter_complex <fichero>`.

### Ficheros

Se conservan como referencia para T11–T13.

- `script/videomix/spike/renderSpike.ts`:
  - prototipo del generador (plan → bloques → grafos → render → concat, y el grafo único para comparar) y escenarios de medida;
  - lleva `eslint-disable` de reglas de estilo concretas, porque es un prototipo; pasa `tsc`.
- `script/videomix/spike/example-anim-chunk.sh`: ejemplo real comentado (estable + animación con `xfade` + estable + audio + concat). Reproduce bit a bit la salida del generador.
- `script/videomix/spike/measure.py`: mide el tiempo, la CPU y el pico de RSS, porque no hay `/usr/bin/time`.
- `docs/videomix/decisiones/ADR-001-render.md`, enlazado desde `decisiones/README.md` y desde 04-diseno §4.

Las salidas (vídeos, PNG, grafos) quedan en `test-media/spike-out/`, ignorado por git. Las fuentes largas del spike se generan con `renderSpike.ts sources` (≈3 min).

### Desviaciones y dudas

- El spike usa una copia mínima de `getCropForAspect`, porque Node no resuelve los imports sin extensión de `geometry.ts`. T11 debe usar el real.
- La previsualización a 640×360 no se ha medido.
- Las medidas de rendimiento se tomaron antes de añadir el margen previo de 0,1 s en `-ss` (impacto despreciable).
- **Para el orquestador**:
  - Durante un re-layout, los tipos de `xfade` con geometría (`wipe*`, `slide*`…) se calculan sobre el ancho máximo de la columna y no sobre el ancho animado (pequeña desviación). `fade`, `dissolve` y `fadeblack` son exactos. Si el usuario lo considera inaceptable, se puede forzar `fade` en las sustituciones que coinciden con un re-layout.
  - Invariantes nuevas para T10 (ver ADR, "Consecuencias"):
    - orden de columnas estable durante una animación;
    - columnas que aparecen o desaparecen con ancho 0 junto a su vecina derecha.

## Revisión

- **Resultado**: aceptada. El re-layout animado es viable, así que no hace falta fallback. `tsc` y `lint` en verde con el spike incluido.
- **Decisión del orquestador**: se acepta la pequeña desviación de las transiciones geométricas (`wipe*`, `slide*`…) cuando coinciden con un re-layout. No se fuerza `fade`.
- **Seguimiento**: las invariantes nuevas para el planificador (orden estable y columnas que aparecen o desaparecen con ancho 0) se verifican en T10b.
