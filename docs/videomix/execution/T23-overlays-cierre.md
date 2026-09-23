# T23 · Overlays: i18n, manual y revisión final

- **Hito**: M7 · **Modelo**: Sonnet · **Depende de**: T20, T21, T22 · **Estado**: pendiente

## Objetivo

Cerrar el hito de overlays.

## Alcance

1. `scan-i18n` y revisión del español de todas las claves nuevas.
2. **Manual de usuario**: sección de imágenes, contadores, barras y efectos de sonido (anclajes, edición y ejemplos típicos, como una cuenta atrás de 10 s con barra y un pitido al terminar).
3. **Proyecto de ejemplo** en `script/videomix/` (o una ampliación de `renderPlan.ts`) que use los cuatro tipos con `test-media`. Renderízalo y revisa fotogramas y audio.
4. Revisión de los atajos, si se añadieron.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

## Revisión
