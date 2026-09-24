# T43 · Diálogos y avisos tapados por la previsualización en vivo

- **Hito**: M10 · **Modelo**: Opus · **Depende de**: T41, T42 · **Estado**: en curso

## Objetivo

El diagnóstico de T41 encontró que, en la pestaña Mix, `MixLivePreview` (`z-index: 1` en el contexto de apilamiento raíz) se pinta **encima** del `Working` heredado y de los diálogos centrados de Radix (ver la captura `test-results/e2e-screenshots/08a-preview-dialog.png`: la previsualización tapa el diálogo "Mix preview"). T41 solo lo resolvió para su modal (`z-index: 2`). Hay que arreglarlo de forma general.

## Alcance

1. Que **todos** los diálogos, el `Working`, los toasts (SweetAlert), los menús contextuales y los desplegables de Radix (incluidos los que se abren dentro de un diálogo) queden por encima de la previsualización en vivo. Averigua por qué `MixLivePreview` necesita `z-index` y por qué `isolation: isolate` en el contenedor del reproductor rompió el dibujado de fotogramas (e2e 7): elige la solución de raíz más pequeña (p. ej. quitar o rebajar ese `z-index`, o subir de forma coherente las capas de los portales) y documenta la causa.
2. Una vez resuelto de forma general, simplificar el `LAYER` de `RenderProgressDialog` si ya no hace falta.
3. **Decisión del orquestador sobre T42**: "Borrar caché de render" (`userClearRenderCache` en `useMixRender.ts`) debe **conservar** la carpeta `converted/` (las conversiones son de previsualización, pueden ser lentas y no son caché de render). Ajustar el código, un test si hay lógica pura, y el manual (que ahora dice que se borran).
4. **e2e**: comprobar con `elementFromPoint` (como hace el helper de T41) que el diálogo "Mix preview" del escenario 8a y el `Working` (alguna operación en la pestaña Mix que lo use) no quedan tapados; revisar las capturas.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde (el e2e 7, que dibuja fotogramas en la previsualización, incluido).

## Notas de ejecución

## Revisión
