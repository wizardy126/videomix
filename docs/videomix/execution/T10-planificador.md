# T10 · Planificador de montaje

- **Hito**: M3 · **Modelo**: Opus · **Depende de**: T03 · **Estado**: pendiente

## Objetivo

Implementar el algoritmo puro que convierte la lista de clips y los ajustes en un `MixPlan`: slots continuos, re-layout, ventana de reorden, modo aleatorio y relleno.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4 (entero)
- [04-diseno](../04-diseno.md) §2 y §3 (especificación principal: tipos, invariantes, algoritmo guía, puntuación)
- `geometry.ts` (T03)

## Alcance

1. **`src/renderer/src/videomix/planner/`**:
   - `types.ts` (`MixPlan`, `ColumnPlacement`, `LayoutKeyframe`, `PlanWarning`);
   - `planMix.ts` (entrada: `{ clips: PlannerClip[], settings }`, donde `PlannerClip = { id, duration, aspectRange }`, y se deriva de `MixClip` en un adaptador aparte);
   - `random.ts` (PRNG con semilla y barajado determinista);
   - `validatePlan.ts`: comprueba **todas** las invariantes de 04-diseno §3.2. Se usa en los tests y, en desarrollo, también en runtime.
2. Implementa el algoritmo por eventos de 04-diseno §3.3. Puedes mejorarlo, pero **cualquier cambio respecto al diseño se documenta** en las notas y en 04-diseno §3.
   - Los pesos de la puntuación van como constantes con nombre y un comentario.
   - Si `maxColumns` o la ventana hacen explotar las combinaciones, acótalas (poda) y documenta la complejidad.
3. **Casos límite**:
   - un solo clip;
   - todos los clips horizontales 16:9 sin mín.: una columna cada vez, sustitución directa;
   - todos verticales 9:16 sin margen: con 3 columnas no llenan 16:9, así que hay relleno; con mín. que permita ensanchar, sí llenan;
   - clips más cortos que 2 × D;
   - clips de duración casi igual que terminan a la vez (fusión de eventos);
   - `maxColumns = 1`;
   - `reorderWindow = 0`;
   - modo aleatorio con semillas distintas.
4. **Avisos** (`PlanWarning`): upscale > ×2 (necesita el tamaño del recorte: el adaptador pasa la altura mínima del recorte en píxeles de la fuente, o se calcula aparte), letterbox o pillarbox forzado, clip acortado en su transición y relleno por falta de clips que encajen.

## Fuera de alcance

- La generación del grafo (T11) y la UI de visualización del plan (T15).

## Criterios de aceptación

- Tests extensos con `validatePlan` sobre todos los casos límite, más un test de "propiedades" con N proyectos generados con la semilla (p. ej. 200) que siempre cumplan las invariantes.
- Snapshots legibles de 2–3 planes representativos (formato textual compacto: por columna, qué clip y cuándo).
- Rendimiento: 200 clips se planifican en menos de 1 s.
- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

## Revisión
