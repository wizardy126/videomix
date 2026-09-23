# T34 · v2: i18n, manual y cierre

- **Hito**: M8 · **Modelo**: Sonnet · **Depende de**: T24–T33 · **Estado**: pendiente

## Alcance

1. `scan-i18n` y revisión del español.
2. Manual de usuario: todas las mejoras v2.
3. Proyecto de ejemplo en 9:16 con textos, lista de música y ducking, renderizado y revisado.
4. **Pendiente de T29**: al cambiar `settings.output.aspect`, reajustar las cajas de los overlays de imagen para conservar la proporción de la imagen, sin estirarla (centradas en su caja actual). Con test.
5. **Pendientes de T33**: ensanchar el campo de nombre del clip en `ClipList` y corregir en el manual que el `.vmx` es JSON5. Después de los cambios, ejecutar `yarn test-e2e`, que debe seguir en verde.
6. Revisión de atajos y menús nuevos.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

## Revisión
