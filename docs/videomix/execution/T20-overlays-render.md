# T20 · Overlays: render de vídeo (PNG, contador, barra)

- **Hito**: M7 · **Modelo**: Opus · **Depende de**: T19 · **Estado**: pendiente

## Objetivo

Dibujar las imágenes, los contadores y las barras de progreso sobre el vídeo final, en la previsualización y en el render.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §9.1
- [04-diseno](../04-diseno.md) §8.2 y §4
- [ADR-001](../decisiones/ADR-001-render.md): bloques, sumas planas de escalones y grafo en fichero
- Código: `render/buildVideoGraph.ts`, `buildRenderJob.ts`, `renderChunks.ts`, `verifyFilterGraph.ts` y el modelo y `resolveOverlayTimes` de T19

## Alcance

1. **Composición** sobre la salida de cada bloque (antes del *fade* global), con tiempo absoluto (`t + inicioDelBloque`), de modo que un elemento partido entre bloques salga continuo. Solo entran en el grafo de un bloque los elementos que lo tocan.
2. **PNG**: escala a la caja (px pares del fotograma de salida), *fade* in/out con alfa y `enable`. Orden de capas según el proyecto.
3. **Contador**:
   - `drawtext` con el formato automático (`SS` / `MM:SS`), 0–3 decimales, ceros a la izquierda, redondeo hacia arriba y desaparición en 0;
   - fuente del usuario o la incluida por defecto;
   - borde y sombra; tamaño de letra = altura de la caja × alto del fotograma.
   - Hay que resolver bien el escapado de `drawtext` y de las rutas de fuente en Windows (`:` y `\`).
4. **Fuente por defecto**: una fuente libre (licencia OFL, p. ej. Open Sans o Inter en TTF), en `resources`/`extraResources`. Hay que localizarla tanto en desarrollo como empaquetada, con una función en main o en `ffmpeg.ts`. Se añade su licencia a la carpeta de licencias o se menciona en las notas.
5. **Barra de progreso**: relleno animado en las cuatro direcciones y los modos llenar/vaciar, con fondo y borde, sin `if()` anidados.
6. **Bloques**: los elementos no obligan a cortar bloques. Hay que comprobar que las expresiones de tiempo son exactas en los cortes.
7. **Tests**:
   - snapshots de grafos con overlays y `verifyFilterGraph` ampliado;
   - test con ffmpeg real (320×180): PNG a mitad de *fade*, contador (lee el fotograma y comprueba que hay texto en la región) y barra al 50 % (mide el ancho de relleno por color). Se omite si falta ffmpeg.
8. **Mini vista del fotograma** (T15): dibujar las cajas de los elementos visibles en el instante (solo el contorno y el tipo). Si choca con T22, coordínalo y documéntalo en las notas.

## Criterios de aceptación

- Fotogramas revisados: PNG con transparencia, contador cerca del cero y barra a mitad de recorrido.
- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

## Revisión
