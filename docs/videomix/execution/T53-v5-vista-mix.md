# T53 · v5: filas compactas y zoom/scroll en la vista Mix (G3, A3)

- **Hito**: M12 · **Modelo**: Opus · **Depende de**: — · **Estado**: hecha

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

### Ficheros

| Fichero | Cambio |
|---|---|
| `videomix/mixPlanLayout.ts` (+ test) | `getLaneColumns` (un carril por id de columna) pasa a ser `getMixLanes(plan): number[][]`: los carriles de arriba abajo, cada uno con los ids de columna que muestra. `getPlacementAt` recibe esos carriles. |
| `videomix/mixPlanZoom.ts` (+ test, nuevo) | Cálculos puros del zoom: límites (`getMaxMixZoom`, `clampMixZoom`), rueda (`getWheelPixels`, `getWheelZoomFactor`), `scrollLeft` para mantener un instante bajo el ratón (`getAnchoredScrollLeft`) y para seguir al cursor (`getFollowScrollLeft`), y marcas del eje de tiempo (`getTimeTicks`). |
| `videomix/components/MixPlanView.tsx` | Carriles compartidos; contenedor con scroll horizontal y los carriles `zoom` veces más anchos; eje de tiempo (`TimeAxis`); botones − / + / Ajustar en la cabecera; Ctrl + rueda y rueda; seguimiento del cursor. `data-testid` nuevos: `mix-lane` (`data-columns`), `mix-lanes-scroller` (`data-zoom`), `mix-lanes`, `mix-time-axis`, `mix-cursor`, `mix-zoom-in/out/fit`; `data-selected` en los bloques. |
| `locales/en`, `locales/es` | `scan-i18n` + 4 textos ("Fit" → "Ajustar", "Zoom in/out (Ctrl + mouse wheel)", "Fit the whole mix in the view"). |
| `e2e/videomix.e2e.ts` | Escenario 22 (nuevo `describe`, antes del de la interfaz en español). |
| `04-diseno` §6.6 | Resumen de las filas compactas y del zoom. |

No se toca `App.tsx`: todo queda dentro de `MixPlanView`.

### Filas compactas (G3)

- **Tramo de una columna**: desde que entra en el layout hasta que termina su último clip. Una columna quitada por un re-layout sigue en pantalla mientras encoge (su último clip acaba con la animación), así que no comparte carril con la que entra en ese mismo re-layout.
- **Asignación**: por orden de inicio (y de `x` si empiezan a la vez), cada columna va a un carril libre (su tramo anterior ya ha terminado). Es el coloreado voraz de intervalos, que es óptimo: **número de carriles = máximo de columnas simultáneas**. Solo se abre un carril nuevo si no hay ninguno libre.
- **Orden arriba-abajo = izquierda-derecha "en lo posible"**: entre los carriles libres se elige el que queda entre los carriles de sus vecinos (izquierda/derecha, o arriba/abajo en filas) en su primer *keyframe*; si ninguno queda entre ellos, el más cercano; a igualdad, el de más arriba. Un carril nuevo se inserta en ese hueco (encima del vecino de abajo), así que nunca rompe el orden.
- **Límite**: una columna nunca cambia de carril y el número de carriles es el mínimo, así que a veces no se puede ordenar. Caso típico: la segunda columna sigue sola y se abren nuevas a su derecha; el único carril libre está encima. En 150 planes aleatorios reales el orden se cumple en ≈ 91 % de los *keyframes* (el test pide > 85 %). He probado a puntuar la elección con todos los *keyframes* de la columna (no solo el primero) y no mejora nada, así que lo he dejado simple.
- **Resto de la vista**: el relleno (rayado) se dibuja por columna dentro de su carril; el clic en un carril busca el clip entre las columnas del carril; arrastrar/fijar (A4), avisos, cadenas y secuencia no cambian (los bloques siguen siendo hijos directos de su carril, que usa el e2e 14).

### Zoom y scroll (A3)

- **Modelo**: `zoom` = ancho de los carriles / ancho visible; 1 = todo ajustado al ancho (por defecto). Los carriles, las pistas de elementos, las bandas de re-layout y el cursor siguen posicionados en % de la duración dentro de un contenedor `zoom × 100 %` de ancho con scroll horizontal, así que todo queda sincronizado sin cambiar el *hit testing* ni los arrastres (que ya usaban el ancho real de los carriles).
- **Límites**: de 1 a 2 s visibles como mucho (`getMaxMixZoom = duración / 2`). Los botones multiplican o dividen por 1,5.
- **Ctrl + rueda**: zoom centrado en el ratón (el instante bajo el ratón se mantiene). Los botones centran en el medio de la vista. **Rueda o Mayús + rueda**: scroll horizontal cuando hay zoom. **Sin zoom** (nada que desplazar en horizontal) la rueda hace lo de siempre: el scroll vertical de los carriles si hay muchos. Listener nativo no pasivo (los de React son pasivos y no pueden cancelar el scroll ni el zoom de Chromium).
- **Eje de tiempo** (nuevo; la vista no tenía): *sticky* encima de los carriles dentro del mismo contenedor, así que se desplaza con ellos. Paso de marcas el menor de 0,5 s, 1, 2, 5, 10, 15, 30 s, 1, 2, 5, 10, 15, 30 min, 1 h que deja ≥ 60 px entre etiquetas; solo dibuja las marcas visibles (con zoom puede medir cientos de miles de px) y escucha él mismo el scroll para no re-renderizar toda la vista al desplazarse. Un clic en el eje mueve el cursor, como en los carriles.
- **Seguir al cursor**: con zoom, cuando el cursor de la vista se sale de lo visible, la vista salta para dejarlo a un 10 % del borde izquierdo (como el timeline de la fuente). Reproducir la previsualización en vivo mueve ese cursor, así que la vista lo sigue.
- **No se guarda** en el proyecto: estado de sesión de `MixPlanView`.

### Decisiones (opción conservadora)

- **Seguimiento**: se sigue al cursor cada vez que cambia y queda fuera de la vista, no solo al reproducir (evita pasar a la vista el estado de reproducción desde `App.tsx`). Un clic en los carriles no lo dispara (el cursor ya está a la vista); desplazarse a mano con la vista en pausa tampoco (el cursor no cambia).
- **Rueda sin zoom**: se deja el comportamiento por defecto (scroll vertical) en vez de no hacer nada.
- **Zoom con los botones** centrado en el medio de la vista (no en el cursor).
- Sin atajos de teclado para el zoom (no los pide el requisito; T51 está tocando los atajos).

### Tests

- `mixPlanLayout.test.ts`: `getMixLanes` a mano (orden por `x`, carril compartido, columna que encoge ocupando su carril, elección entre carriles libres, carril nuevo insertado en su sitio, sin clips) y con el planificador real (150 proyectos en 16:9 y 9:16, 2–4 columnas): tantos carriles como columnas simultáneas, cada columna en un carril, sin solapes en un carril, más ids que carriles, orden > 85 %. `getPlacementAt` en un carril compartido.
- `mixPlanZoom.test.ts`: límites, rueda, anclaje, seguimiento y marcas.
- **e2e 22** (propio `describe`): tres fuentes (cuadrada, vertical y horizontal), un clip de cada una, se guarda y se reescribe el `.vmx` con 12 clips (2–6 s, `link: 'break'` para que no formen cadenas) que el planificador reparte en 6 ids de columna → la vista muestra **3 filas** (`[[0,2,5],[1],[3,4]]`; antes serían 6), sin solapes dentro de una fila, y un clic en un bloque de una fila compartida lo selecciona. Zoom con + (×2,25, centrado), rueda (scroll horizontal), Ctrl + rueda (zoom con el instante bajo el ratón fijo) y de vuelta, eje y carriles alineados, reproducción con zoom (la vista avanza y el cursor sigue visible) y Ajustar (vuelve a 1, sin scroll). Capturas `22a`–`22c` revisadas.
- Validación final, con T51 y T52 ya terminados y sin otros procesos: `yarn tsc`, `yarn lint`, `yarn test run` (96 ficheros, 1175 tests) y `yarn build` en verde.
- `yarn test-e2e`: 19 de 20 en verde, el 22 incluido (pasa en todas las ejecuciones). Falla el **8a** en las tres ejecuciones completas (con y sin compilar), y pasa en las dos con `-g "English UI"` (los mismos 12 escenarios, en el mismo orden). Es la medida de audio "lejos del keyframe" (`seekTo(0.7)`) que T52 ya documenta como frágil: con el plan nuevo el vertical suena solo en los últimos 1,5 s, y si la búsqueda de 7 s desde el keyframe tarda más, el vídeo termina sin sonar y la medida da 0 los 30 s. Esta tarea no toca la previsualización en vivo ni el audio (sin zoom, la vista Mix no hace nada nuevo al moverse el cursor), así que no lo he cambiado: es del ámbito de T52/T55 (p. ej. medir en un punto con más margen hasta el final).
- Durante la validación apareció una barra de scroll horizontal con zoom 1 cuando un elemento se sale del final del vídeo (escenario 6): los carriles recortan ahora lo que pasa del final (`overflow: hidden`), así que el área con scroll solo mide `zoom` × el ancho visible.

### Dudas

- **Orden de las filas**: con el mínimo de filas, a veces la columna de más a la izquierda no está arriba (≈ 9 % de los *keyframes*). Otra opción sería permitir una fila más que el máximo de columnas simultáneas cuando eso mantiene el orden. ¿Prefiere el usuario menos filas (lo implementado, lo que dice G3) u orden estricto?
- **Seguir al cursor**: implementado al salirse el cursor de la vista por cualquier motivo (reproducción, *seek* desde la previsualización, plan que lo recorta). Si se quiere solo durante la reproducción, hay que pasar `playing` a la vista.

## Revisión

## Revisión

- **Resultado**: aceptada (capturas 22a–22c). Dudas: se mantiene el mínimo de filas y el seguimiento del cursor siempre que sale de la vista.
- **Validación del orquestador**: tsc, lint, 1175 tests, e2e 24/24 dos veces.
