# T44b · v4: tolerancia de encaje del 1 % sin deformar

- **Hito**: M11 · **Modelo**: Opus · **Depende de**: T44 · **Estado**: en curso

## Objetivo

Hoy un clip sin rectángulo mín. tiene **un único ancho posible** (`getWidthRange` colapsa a un par), y el planificador trabaja con píxeles pares exactos. Si la celda de una fracción no es un par exacto (p. ej. 1/3 de 1280 px, o según la separación), ese clip no encaja nunca del todo: quedan 2–4 px de relleno o se amplía con E7. Es lo que el usuario sufre "por unos pocos píxeles".

**Decisión del usuario**: tolerancia del **1 %** en la proporción. El desajuste se absorbe, **en este orden de preferencia**:

1. **Recortar dentro del máx.** en el eje secundario (p. ej. quitar ~1 % de alto, repartido arriba y abajo, y escalar esa imagen un ≤ 1 %), o en el principal si sobra ancho. Sin deformar y sin mostrar nada fuera del máx. No es posible si el mín. toca ese borde.
2. Si no, **ampliar unos píxeles fuera del máx.**, si la fuente tiene material y el clip permite "Ampliar más allá del máx." (E7).
3. Solo si nada de eso es posible, **estirar como mucho un 1 %** (lo que ya hace hoy `getCropForAspect` dentro de `ASPECT_TOLERANCE`).

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.2, §11 (E7) y §12, [03-convenciones](../03-convenciones.md), [04-diseno](../04-diseno.md) (§3, §10 de T44).
- `geometry.ts` (`ASPECT_TOLERANCE`, `getAspectRange`, `getWidthRange`, `distributeWidths`, `getCropForAspect`, `getExtendedCropForAspect`, `getExtensionRoom`), `planner/` (`planMix.ts`, `extendPlan.ts`, `validatePlan.ts`), `fitFractions.ts` (T44), `render/buildVideoGraph.ts`, `preview/previewDraw.ts`, `thumbnails.ts`.
- Notas de ejecución de T44 (contratos de `fitFractions`) y T38b (E7).

## Alcance

1. **Rango de anchos con tolerancia**: el planificador (`getWidthRange`/`distributeWidths` o donde encaje mejor) acepta anchos cuya proporción se desvía hasta un 1 % del rango del clip. Prefiere siempre los anchos dentro del rango exacto: la tolerancia solo se usa cuando sin ella quedaría relleno o sería inviable (documenta cómo se garantiza). Tests, incluido el caso de tres clips 9:16 sin mín. en 1280×720 y 1920×1080 con y sin separación, que deben quedar **sin relleno**.
2. **Recorte con desajuste** (`getCropForAspect` y la versión extendida de E7): implementa el orden 1 → 2 → 3 con la función pura que decide el recorte para una celda, devolviendo también qué estrategia usó. Siempre rectángulos pares, dentro del fotograma, conteniendo al mín.
3. **Coherencia**: render, previsualización en vivo y miniaturas usan esa misma función, así que salen iguales. El indicador de encaje de T44 (`fitFractions`) cuenta como ✓ lo que entra con la tolerancia (y como ↔ si necesita ampliar más allá de lo que da la tolerancia). "Ajustar a" y el imán siguen apuntando a la proporción exacta.
4. **Impacto en proyectos existentes**: los planes pueden cambiar ligeramente (se rehacen los bloques de caché afectados). Documéntalo. Revisa y actualiza los snapshots afectados justificando cada cambio en las notas, sin aceptar cambios a ciegas.
5. **Test con ffmpeg real**: tres clips 9:16 sin mín. en 1280×720 → sin columnas de relleno (comprobación por píxeles) y sin deformación apreciable.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde; `yarn test-e2e` en verde.
- [04-diseno](../04-diseno.md) actualizado (tolerancia y orden de estrategias).

## Notas de ejecución

## Revisión
