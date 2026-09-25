# T45 · v4: indicador de encaje, imán y "Ajustar a" (F1, F2)

- **Hito**: M11 · **Modelo**: Opus · **Depende de**: T44 · **Estado**: pendiente

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- Lógica de T44 (`fitFractions`, `snapRectEdge`, `fitMaxRectToFraction`) y sus notas.
- `videomix/components/RectOverlay.tsx`, `RectOverlayToolbar.tsx`, `ClipRectEditor.tsx`, `ClipList.tsx`.

## Alcance

1. **Chips sobre el recorte**, actualizados en tiempo real durante el arrastre: 1/3 · 1/2 · 2/3 · completo con ✓ / ↔ (encaja ampliando) / ✗, y en los ✗ "faltan N px" / "sobran N px" (px de la fuente). Legibles sobre cualquier imagen, sin tapar los tiradores; colocados de forma que no molesten (decide y documenta).
2. **Lista de clips**: etiqueta compacta por fila con las fracciones en las que encaja (✓ y ↔ distinguibles), con tooltip del detalle.
3. **Imán**: toggle en la barra del editor, **desactivado por defecto**, que muestra su estado; **Alt mantenido durante el arrastre invierte el toggle**. Engancha bordes del máx. y del mín. a la fracción más cercana dentro de un umbral en px de pantalla. Persistencia del toggle: preferencia de la app (no del proyecto).
4. **Botones "Ajustar a 1/3 / 1/2 / 2/3"** en la barra del editor (un paso de historial cada uno; si no es posible, aviso con el motivo).
5. i18n (en + es), `data-testid` para e2e.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde; e2e nuevo: arrastrar un borde cambia los chips; con imán, el borde se engancha; "Ajustar a 1/2" deja el chip 1/2 en ✓. Capturas revisadas.

## Notas de ejecución

## Revisión
