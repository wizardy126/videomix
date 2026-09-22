# T09 · Spike: estrategia de render ffmpeg (ADR-001)

- **Hito**: M3 · **Modelo**: Opus · **Depende de**: T02 · **Estado**: pendiente

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

## Revisión
