# T47 · v4: sugerencia de recorte, bandas negras (A7)

- **Hito**: M11 · **Modelo**: Sonnet · **Depende de**: T44 · **Estado**: pendiente

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- Lógica de T44 (parseo de `cropdetect`, rect inicial) y sus notas. `src/main/videomix/loudness.ts` y `thumbnails.ts` como patrón de proceso ffmpeg en main expuesto al renderer; creación de clips (`videomix/clips.ts`, `hooks/useMixClips.ts`).

## Alcance

1. **Main**: `detectBlackBars({ filePath, start, end, abortSignal })` con `cropdetect` sobre varias muestras repartidas en el tramo (rápido: pocas decenas de fotogramas por muestra, *seek* por entrada). Test con ffmpeg real sobre un medio de prueba con bandas negras (añadirlo a `generateTestMedia.ts`, p. ej. 16:9 con barras superior e inferior, y otro con barras laterales).
2. **Por fuente, en segundo plano**: al añadir o activar una fuente sin detección válida, se detecta (sobre toda la fuente) y se guarda en el proyecto (caché, sin historial). Con `autoCropBlackBars` activo, los clips **nuevos** de esa fuente nacen con el máx. sin bandas (si la detección aún no ha terminado, nacen como hoy).
3. **Botón "Quitar bandas negras"** en la barra del editor: analiza **el tramo del clip** y ajusta el máx. (un paso de historial; el mín. se recorta para seguir dentro; aviso si no hay bandas).
4. Ajuste `autoCropBlackBars` en el diálogo de ajustes del proyecto.
5. i18n (en + es).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde; e2e: fuente con bandas → clip nuevo sin bandas; botón en un clip existente.

## Notas de ejecución

## Revisión
