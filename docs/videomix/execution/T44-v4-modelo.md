# T44 · v4: modelo v5 y lógica pura (encaje, keyframes, bandas negras)

- **Hito**: M11 · **Modelo**: Opus · **Depende de**: — · **Estado**: en curso

## Objetivo

Base de datos y lógica pura de las mejoras v4, para que las tareas de UI y render (T45–T49) trabajen en paralelo sobre contratos estables.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- `videomix/types.ts`, `projectFile.ts` (migraciones v1→v4), `projectReducer.ts`, `geometry.ts` (`getAspectRange`, `getWidthRange`, `distributeWidths`, `getExtensionRoom`), `clipRotation.ts`, `sourceResize.ts` (escalado proporcional de B2), `planner/extendPlan.ts`.

## Alcance

1. **Modelo v5** (`version: 5`) con migración v4→v5 y tests:
   - `clip.keyframes?` (A9): lista ordenada por tiempo. Tiempo en **segundos de la fuente** (así los keyframes siguen al contenido si se mueve el inicio del clip; los que queden fuera del tramo se conservan y se aplican como extremos). Cada keyframe guarda la **transformación del encuadre** (posición y escala del máx.; el mín. se transforma igual, conservando su posición relativa dentro del máx.) y su interpolación de salida: `'smooth' | 'linear' | 'hold'` (por defecto `smooth`). Elige la representación (p. ej. `{ time, x, y, scale }` respecto a `maxRect`) y documéntala: la proporción no cambia nunca.
   - Resultado de la detección de bandas negras **por fuente** (A7): rectángulo con imagen, en píxeles de visualización, + identidad del fichero (tamaño y mtime, como la caché de sonoridad) para invalidarlo.
   - Ajuste del proyecto `autoCropBlackBars` (A7), **activo por defecto**.
   - Acciones del reducer necesarias (con historial donde aplique; la detección es caché, sin historial ni `dirty`, como `setSourceMeta`).
2. **Encaje en fracciones (F1)**, puro, en `videomix/fitFractions.ts` (o nombre coherente):
   - fracciones **1/3, 1/2, 2/3, completo**; tamaño de la celda de cada fracción en el eje principal de la salida, descontando la separación (`gap`) como hace el planificador (p. ej. 2/3 = dos tercios + una separación); en columnas, anchos; en filas (9:16, 1:1 en filas), altos (usar `getMainAspectRange`/transposición);
   - para un clip (máx., mín., giro ya aplicado, extendBeyondMax y material disponible en la fuente): estado por fracción `fits | extends | no`, y en `no` cuánto **falta** (máx. demasiado estrecho) o **sobra** (mín. demasiado ancho) en **píxeles de la fuente**, con el redondeo par que usa `getWidthRange`;
   - debe coincidir con lo que haría el planificador para n clips iguales: tests que lo contrasten con `distributeWidths`.
3. **Imán y "Ajustar a" (F2)**, puro:
   - `snapRectEdge` (o similar): dado el rectángulo que se arrastra (máx. o mín.), el borde y un umbral en px de fuente, devuelve el rectángulo enganchado al tamaño exacto de la fracción más cercana si está dentro del umbral;
   - `fitMaxRectToFraction`: máx. con la proporción exacta de la fracción, centrado en el mín. si existe, si no en el centro del máx. actual, dentro del fotograma, conteniendo al mín.; si no es posible, devuelve el motivo.
4. **Keyframes (A9)**, puro: `getClipRectsAt(clip, sourceTime)` → máx./mín. interpolados (curvas smooth/linear/hold), siempre dentro del fotograma, con rectángulos pares; y helpers de edición (añadir o actualizar el keyframe en un tiempo, borrar, anterior/siguiente). El `maxRect`/`minRect` base siguen siendo los que usan el encaje y el planificador.
5. **Copiar/pegar (A5)**, puro: pegar un encuadre (máx. + mín. + giro) en otro clip, escalando proporcionalmente si la fuente tiene otro tamaño (reutiliza `sourceResize.ts`), con aviso si cambia la proporción. Keyframes: decide si se copian (propuesta: sí, escalados) y documéntalo.
6. **Bandas negras (A7)**, puro: parseo de la salida de `cropdetect` (varias muestras → unión), conversión a píxeles de visualización (SAR, rotación de la fuente) y rectángulo inicial de un clip nuevo.

## Fuera de alcance

UI, render, previsualización y proceso main (T45–T49).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run` en verde; tests para cada función pura, incluidos 9:16, giros y SAR.
- Sección nueva en [04-diseno](../04-diseno.md) con el modelo v5 y las fórmulas de encaje.

## Notas de ejecución

## Revisión
