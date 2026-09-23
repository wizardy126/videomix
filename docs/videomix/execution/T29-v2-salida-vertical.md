# T29 · v2: salida vertical 9:16 y 1:1 (B5)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T24 · **Estado**: pendiente

## Alcance

1. **Planificador en "eje principal"**:
   - en 9:16, filas a ancho completo apiladas (se trasponen las proporciones y los recortes);
   - en 1:1, se prueban filas y columnas y gana la de menor puntuación. Se decide una vez por proyecto, no por evento; se documenta si hay otra opción mejor.
   - Todas las invariantes y `validatePlan` se generalizan. Tests de propiedades en los tres aspectos.
2. **Render**: `renderTimeline` y `buildVideoGraph` trabajan en el eje, con capas de columna o fila, rellenos, separaciones y animaciones.
   - Snapshots y un test con ffmpeg real en 9:16 (el número de fotogramas es exacto).
3. **Geometría**: `getCropForAspect` y `distributeWidths` generalizados, o una versión traspuesta. Los avisos de upscale siguen siendo correctos.
4. **UI**:
   - selector de proporción y resolución en `MixSettingsDialog` (`getOutputSize` de T24);
   - la mini vista y `MixPlanView` se adaptan: los carriles son filas en vertical;
   - las cajas de overlays en 0..1 se mantienen.
5. **Previsualización**: resolución reducida con la misma proporción.
6. **i18n**: español.

## Criterios de aceptación

- Fotogramas revisados en 9:16 y 1:1 con re-layout animado.
- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

## Revisión
