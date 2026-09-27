# T63 · Bug: "Optimizar montaje" separa en la lista los clips enlazados

- **Hito**: M14 (corrección) · **Modelo**: Sonnet · **Depende de**: T61 · **Estado**: hecha

## Problema (informado por el usuario)

Con clips enlazados (cadenas, E2), "Optimizar montaje" los reordena en la lista por separado: algunos miembros de una cadena quedan al principio y otros al final. En el montaje salen seguidos y bien (el planificador trata la cadena como una unidad), así que es solo visual, pero la lista deja de reflejar el vídeo.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §11 (E2) y §15 (I2), [03-convenciones](../03-convenciones.md).
- `planner/optimizeOrder.ts` (movimientos, ventana, `getFixedClipIds`), `planner/units.ts` (cómo el planificador forma las cadenas y qué posición de lista usa la unidad), `clipLinks.ts`, `optimize/optimizeMix.ts`, `hooks/useMixOptimize.ts`; notas de T38 (cadenas) y T61.

## Alcance

1. El optimizador trabaja con **unidades**: una cadena se mueve entera (sus miembros contiguos y en su orden de cadena); la ventana se comprueba para la unidad. El orden aplicado a la lista deja siempre cada cadena contigua.
2. Comprueba que el plan resultante es el mismo que el que se mostró en el antes/después (el que se aplica debe coincidir con el evaluado).
3. Tests: proyecto con varias cadenas repartidas por la lista → tras optimizar, cada cadena está contigua y en orden; el plan del orden aplicado es idéntico al evaluado; un e2e o ampliar el 26 con una cadena.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

### Causa

`planner/optimizeOrder.ts` no sabía nada de `input.chains`: cada movimiento (intercambio o desplazamiento) actuaba sobre clips individuales, así que los miembros de una cadena podían acabar en cualquier posición, cada uno dentro de su propia ventana pero sin ninguna relación entre ellos. El planificador seguía tratando la cadena como una unidad (toma la posición de lista de "cualquiera que sea su miembro más temprano", `planner/units.ts#getPlanUnits`), así que el plan salía bien, pero la lista aplicada quedaba con la cadena repartida.

### Cambio

- `planner/optimizeOrder.ts`:
  - `getMovableBlocks(input)` (nueva, exportada): agrupa los clips movibles (los no fijados) en **bloques**: una cadena (`getPlanLinks` sobre `input.chains`/`sequence`) es un bloque con todos sus miembros, en orden de cadena; el resto son bloques de un clip. Se recorre la lista en orden y el bloque se crea al encontrar el primer miembro de la cadena (misma regla que `getPlanUnits`), así que de entrada ya reúne una cadena que la lista tenga repartida.
  - `createOrderOptimizer` pasa a buscar sobre una permutación de **bloques**, no de clips: los intercambios y desplazamientos mueven un bloque entero (sus clips van seguidos y en su orden de cadena en cualquier posición que ocupe) y la ventana se comprueba para el bloque (su posición original = la de su miembro más temprano), no para cada clip. La permutación de bloques se expande a la permutación de clips (`toPerm`) para evaluar con `planMixBest`, igual que antes.
  - `getOptimizeOrderBlocker` usa `getMovableBlocks` para "menos de dos movibles" (antes contaba clips; ahora cuenta bloques, así una única cadena sin nada más que mover también bloquea).
  - El desplazamiento (`OrderQuality.displacement`) no cambia: sigue siendo la suma por clip, sobre la permutación de clips ya expandida.
- Tests (`planner/optimizeOrder.test.ts`):
  - se actualiza el test de ventana/fijados (ya tenía una cadena de 2 clips separados 5 posiciones): ahora comprueba la ventana sobre el clip más temprano de la cadena y que el segundo miembro va justo detrás, en vez de exigir la ventana por clip a los dos;
  - test nuevo: proyecto con 3 cadenas repartidas por la lista → tras optimizar, cada cadena queda contigua y en su orden, y el plan de la lista aplicada (`reordered` + `planMixBest`) coincide con el evaluado (`result.quality`) y es válido (`validatePlan`).
- `e2e/videomix.e2e.ts` (escenario 26): se añade una cadena forzada (`link: 'force'`, tiempos de fuente consecutivos) entre el primer clip de la lista y el sexto (repartidos, como el caso del bug), dando a los demás clips tiempos de fuente que no interfieren. Tras aplicar, se comprueba que la cadena queda contigua y en orden, y que solo su primer clip responde a la ventana (el segundo se ancla a él, no a su propia posición original).

### Decisiones

- El resto de restricciones (grupos sin fijar) no cambia: como explica T38 (Decisiones), un grupo no necesita ser contiguo en la lista para que el planificador lo trate como unidad (usa un `Map` por `groupId`, no la posición), así que no forma parte de este bug y no se ha tocado.
- Reunir los miembros de una cadena en el bloque no cambia la calidad del plan evaluado: el planificador ya ignora la posición de los miembros que no son "el primero encontrado" (los salta en `getPlanUnits`), así que el orden de unidades que ve el planificador es idéntico esté la cadena reunida o repartida. Por eso no ha hecho falta reevaluar nada al reunir: el "antes" (`initial`) del optimizador es el mismo que con la lista original.

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (105 ficheros, 1257 tests) y `yarn build` en verde.
- `yarn test-e2e`: **28/28**, incluido el escenario 26 ampliado con la cadena.

## Revisión

- **Resultado**: aceptada. Validación del orquestador: tsc, lint, 1257 tests, e2e 28/28.
