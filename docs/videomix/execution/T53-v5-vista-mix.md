# T53 · v5: filas compactas y zoom/scroll en la vista Mix (G3, A3)

- **Hito**: M12 · **Modelo**: Opus · **Depende de**: — · **Estado**: en curso

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§13 (v5)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- `videomix/mixPlanLayout.ts` (`getLaneColumns`: una fila por id de columna), `components/MixPlanView.tsx` y su CSS, pistas de overlays en la vista Mix (T22), fijaciones por arrastre (A4, T30), notas de T15, T22, T30.

## Alcance

1. **Filas compactas (G3)**: asignar columnas a filas de forma que columnas que no coinciden en el tiempo compartan fila; número de filas = máximo de columnas simultáneas; en lo posible, en cada instante, fila de arriba = columna más a la izquierda (o de arriba, en filas). Puro y con tests. Revisa que arrastrar/fijar clips (A4), el relleno y los avisos sigan funcionando.
2. **Zoom y scroll (A3)**: por defecto, todo ajustado al ancho (como ahora). Ctrl + rueda: zoom centrado en el ratón; rueda o Mayús + rueda: scroll horizontal. Botones + / − / Ajustar en la cabecera. Al reproducir con zoom, la vista sigue al cursor de reproducción. Pistas de overlays, eje de tiempo y cursor sincronizados. El zoom no se guarda en el proyecto.
3. i18n (en + es), e2e (filas compactas en un proyecto que antes generaba muchas filas; zoom con botones y Ctrl + rueda; seguimiento del cursor).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde; capturas revisadas.

## Notas de ejecución

## Revisión
