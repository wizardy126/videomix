# T54 · v5: "Ajustar a" sobre el mín. (G5)

- **Hito**: M12 · **Modelo**: Sonnet · **Depende de**: T51 · **Estado**: hecha

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

### Resumen

1. **`fitMinRectToFraction`** (`fitFractions.ts`, junto a `fitMaxRectToFraction`): con mín., resuelve el ancho del propio mín. en el eje principal (centrado en sí mismo; su longitud transversal, su posición transversal y el máx. quedan igual) para que `min.w / max.h` (el extremo inferior de `getAspectRange`) sea exactamente la proporción de la celda de la fracción. Reutiliza `normalizeClipRects` (como `getFractionFits`) para que el mín. normalizado siga garantizado dentro del máx. — usar `normalizeRectEven` por separado (como hace `fitMaxRectToFraction`, que no necesita esa garantía porque construye el máx. alrededor del mín.) dejaba el mín. fuera del máx. en el test de propiedades cuando los rectángulos de entrada no eran ya pares. Si el máx. no es lo bastante ancho para contener ese mín. (no "alcanza" la fracción), se ensancha en el eje principal, centrado en sí mismo, lo justo para contenerlo (mín. = máx. en ese eje), recortado al fotograma; si ni todo el fotograma basta, falla con `no-room`. Mismo ajuste ±2 px por el redondeo par que `fitMaxRectToFraction`, apuntando primero al encaje exacto y aceptando la tolerancia del 1 % (T44b) si no llega. Tests: encoger un mín. ancho, crecer uno estrecho, ensanchar el máx. cuando no alcanza (centrado, con y sin fotograma alrededor), el fallo `no-room`, filas (traspuesto) y una prueba de propiedades (200+ combinaciones aleatorias de rects/fracciones/ejes) que comprueba pares, contención, encaje exacto o tolerado.
2. **`ClipRectEditor.handleFitTo`**: si el clip tiene mín., usa `fitMinRectToFraction` (aviso `no-room` con un texto distinto si falla); si no, `fitMaxRectToFraction` como antes. `RectOverlayToolbar`: el tooltip de "Ajustar a" explica cuál de los dos rectángulos se ajusta según `hasMin`.
3. **Campo numérico de separación y los demás con el mismo problema** (seguimiento de T51): se extrajo el `NumberField` de `OverlayPanel.tsx` (que ya aplicaba el patrón "borrador local, commit en blur/Intro, Escape descarta") a `TransientInputs.tsx`, junto a `RangeInput`/`ColorInput`, para reutilizarlo. `MixSettingsDialog.tsx` lo usa ahora en los tres campos numéricos que creaban un paso de deshacer por dígito: **separación entre columnas/filas** (px), **ventana de reordenación** (E8) y **margen de enlace automático** (E2, `links.maxGap`); los tres perdieron su estado de borrador local (`reorderWindowText`, `maxGapText`) porque `NumberField` ya lo gestiona. No encontré otros campos numéricos de ajustes con el mismo problema: CRF y duración de transición ya eran `RangeInput` (T51); duración máxima ya tenía su propio borrador con commit en blur/Intro; el resto de la sección Música usa `RangeInput`/`NumberField` de música o `select`. Los campos de `OverlayPanel.tsx` ya estaban bien (auditoría de T51); solo cambiaron de fichero.
4. **i18n**: `yarn scan-i18n` + traducción al español de los dos textos nuevos (el aviso de "Ajustar a" con mín. y el tooltip sin mín., que cambió de texto al dejar de mencionar "o en el máx. actual").
5. **Manual**: `docs/videomix/manual-usuario.md` no documentaba nada de F1/F2 (encaje en fracciones, imán, "Ajustar a") desde T44b/T45; añadido un párrafo en la sección de recorte espacial (§3) que cubre los chips, el imán y "Ajustar a", incluido el comportamiento nuevo con mín. de esta tarea.
6. **e2e**: escenario **23** nuevo (`fit in fractions...`), con la app limpia: encoger un mín. de 960×540 a 640×540 con "Ajustar a 1/3" (deshacer incluido) y, tras encoger el máx. a mano a menos de 640 px, comprobar que "Ajustar a 1/3" ensancha máx. y mín. a la vez a 640 px. Además, en el escenario **21** (auditoría de deshacer de T51), un caso nuevo: teclear "12" dígito a dígito en el campo de separación (con `pressSequentially`, no `.fill()`, para reproducir de verdad el teclear letra a letra) es un solo paso de deshacer (un Ctrl+Z lo revierte del todo a "0", no solo el último dígito); confirmado también que deshacer/rehacer funciona con el foco en cualquier sitio salvo en el propio campo (política de foco de T51: un input de texto/número se queda todas las teclas, así que hay que quitarle el foco —`blur`, como ya hace `seekBy`— antes de los atajos).

### Dudas y desviaciones

- El requisito (G5) no especifica qué le pasa a la posición/tamaño transversal del mín. ni al máx. cuando se ensancha: elegí la opción más conservadora y simétrica con el resto del módulo (centrado en sí mismo, como el resto de operaciones "ensanchar" de F1/F2/E7), sin tocar la longitud transversal de ninguno de los dos rectángulos. Documentado en 04-diseno §10.2.
- El nombre del motivo de fallo es `no-room` (distinto de `min-too-large` de `fitMaxRectToFraction`, que es sobre si el mín. *original* cabe en un máx. de esa proporción): aquí no hay un mín. "demasiado grande" porque el mín. siempre se redimensiona a la fracción; solo falla si ni el fotograma entero alcanza esa fracción.
- No se ha añadido una sección propia al manual para F1/F2 en tareas anteriores (T44b/T45 no la tocaron); en vez de dejarlo así una tarea más, se documentó aquí junto con el cambio de G5, ya que el criterio de la tarea pide "manual".

### Validación

- `yarn tsc` ✔, `yarn lint` ✔ (solo el ruido preexistente de `jsx-ast-utils` con `satisfies`, no relacionado), `yarn test run` ✔ (96 ficheros, 1182 tests), `yarn build` ✔.
- `yarn test-e2e`: 25/25 (incluye los escenarios 16, 21 y 23 relevantes a esta tarea; el resto sin cambios).

## Revisión

## Revisión

- **Resultado**: aceptada. Nota: el manual no tenía la sección de F1/F2 pese a lo que decía T50; la añadió esta tarea. T55 revisará que el manual esté completo (incluida la tolerancia del 1 %).
- **Validación del orquestador**: tsc, lint, 1182 tests, e2e 25/25.
