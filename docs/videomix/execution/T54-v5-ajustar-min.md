# T54 · v5: "Ajustar a" sobre el mín. (G5)

- **Hito**: M12 · **Modelo**: Sonnet · **Depende de**: T51 · **Estado**: en curso

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§13 (v5)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- `fitFractions.ts` (`fitMaxRectToFraction`), `RectOverlayToolbar.tsx`, `ClipRectEditor.tsx`, notas de T44, T44b, T45 y T49 (clips animados: la barra cambia los rectángulos base).

## Alcance

1. Función pura `fitMinRectToFraction` (o ampliar la existente): con mín., ajusta su ancho en el eje principal (crece o encoge, centrado en el propio mín., dentro del máx.) para que el ancho más estrecho del clip (`min.w / max.h` escalado a la salida, ver `getAspectRange`) sea exactamente la fracción. Si el máx. no alcanza la fracción, ensanchar el máx. lo justo (centrado, dentro del fotograma, conteniendo al mín.); si no cabe en el fotograma, error con motivo. Tests (columnas, filas, giros).
2. Los botones "Ajustar a" usan esa función cuando hay mín. (un paso de historial); el tooltip lo explica.
3. **Seguimiento de T51**: el campo numérico de separación (Ajustes → Composición) crea un paso de deshacer por cada dígito tecleado; agrupar la edición de un campo numérico en un paso (p. ej. transitorio mientras tiene el foco, commit al salir o con Intro), y aplicarlo a los demás campos numéricos de ajustes si tienen el mismo problema.
4. i18n, manual, e2e.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

## Revisión
