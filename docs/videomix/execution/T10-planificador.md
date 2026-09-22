# T10 · Planificador de montaje

- **Hito**: M3 · **Modelo**: Opus · **Depende de**: T03 · **Estado**: hecha

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

### Resumen

Módulos nuevos en `src/renderer/src/videomix/planner/` (puros, sin React ni Electron):

- `types.ts`: `PlannerClip`, `PlannerSettings`, `PlanMixInput`, `ColumnPlacement`, `LayoutKeyframe`, `PlanWarning`, `MixPlan`.
- `planMix.ts`: el algoritmo (`planMix(input) → MixPlan`), con los pesos como constantes documentadas. En desarrollo (`import.meta.env.DEV`) valida el plan y hace `console.error` si algo falla.
- `validatePlan.ts`: `validatePlan(plan, input) → string[]` con todas las invariantes de 04-diseno §3.2 más la coherencia entre keyframes y clips.
- `planWarnings.ts`: `getPlanWarnings`, `getColumnFit` (fill/pillarbox/letterbox con `ASPECT_TOLERANCE`) y `getStableLayouts`.
- `random.ts`: mulberry32, barajado Fisher-Yates y `getBaseOrder`.
- `formatPlan.ts`: vista textual compacta (tests y depuración).
- `plannerInput.ts`: adaptador `MixClip`/`MixSettings` → `PlanMixInput` (`getPlannerInput(project)`); omite los clips con duración ≤ 0.
- Tests: `planMix.test.ts` (casos límite, 3 snapshots, 200 proyectos aleatorios con semilla y rendimiento), `validatePlan.test.ts` (mutaciones: cada invariante rota se detecta), `random.test.ts` y `plannerInput.test.ts`. 37 tests.

Además se probaron en local 20 000 proyectos aleatorios (1–40 clips, clips de 0,05 s a 26 s, D de 0 a 3 s, 1–6 columnas, ventana 0–8, huecos pares e impares, resoluciones verticales y cuadradas, modo aleatorio) sin ninguna violación de invariantes; el peor caso tardó 40 ms.

Rendimiento con 200 clips (incluida la validación de desarrollo): 25 ms con los valores por defecto y 112 ms con `maxColumns` = 6 y ventana 10.

Validación: `yarn test run` en verde (22 ficheros, 247 tests). `yarn tsc` y `yarn lint` solo fallan en `script/videomix/spike/renderSpike.ts`, que es de otro agente (T09): TS6133 `'g' is declared but its value is never read` (línea 644) y 44 errores de eslint. Los ficheros de `planner/` no tienen errores.

### Algoritmo implementado

Está descrito en 04-diseno §3.3 (actualizado). En resumen:

1. **Ventana de orden**: los clips elegidos ocupan las posiciones siguientes en orden de índice base. Una elección es válida si ningún clip queda a más de N de su índice y el primer clip pendiente sigue cabiendo en su ventana. Tomar el primer pendiente siempre es válido, así que nunca hay bloqueo.
2. **Fila inicial**: se prueban todos los subconjuntos de la ventana (1..`maxColumns` clips) con `distributeWidths` y gana el de menor puntuación.
3. **Eventos** por orden de fin de clip:
   1. **Sustitución directa** (prioridad absoluta, como en requisitos §4.3): el primer candidato en orden cuyo intervalo admite el ancho libre.
   2. Si no hay ninguno, se puntúan: *en su sitio con relleno* (pillarbox/letterbox), *re-layout sustituyendo* (+ columnas nuevas a la derecha, todas las combinaciones) y *re-layout quitando la columna*.
   3. En un re-layout, las columnas que terminan antes de `e + D` se deciden en la misma opción (evento fusionado), de modo que nunca se solapan dos animaciones.
4. **Final**: con la cola vacía, las columnas se quedan sin clip y su área es relleno, sin keyframes.

**Transiciones**: `transitionIn = min(D, saliente/2, entrante/2)`, para que los xfades de entrada y salida de un clip no se solapen. En casos límite con clips cortos se acorta más, para que ningún clip empiece antes que el último elegido (así el orden de elección coincide con el de inicio) y ningún re-layout empiece antes de que acabe la animación anterior. Cada acortamiento genera el aviso `transition-shortened`.

**Complejidad y poda**: como mucho `SUBSET_BUDGET` = 1000 subconjuntos por evento. La lista de candidatos se recorta conservando los más antiguos, que son los que la ventana obliga a tomar. Con ventanas grandes, esto limita la reordenación efectiva hacia delante (con `maxColumns` = 6 quedan unos 10 candidatos). Coste total `O(clips × 1000 × maxColumns)`.

### Puntuación

Ver la tabla de 04-diseno §3.4. Pesos: `FILL_WEIGHT` 60 (fracción de ancho × segundo), `ROW_FILL_SECONDS` 5, `LETTERBOX_WEIGHT` 10, `RELAYOUT_WEIGHT` 3, `ORDER_WEIGHT` 1, `PREF_WEIGHT` 4, `UPSCALE_WEIGHT` 5 y `COLUMN_COUNT_WEIGHT` 0,5.

- El relleno de pillarbox/letterbox se pondera por la duración del clip, porque dura lo que dura el clip.
- El relleno de la fila se cuenta hasta que termina el primer clip que **sigue** en la fila, con un máximo de 5 s. La primera versión usaba "hasta el próximo evento", incluidos los clips entrantes, y favorecía elegir clips cortos solo para acortar el relleno (rompía el orden sin motivo).

### Ejemplo (snapshot "mixed verticals and horizontals", 1920×1080, 3 columnas, ventana 3, D = 0,5)

```
plan 1920x1080, 44.00s
layout 0.00: c0=608 | c1=608 | c2=704
layout 13.50+0.50: c0=704 | c1=608 | c2=608
layout 16.00+0.50: fill=116 | c0=1080 | c2=608 | fill=116
layout 23.00+0.50: c0=1920
c0: v1 0.00-12.00 > v5 11.50-18.50 > h1 18.00-28.00 > h2 27.50-38.50 > h3 38.00-44.00
c1: v2 0.00-9.00 > v4 8.50-16.50
c2: v3 0.00-14.00 > v6 13.50-23.50
warning: fill 232px @16.00
```

Cómo se lee: v4 y v5 sustituyen directamente (encajan en 608 px) y adelantan a h1. En 13,5 v6 entra en c2 con un re-layout (v5 se ensancha). h1 ya no puede esperar más (ventana 3): en 16,0 se quita c1 y c0 se ensancha a 1:1, y h1 entra ahí en 18,0 por sustitución directa. En 23,0 se quita c2 y h1 se expande a pantalla completa.

### Desviaciones respecto al diseño

1. **`ColumnPlacement.transitionIn`** (nuevo): la duración real del xfade de entrada. T11 la necesita porque no siempre es `D`.
2. **Sin `crops`** en `MixPlan`: el generador los recalcula con `getCropForAspect`.
3. **`PlannerClip.rects` opcional**: con él se calculan el aviso exacto de upscale (`getCropForAspect` + `getScaleFactor`) y una estimación para la puntuación. Sin él se ignora el upscale.
4. **Final implícito**: al acabarse los clips no se emiten keyframes. Una columna sin clip sigue en el layout y su área es relleno. Así nunca coincide un "paso a relleno" con una animación en curso y se cumple a la letra "no hay re-layout".
5. **Eventos por fin de clip**, no por `t − D`, con inicio monótono (ver "Transiciones"). El keyframe dura lo mismo que el xfade de la columna que lo dispara (menos que `D` si hay clips cortos).
6. **Opciones de re-layout**: se enumeran todas las combinaciones (sustituir + columnas nuevas, o quitar). Cubren las opciones a–d del diseño.
7. **"En su sitio con relleno"** compite por puntuación con los re-layouts, en lugar de usarse solo cuando no hay nada factible. Un re-layout que también deja relleno, o uno que deja mucho relleno durante segundos, puede ser peor que un pillarbox breve.
8. **Tolerancia**: "encaja" usa `ASPECT_TOLERANCE` (1 %), igual que `getCropForAspect`, para no animar diferencias de 2 px.
9. **Relleno estructural**: se reparte a izquierda y derecha (columnas centradas, la parte izquierda par para que las `x` sean pares). Tampoco se añade separación entre relleno y columna.
10. **Aviso `fill`**: se emite por keyframe con relleno estructural > 1 px (el 1 px de una separación impar ya lo avisa `validateMixProject`).

### Dudas abiertas (para el usuario)

1. **Sustitución directa con relleno en la fila**: si la fila tiene relleno (p. ej. tres verticales rígidos, 96 px) y un clip pendiente encaja en el hueco, se sustituye directamente aunque un re-layout con otro clip pudiera eliminar ese relleno. Es la lectura literal de §4.3. ¿Se prefiere que el relleno pese más que "encajar"?
2. **¿Una columna a pantalla completa o varias recortadas?** Con clips horizontales flexibles (mín. que permite estrecharlos), el planificador prefiere un clip a pantalla completa mostrando todo su máx. antes que 2–3 columnas recortadas. Coincide con la guía del diseño ("se para cuando Σ aMax ≥ T") y con la ligera preferencia por 2–3 columnas, pero "se pueden mostrar tantos clips como encajen" admite la otra lectura. Si se quieren más columnas, basta con subir `COLUMN_COUNT_WEIGHT` o bajar `PREF_WEIGHT`.
3. **Columnas nuevas en un re-layout**: aparecen a la derecha de la columna liberada, crecen desde 0 y su clip entra sin xfade (lo "presenta" la animación). ¿Es aceptable o se prefiere otra entrada?
4. **Quitar una columna mientras quedan clips**: las demás se expanden (opción c del diseño). Solo se prohíbe la re-expansión cuando ya han empezado todos los clips. ¿Correcto?
5. **Salida de un clip hacia relleno al final**: el plan dice solo que la columna queda vacía cuando termina el clip. T11 decide si el clip hace fundido al relleno en sus últimos `D` segundos, lo que parece deseable.

## Revisión

- **Resultado**: aceptada. Lint y tests del planificador en verde (37 tests, 20 000 proyectos aleatorios en local sin violaciones).
- **Dudas 1 y 2**: se consultan al usuario. Si cambian el comportamiento, se abrirá una tarea de ajuste de la puntuación.
