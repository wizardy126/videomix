# T63 · Bug: "Optimizar montaje" separa en la lista los clips enlazados

- **Hito**: M14 (corrección) · **Modelo**: Sonnet · **Depende de**: T61 · **Estado**: en curso

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

## Revisión
