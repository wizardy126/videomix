# T40 · v3: i18n, manual, e2e y cierre

- **Hito**: M9 · **Modelo**: Sonnet · **Depende de**: T35–T39 · **Estado**: pendiente

## Alcance

1. `scan-i18n` y revisión del español.
2. **Manual**:
   - contador de duración, "Nuevo clip desde aquí" y clips solapados (duplicar o esta acción);
   - clips enlazados, secuencia siempre visible, duración estimada y máxima;
   - nota sobre las fuentes anamórficas.
3. **Nuevos escenarios e2e**: contador visible al marcar un inicio, "Nuevo clip desde aquí" dentro de un clip, indicador de duración estimada y aviso de duración máxima.
4. Proyecto de ejemplo que use cadenas, secuencia y límite: renderizado y revisado.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

## Revisión
