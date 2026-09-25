# T45 · v4: indicador de encaje, imán y "Ajustar a" (F1, F2)

- **Hito**: M11 · **Modelo**: Opus · **Depende de**: T44, T44b · **Estado**: hecha

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

### Resumen

- **Chips sobre el recorte** (`components/FitChips.tsx`, montados por `RectOverlay`): 1/3 · 1/2 · 2/3 · Completo con ✓ (verde), ↔ (ámbar, encaja ampliando con E7) o ✗ (rojo) y, en los ✗, "faltan N px" / "sobran N px" (px de la fuente, los `missing`/`excess` de `getFractionFits`). `ClipRectEditor` los calcula con `getFractionFits` sobre los rectángulos del clip, que el padre actualiza en cada paso del arrastre (edición transitoria), así que cambian en tiempo real. Incluyen la tolerancia del 1 % (T44b).
- **Lista de clips** (`ClipList.tsx`, `ClipFitLabel`): etiqueta compacta en la segunda línea de cada fila con las fracciones en las que encaja (`1/2✓` en verde, `1/3↔` en ámbar; `✗` en rojo si ninguna) y tooltip con el detalle de las cuatro ("1/2: encaja", "2/3: no encaja (faltan 12 px)"…). Sin tamaño de fuente conocido no se muestra.
- **Imán** (`snapRectDrag` y `getSnapEdge` en `fitFractions.ts`, sobre `snapRectEdge` de T44): toggle con icono de imán en la barra del editor (`data-testid="fit-magnet-toggle"`, `aria-pressed`, resaltado en cian cuando está activo, tooltip con el estado y lo que hace Alt). Activo = toggle XOR Alt. Pulsar o soltar Alt durante un arrastre rehace el paso en el acto (sin esperar a mover el ratón) y se evita su acción por defecto. El chip de la fracción enganchada se resalta mientras dura el arrastre.
- **Persistencia**: preferencia de la app `fitMagnet` (`Config` en `common/types.ts`, valor por defecto `false` en `configStore.ts`), leída y guardada por `hooks/useFitMagnet.ts` directamente en el `configStore` (como `useOverlayStylePresets`), no en el proyecto ni en el historial.
- **"Ajustar a 1/3 / 1/2 / 2/3"** (`fit-to-1-3`, `fit-to-1-2`, `fit-to-2-3`): `fitMaxRectToFraction` → `onEdit` (un paso de historial). Si falla (`min-too-large`), toast de aviso con el motivo ("el rectángulo mín. no cabe en un rectángulo de esa proporción dentro del fotograma. Reduce el mín.").
- **Eje** (`hooks/useFitLayout.ts`, usado en `App.tsx` y pasado a `ClipRectEditor` y `ClipList`): el de la salida; en 1:1, el del plan actual.
- i18n en y es; docs: [04-diseno](../04-diseno.md) §10.2 (UI).

### Decisiones

1. **"Plan actual" en 1:1**: el plan solo se calcula con la vista Mix abierta (`useMixOverlays`), y el editor de rectángulos se usa con ella cerrada. `useFitLayout` recuerda el eje del **último plan calculado** en la sesión (el `fullPlan`, a la resolución final, como el render); si aún no hay ninguno, columnas (decisión del usuario). No recalculo el plan fuera de la vista Mix para esto (con ventanas de reorden grandes puede ser lento durante un arrastre). Limitación: al abrir otro proyecto 1:1 se sigue usando el eje recordado hasta que se muestre su vista Mix.
2. **Colocación de los chips**: debajo del máx., fuera de sus tiradores (a medio tirador + 4 px), si cabe en el área del reproductor; si no (máx. hasta el borde inferior), dentro del máx., justo encima de sus tiradores de abajo. Alineados con el lado del fotograma en el que está el máx. (a la izquierda si su centro está en la mitad izquierda, a la derecha si no) y desplazados un tirador hacia dentro, para no salirse del reproductor; si no caben en una línea, se reparten en varias. Fondo negro al 75 % con borde claro y texto blanco: legibles sobre cualquier imagen en ambos temas. **Sin eventos de puntero**: aunque tapen algo (p. ej. un tirador del mín. cerca de la esquina inferior), el tirador sigue funcionando debajo. La etiqueta de tamaño sigue arriba a la izquierda.
3. **Imán en una esquina**: engancha el borde del **eje principal** (izquierdo/derecho en columnas, superior/inferior en filas), que es el que decide el encaje; el otro sigue al ratón. Mover (no redimensionar) no engancha.
4. **Imán y proporción bloqueada**: con una proporción fija en el máx. (selector "Proporción del máx."), el imán **no actúa sobre el máx.** (enganchar un borde rompería el bloqueo); sí sobre el mín., que nunca está bloqueado.
5. **Imán y mín.**: el máx. enganchado debe seguir conteniendo al mín.; si no, no engancha (en vez de empujar o recortar el mín.). El mín. enganchado debe quedar dentro del máx. (`bounds`). Tamaño mínimo de 16 px en ambos.
6. **Umbral**: 8 px de pantalla, convertidos a px de la fuente con la escala del overlay en cada eje.
7. **"Ajustar a" y proporción bloqueada**: el nuevo máx. tiene otra proporción, así que se **quita el bloqueo** (como hace "Llenar fotograma"). Los clips animados (keyframes) no se tratan aparte: lo decide T49 (duda 3 de T44).
8. **Lista de clips**: la segunda línea de cada fila ahora **se parte en varias líneas** (`flexWrap`) si no cabe. En el panel de 220 px, los indicadores del final (y la nueva etiqueta) quedaban cortados por el `overflow: hidden` del panel; ahora se ven (las filas se miden con `measureElement`, así que el virtualizador lo soporta). Es el único cambio de maquetación de la fila.
9. **Barra del editor**: con los botones nuevos era demasiado ancha para el `left: 50%` + `translateX(-50%)` (los textos se partían en tres líneas); ahora el envoltorio mide `max-content` (hasta el ancho del reproductor) y la barra se parte en líneas si no cabe.
10. **"Completo"**: se muestra como "Full"/"Completo" en chips y lista (la fracción `full`).

### Observaciones (fuera de alcance)

- La barra del editor (desde T06) está sobre la parte superior del reproductor: con un máx. que llega arriba del todo tapa la etiqueta de tamaño y los tiradores superiores centrales (visible en la captura `13a`, clip girado a 9:16). No es nuevo, aunque la barra es algo más ancha.
- En Linux, algunos gestores de ventanas usan Alt+arrastrar para mover la ventana y se quedan el gesto antes que la app; es inherente a la decisión de usar Alt.

### Validación

- `yarn tsc`, `yarn test run` (90 ficheros, 1099 tests), `yarn build` y `yarn test-e2e` (19/19) en verde. `yarn lint`: mis ficheros limpios; el único error es `no-continue` en `script/videomix/spike/keyframeSpike.ts`, fichero sin versionar del agente de T48 que trabaja en paralelo.
- Tests nuevos en `fitFractions.test.ts` (`snapRectDrag (F2 magnet while dragging, T45)`): borde que engancha según el tirador y el eje, el máx. dentro del fotograma y conteniendo al mín. (si no, no engancha), umbral por eje, el mín. dentro del máx., sin mín. no hace nada, y un máx. enganchado encaja en su fracción.
- **e2e 16** (`VideoMix (fit in fractions, magnet and "Fit to")`, app propia, fuente 1920×1080 y salida por defecto 1920×1080): chips iniciales (completo ✓, 1/2 ✗ "px over") y los de la lista; arrastrar el borde derecho a ~1100 px **cambia los chips durante el arrastre** (completo pasa a ↔ con E7); sin E7, ✗ con "px short"; con el imán activado, soltar a 6 px de un tercio deja el máx. en **640×1080 exactos** y el chip 1/3 en ✓ (también durante el arrastre y en la lista); con Alt mantenido no engancha; el toggle queda guardado en `config.json` (`fitMagnet: true`); **"Ajustar a 1/2" → 960×1080 y chip 1/2 en ✓** (y en la lista), y Ctrl+Z lo deshace en un paso.
- Capturas revisadas: `16a-fit-chips` (chips debajo del máx.), `16b-magnet` (máx. de 640 enganchado, toggle activo), `16c-fit-to-half` (barra en una línea, etiqueta `1/2✓` en la lista) y `13a-turned-clip-editor` (máx. a toda la altura: chips dentro, encima de los tiradores inferiores).

## Revisión

- **Resultado**: aceptada (capturas 16a–16c revisadas). Validación del agente: tsc, 1099 tests, build, e2e 19/19; lint limpio en sus ficheros (el único error era del spike de T48, en curso).
- **Seguimiento**: la barra del editor tapa la etiqueta de tamaño y los tiradores superiores cuando el máx. toca el borde superior (preexistente, T06): se resuelve en T49, que rehace esa barra.
