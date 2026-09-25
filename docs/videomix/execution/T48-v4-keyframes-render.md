# T48 · v4: keyframes en render, previsualización y miniaturas (A9)

- **Hito**: M11 · **Modelo**: Opus · **Depende de**: T44 · **Estado**: pendiente

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- `getClipRectsAt` de T44 y sus notas. [ADR-001](../decisiones/ADR-001-render.md) (atención: **`crop` no admite tamaño variable** y `xfade` tampoco; sumas planas de escalones en lugar de `if()` anidados). `render/buildVideoGraph.ts` (capa de columna: `crop` + `scale eval=frame` + `overlay`), `sampleAspect.ts` (`toCodedRect`, SAR), `clipRotation.ts`, `planner/extendPlan.ts` (E7), `preview/previewDraw.ts`, `thumbnails.ts`.

## Alcance

1. **Render**: un clip con keyframes muestra el recorte animado (paneo y zoom, proporción fija), con las curvas smooth/linear/hold. Primero, un **mini-spike** con ffmpeg real para elegir la técnica (p. ej. `crop` fijo de la unión + `scale eval=frame` + `crop` con x/y por fotograma; o `zoompan`; o escalar el fotograma entero por fotograma y recortar a tamaño fijo) y medir su coste. Documentar la decisión (ADR-003 o ampliación de ADR-001). Debe convivir con: SAR (px codificados), giros, E7 (ampliación: se aplica sobre el recorte animado, dentro del fotograma), re-layouts animados, cadenas, transiciones y la caché incremental (la clave de bloque debe incluir los keyframes).
2. Tests de snapshot del grafo y **tests con ffmpeg real que comprueben píxeles** (p. ej. una rejilla o marca que debe estar en cierta posición en fotogramas concretos).
3. **Previsualización en vivo**: dibuja el recorte animado.
4. **Miniaturas**: usan el recorte en el instante de inicio del clip.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde; los tests con ffmpeg real pasan; clips sin keyframes producen exactamente el mismo grafo que antes (snapshots existentes sin cambios).

## Notas de ejecución

## Revisión
