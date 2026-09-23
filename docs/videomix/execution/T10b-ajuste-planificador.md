# T10b · Ajuste del planificador según las decisiones del usuario

- **Hito**: M3 · **Modelo**: Opus · **Depende de**: T10, T09 · **Estado**: hecha

## Objetivo

Ajustar la puntuación y las reglas del planificador (T10) a las decisiones del usuario tomadas tras revisar su comportamiento, y a las invariantes de render de ADR-001.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.3: las cuatro decisiones nuevas "decidido tras T10"
- [T10-planificador](T10-planificador.md): notas de ejecución y dudas abiertas
- [ADR-001](../decisiones/ADR-001-render.md), sección "Consecuencias": invariantes para el planificador
- [04-diseno](../04-diseno.md) §3

## Alcance

1. **Relleno antes que sustitución directa**:
   - Si la fila tiene relleno estructural y existe una opción de re-layout (dentro de la ventana) que lo elimina o lo reduce claramente, gana a la sustitución directa.
   - Si la fila no tiene relleno, la sustitución directa sigue teniendo prioridad (evita animaciones innecesarias).
2. **Criterio equilibrado de columnas**:
   - Se prefieren 2–3 columnas, recortando los horizontales flexibles hacia su mín.
   - Se acepta un clip a pantalla completa cuando meter más columnas obligaría a perder mucho del máx. (p. ej. más de ~40 % de su área; umbral como constante documentada).
   - Ajusta `COLUMN_COUNT_WEIGHT` / `PREF_WEIGHT` o la forma de la penalización. Documenta el razonamiento con ejemplos en las notas y en los snapshots.
3. **Columna nueva**: crece desde ancho 0 y su clip entra sin `xfade`; es el comportamiento actual, así que solo hay que verificarlo.
4. **Final del vídeo**:
   - El plan debe expresar que un clip que termina sin sucesor hace un fundido al relleno con la transición global (p. ej. `transitionOut` en `ColumnPlacement`, o un marcador equivalente).
   - Documenta el campo para T11.
5. **Invariantes de ADR-001**:
   - el orden izquierda→derecha de las columnas es estable durante una animación;
   - las columnas que aparecen o desaparecen lo hacen con ancho 0 junto a su vecina derecha. T10 las crea a la derecha de la columna liberada; verifica que sea compatible con ADR-001 o ajusta una de las dos cosas de forma coherente y documéntalo en ambos sitios.

   Añade las dos a `validatePlan` con tests de mutación.
6. Actualiza 04-diseno §3 y los snapshots.

## Criterios de aceptación

- Tests nuevos para cada decisión, con casos que antes daban el comportamiento anterior.
- Sigue cumpliéndose todo `validatePlan` con 200 proyectos aleatorios. El rendimiento sigue por debajo de 1 s con 200 clips.
- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

### Resumen

Cambios en `src/renderer/src/videomix/planner/` (sin tocar `render/` ni `src/main/`):

- `planMix.ts`:
  - prioridad del relleno sobre la sustitución directa (`CLEAR_FILL_REDUCTION`);
  - nueva forma de la penalización de recorte (`MAX_CROP_LOSS`, `EXCESS_CROP_WEIGHT`) y `COLUMN_COUNT_WEIGHT` 0,5 → 4;
  - pasada final que rellena `transitionOut`.
- `types.ts`: campo nuevo **`ColumnPlacement.transitionOut?: number`** (opcional, aditivo).
- `validatePlan.ts`:
  - invariantes de ADR-001 (orden estable y colapso junto a la vecina derecha) y del fundido de salida;
  - exporta `getAnimatedColumn(layout, other, column, W, gap)`, la regla de colapso a ancho 0 (la misma que `collapseX` del spike).
- `formatPlan.ts`: muestra `~fade D` en los clips con fundido de salida.
- Tests:
  - 8 nuevos en `planMix.test.ts` (bloque "decisions after T10 (T10b)");
  - 5 nuevos en `validatePlan.test.ts` (mutaciones de orden, solape por colapso y fundido);
  - snapshots actualizados.
- Docs: 04-diseno §3.1–3.4 y ADR-001 ("Consecuencias", regla exacta de colapso y fundido de salida).

Validación:

- `yarn tsc` y `eslint src/renderer/src/videomix/planner` en verde.
- Tests del planificador: 49 en verde.
- `yarn test run`: 27 ficheros, 318 tests en verde.
- Barrido local temporal de 20 000 proyectos aleatorios (1–40 clips, 1–6 columnas, ventana 0–8, D de 0 a 3 s): sin violaciones de ninguna invariante, incluidas las nuevas. Peor caso: 33 ms. El test de 200 clips sigue muy por debajo de 1 s.

### 1. Relleno antes que sustitución directa

- Si la fila tiene relleno estructural > 1 px, la sustitución directa ya no gana automáticamente.
- Se evalúan los re-layouts (sustituir + columnas nuevas, o quitar) y solo se admiten los que:
  - dejan como mucho el 50 % del relleno actual (o ≤ 1 px): `CLEAR_FILL_REDUCTION`;
  - no dejan ningún clip con pillarbox/letterbox.
- Si hay alguno, gana el de menor puntuación; si no, la sustitución directa.
- Sin relleno, la sustitución directa sigue teniendo prioridad absoluta.
- El 1 px de una separación impar no cuenta como relleno.

Test "fill before direct substitution…" (ventana 1, tres 9:16 rígidos + v3 rígido + f4 que se puede ensanchar hasta 1:1):

```
-- antes (T10)
layout 0.00: fill=48 | c0=608 | c1=608 | c2=608 | fill=48
c0: v0 0.00-5.00 > v3 4.50-12.50
c1: v1 0.00-10.00 > f4 9.50-17.50
c2: v2 0.00-12.00
-- después (T10b)
layout 0.00: fill=48 | c0=608 | c1=608 | c2=608 | fill=48
layout 4.50+0.50: c0=704 | c1=608 | c2=608
c0: v0 0.00-5.00 > f4 4.50-12.50 ~fade 0.50
c1: v1 0.00-10.00 > v3 9.50-17.50
c2: v2 0.00-12.00 ~fade 0.50
```

Hay dos tests de control:

- Si ningún clip de la ventana reduce el relleno (todos rígidos), v3 entra directamente sin animación.
- Sin relleno (9:16 ensanchables a 640 px), la sustitución directa sigue ganando.

### 2. Criterio equilibrado de columnas

- La penalización de recorte pasa a ser por tramos: `4 · min(p, 0,4) + 40 · max(0, p − 0,4)`, donde `p` es la fracción del máx. que no se ve.
- `COLUMN_COUNT_WEIGHT` sube de 0,5 a 4.
- Razonamiento: una fila de una columna (4) cuesta más que recortar dos clips hasta el umbral (2 × 0,4 × 4 = 3,2), pero menos que recortar uno por encima de ~46 % (1,6 + 40 × 0,06). Así se prefieren 2–3 columnas salvo que alguna pierda más de ~40 % de su máx. (`MAX_CROP_LOSS`).
- Ejemplos a 1920×1080 (tests "balanced columns…"):
  - 16:9 flexible (mín. 3:4) junto a un 9:16: se queda en 1312 px (pierde el 32 %) → 2 columnas;
  - junto a un 1:1 rígido se quedaría en 840 px (pierde el 56 %) → pantalla completa;
  - dos 16:9 a 960 px pierden el 50 % cada uno → pantalla completa.

Test "a flexible horizontal is narrowed to sit next to a vertical" (h0, v1, h2, v3):

```
-- antes (T10)
layout 0.00: c0=1920
layout 19.00+0.50: fill=352 | c0=608 | c1=608 | fill=352
c0: h0 0.00-10.00 > h2 9.50-19.50 > v1 19.00-29.00
c1: v3 19.00-29.00
warning: fill 704px @19.00
-- después (T10b)
layout 0.00: c0=1312 | c1=608
c0: h0 0.00-10.00 > h2 9.50-19.50
c1: v1 0.00-10.00 > v3 9.50-19.50
```

El umbral también afecta a los verticales que se ensanchan: un 9:16 a 1:1 pierde el 43,75 % de su máx. y paga 1,5 de exceso. Se sigue ensanchando cuando la alternativa es dejar relleno, porque el relleno pesa mucho más.

Snapshots:

- **"flexible clips with a gap, 2 columns max"**:
  - antes: empezaba con `b` solo a pantalla completa y acababa con 336 px de relleno;
  - ahora: 2 columnas desde el principio (`a` 686 | `b` 1226) y sin relleno.
- **"mixed verticals and horizontals"**: aparece `layout 18.00+0.50: c0=1312 | c2=608`. Cuando h1 entra en c0 (1080 px, encajaría directamente), la fila tenía 232 px de relleno, así que gana el re-layout que lo elimina (decisión 1).
- **"random order"**:
  - antes: `c7` a pantalla completa y un letterbox de `c3`;
  - ahora: empieza con 2 columnas (608 | 1312) y no hay letterbox.

### 3. Columna nueva

- Se verifica que sigue igual (test "a new column grows from width 0…").
- h0 (16:9 rígido) termina y lo sustituyen tres 9:16 ensanchables.
- Las columnas nuevas aparecen en el keyframe de 5,50, sus clips empiezan en 5,50 con `transitionIn = 0` y, al empezar la animación, tienen ancho 0 en `x = 1920` (borde derecho de la columna liberada).
- El plan es idéntico antes y después.

### 4. Final del vídeo: `transitionOut`

- Campo nuevo `ColumnPlacement.transitionOut?: number`, documentado en 04-diseno §3.1.
- Vale `min(D, duración/2)` en el último clip de una columna que sigue en el layout y que termina antes que el vídeo. Falta en los demás casos:
  - con sucesor;
  - en una columna quitada por un re-layout;
  - en el clip que termina con el vídeo, que ya cubre el fundido a negro global.
- El fundido va hacia el relleno, con el tipo de la transición global, en `[endTime − transitionOut, endTime]`.
- Es opcional para que los fixtures de T11 sigan compilando. T11 debe leerlo como `p.transitionOut ?? 0` y tratarlo como un intervalo ocupado más al trocear.
- Puede coincidir con una animación de otra columna (evento fusionado). Como los xfades, se fusiona en el mismo bloque.
- En la primera versión se acortaba el fundido para que ninguna animación empezara dentro de él. Se descartó: los xfades de sustitución ya se solapan así (1793 casos en el barrido de 20 000 proyectos) y el troceo de ADR-001/spike fusiona los intervalos ocupados.

Test "end of the video…":

```
-- antes (T10)
c0: v0 0.00-5.00
c1: v1 0.00-0.60 > v3 0.30-8.30
c2: v2 0.00-12.00
-- después (T10b)
c0: v0 0.00-5.00 ~fade 0.50
c1: v1 0.00-0.60 > v3 0.30-8.30 ~fade 0.50
c2: v2 0.00-12.00
```

### 5. Invariantes de ADR-001 en `validatePlan`

- **Orden estable**: las columnas comunes a dos keyframes consecutivos están en el mismo orden.
- **Colapso junto a la vecina derecha**:
  - Se calculan los dos extremos de cada columna con `getAnimatedColumn`: ancho 0 en `x` de la vecina derecha − `gap`, o `W`.
  - Se exige que cada par de columnas esté en el mismo lado en ambos extremos.
  - Como las posiciones interpoladas son mezclas de los extremos (lineal o smoothstep), eso garantiza que no se solapan en ningún instante.
- **Compatibilidad con T10**:
  - T10 crea las columnas nuevas a la derecha de la columna liberada. Con la regla, crecen desde el borde derecho de esa columna, así que es compatible y no hace falta cambiar nada.
  - Tampoco añade y quita columnas en la misma animación, que es el único caso que se cruzaría.
  - Queda documentado en 04-diseno §3.1 y en ADR-001.
- **Mutaciones**:
  - intercambiar dos columnas en un keyframe → "changes the column order" y "overlap";
  - plan hecho a mano donde una columna nueva aparece donde desaparece otra → "overlap";
  - la variante válida (se quita la izquierda y aparece otra a la derecha) no da ningún problema;
  - fundido que falta, con duración incorrecta, en un clip con sucesor o en el clip que termina el vídeo → detectado.

### Dudas / observaciones

1. **Fundido del último clip del vídeo**: no lleva `transitionOut` porque lo cubre el fundido a negro global (§4.5), que está activado por defecto. Si el usuario lo desactiva, el vídeo termina en corte. Me parece lo correcto, pero conviene confirmarlo.
2. **Dos animaciones seguidas**: en el snapshot "mixed", la decisión 1 añade un re-layout a los 18,0 s, 1,5 s después del anterior. Es lo que pide la regla, pero la fila se anima dos veces en poco tiempo. Si molesta, se puede exigir que el relleno dure un mínimo o añadir un intervalo mínimo entre animaciones.
3. **Xfades que se solapan con el inicio de una animación**: en eventos fusionados, una animación puede empezar mientras sigue el xfade de otra columna (ya pasaba con T10). ADR-001 lo admite ("o se fusionan en el mismo intervalo") y el troceo del spike fusiona los intervalos, así que no se añade como invariante. T11 debe mantener esa fusión.

## Revisión

- **Resultado**: aceptada. Lint y tests del planificador en verde (49); 20 000 proyectos aleatorios sin violaciones.
- **Nota para T11**: `ColumnPlacement.transitionOut` es opcional y usa el tipo de transición global; el intervalo cuenta como ocupado al partir en bloques.
- **Puntos abiertos**: se aceptan. El último clip del vídeo depende del fade global a negro; si se desactiva, termina en corte, que es coherente con la opción del usuario.
