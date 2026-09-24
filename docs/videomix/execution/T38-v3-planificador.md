# T38 · v3: planificador — cadenas, secuencia y duración máxima (E2, E4, E5)

- **Hito**: M9 · **Modelo**: Opus · **Depende de**: T36 · **Estado**: pendiente

## Alcance

1. **Cadenas (E2)**:
   - Cada cadena de `getClipChains` se planifica como **una unidad que ocupa un mismo hueco**: sus clips van seguidos en la misma columna o fila, sin nada entre medias y sin cortar clips.
   - Entre clips de una cadena: `transitionIn = 0` (corte directo, concat en el render) si `links.transition === 'cut'`; si no, la transición global.
   - Si la proporción del siguiente clip no encaja en el ancho del hueco, hay un re-layout animado que empieza en el cambio.
   - La cadena ocupa la posición de lista de su primer clip. Respeta fijaciones y grupos según la regla de T36.
2. **Secuencia siempre visible (E5)**:
   - Un **hueco dedicado** presente en todo momento mientras quedan clips de la secuencia. Sus clips van uno tras otro en ese hueco (transición según `links.transition`, o global; documéntalo).
   - La **posición la decide el algoritmo** y puede cambiar en re-layouts. El resto de huecos se reparte con normalidad (el máximo de columnas incluye el de la secuencia).
   - Duración del vídeo = lo más largo de las dos cosas:
     - si la secuencia termina antes, su hueco se libera;
     - si termina después, sigue sola o con los huecos que queden (relleno o expansión según las reglas actuales del final).
3. **Duración máxima (E4)**: con `maxDuration` definida, la puntuación favorece **más columnas** mientras el contenido previsto supere el límite (documenta los pesos).
   - Nueva función pura `truncatePlan(plan, maxDuration)`: corta *placements* y *layouts* en el límite, marca un aviso `truncated` (segundos y clips perdidos) y deja `plan.duration = maxDuration`, para que el *fade* global quede en el corte.
   - Si hay efectos de sonido u overlays después del límite, se recortan.
4. **Invariantes** nuevas en `validatePlan`:
   - las cadenas son contiguas en el mismo hueco;
   - la secuencia siempre está visible mientras le quedan clips;
   - un plan truncado no pasa del límite.

   Tests de mutación y de propiedades en los 3 aspectos. Rendimiento < 1 s con 200 clips.
5. Actualiza 04-diseno §3.

## Criterios de aceptación

- Sin cadenas, sin secuencia y sin límite, el plan es idéntico al actual: los snapshots no cambian.
- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

## Revisión
