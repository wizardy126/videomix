# ADR-002 · Sincronización clips ↔ segmentos

- **Tarea**: T07 · **Estado**: aceptada

## Contexto

- En VideoMix la fuente de verdad es `MixProject.clips` (T04): los clips de **todas** las fuentes, con su historial de undo/redo, su guardado en `.vmx` y su recuperación.
- El player y el timeline heredados de LosslessCut trabajan con **un solo fichero** y con sus propios segmentos (`useSegments`: `cutSegments`, con su historial de `react-use`). `resetState()` los borra al cambiar de fichero.
- El timeline aporta mucho que no queremos reescribir: arrastrar los puntos de corte, "Marcar inicio/fin" (I/O), etiquetar, saltar entre segmentos, reproducir solo el segmento, etc.
- Requisitos de T07:
  - editar inicio/fin en el timeline actualiza el clip;
  - los segmentos sin `end` (marcadores) no son clips;
  - undo/redo coherente (decisión del orquestador: los atajos apuntan al historial del proyecto, que incluye fuentes y clips);
  - cambiar de fuente no pierde nada.

## Opciones evaluadas

1. **Sincronización bidireccional** (la recomendada en 04-diseno §6.3): el timeline muestra los clips de la fuente activa como segmentos (`segId = clip.id`); los cambios del timeline se traducen a acciones del proyecto y los cambios del proyecto (undo/redo, lista de clips) se reescriben en el timeline.
   - A favor: se reutilizan todas las operaciones de segmentos de LosslessCut sin tocarlas.
   - En contra: hay que evitar bucles y decidir quién ha cambiado qué.
2. **Segmentos derivados de solo lectura**: el timeline pinta los clips y todas las ediciones pasan por acciones del proyecto.
   - A favor: un único sentido de datos.
   - En contra: habría que reimplementar o interceptar cada operación de `useSegments` que usa el timeline (arrastre de cortes, I/O, dividir, etiquetar, borrar punto de corte…), tocando mucho código heredado.

## Decisión

**Opción 1**, con la lógica de decisión en funciones puras (`videomix/clipSegments.ts`, con tests) y el efecto que la aplica en `videomix/hooks/useMixClips.ts`.

### Correspondencia

| Proyecto | Timeline |
|---|---|
| clip de la fuente activa | segmento con `segId = clip.id`, `start`, `end`, `name = clip.name`, `segColorIndex = clip.color` |
| orden de la lista | orden de los segmentos (los clips de la fuente, en el orden de la lista, y después los marcadores) |
| — | marcador (segmento sin `end`): **no es un clip**; solo vive en el timeline mientras la fuente está activa |

- **Todo segmento con `end` es un clip.** No hay segmentos "borrador": si hubiera segmentos que no son clips, se perderían al cambiar de fuente. Por eso en VideoMix no se crea el segmento *placeholder* de todo el fichero de LosslessCut (`maybeCreateFullLengthSegment`).
- El color del segmento es el del clip, así que el timeline y la lista de clips coinciden.
- El check "seleccionado" de LosslessCut se conserva por segmento, pero no es dato del proyecto.

### Algoritmo (`getSyncStep`)

Se ejecuta en un efecto cada vez que cambian los segmentos, los clips o la fuente activa. Se recuerdan los segmentos vistos la última vez para saber qué ha cambiado:

1. **Fuente recién cargada** (`loadMedia` acaba de dejar el timeline vacío): se escriben sus clips como segmentos.
2. **Han cambiado los segmentos** (edición del usuario en el timeline) → acciones del proyecto, en una acción `batch`:
   - segmento de un clip con otro inicio/fin/nombre → `updateClip` (un nombre vacío no borra el del clip);
   - clip cuyo segmento ha desaparecido o se ha convertido en marcador (p. ej. "Quitar punto de corte") → `removeClip`;
   - segmento nuevo con `end` (I/O sobre un marcador, generadores de segmentos…) → `addClip` con el **mismo id**, nombre por defecto `<fuente> #n`, el siguiente color y el fotograma completo como máx. Se añade al final de la lista. Si no se conoce el tamaño del vídeo (fuente sin vídeo), no se crea.
3. **Si no**, si el timeline no muestra exactamente los clips del proyecto (undo/redo, edición en la lista, reordenar, cambiar color o nombre, añadir/duplicar/borrar desde la lista…), se **reescribe** el timeline y se conserva el segmento actual por id.

Tras aplicar las acciones del paso 2, el siguiente paso encuentra ambos lados sincronizados (o solo difiere el orden o el color de un clip nuevo, y reescribe una vez). No hay bucles: cada paso o no hace nada o hace que el siguiente no haga nada (hay un test de ida y vuelta).

Para escribir en el timeline se usa el *setter* crudo de `useSegments` (`setCutSegments`, ahora exportado): `safeSetCutSegments` convertiría en marcador un clip con tiempos inválidos y el paso 2 lo borraría.

### Undo/redo

- En modo VideoMix, las acciones `undo`/`redo` (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) llaman al historial del proyecto (`useMixProject`). El historial de segmentos de LosslessCut queda sin uso.
- **Ediciones del timeline**: cada cambio del timeline es un paso del historial del proyecto, con estas agrupaciones:
  - si solo cambian inicio/fin de **un** clip (arrastrar un punto de corte, I/O), se aplica como edición *transient* bajo la clave `times:<clipId>` y se confirma como **un solo paso** al soltar el puntero (con 100 ms de margen para que llegue el último `mousemove`), al empezar otra edición, o tras 0,7 s sin cambios si no hay botón pulsado;
  - el resto (crear, borrar, renombrar) es un paso por cambio.
- **Rectángulos (overlay)**: el arrastre es *transient* y se confirma al soltar (un paso). Las pulsaciones de flechas seguidas sobre el mismo clip se agrupan en un paso (clave `rects:<clipId>`; se confirma tras 1 s sin pulsaciones o al hacer otra cosa). Para distinguirlas, `RectOverlay.onCommit` recibe `{ keyboard: true }`.
- **Lista de clips** (nombre, color, mute, ganancia, reordenar, duplicar, eliminar) y **fuentes** (añadir, quitar, localizar): un paso por acción.
- Deshacer una acción que deja el fichero del player fuera del proyecto (p. ej. "Añadir vídeos") descarga el player.
- **Los marcadores no están en el proyecto**: no se deshacen y se pierden al cambiar de fuente. Deshacer la creación de un clip hecha desde un marcador quita el segmento (no vuelve a dejar el marcador).

### Otras decisiones

- **Clip seleccionado** = el segmento actual del timeline si es un clip de la fuente activa. No hay estado aparte, así que la lista, el timeline y el overlay no pueden discrepar. Al seleccionar en la lista un clip de otra fuente, se activa la fuente, se escriben sus segmentos, se marca el clip como actual y, cuando el vídeo tiene duración, se hace *seek* a su inicio.
- **"Add clip"** (botón `+` de la lista y atajo `N`): si el segmento actual es un marcador anterior al cabezal, el clip va del marcador al cabezal (el marcador se convierte en el clip); si no, un clip de 5 s desde el cabezal (retrocede si no cabe antes del final).
- **Dividir** (`B`): en VideoMix divide el clip bajo el cursor en dos clips que conservan rectángulos, mute y ganancia (una acción `batch`). El dividir de LosslessCut crea segmentos nuevos y perdería esos datos.
- **Nombres**: `<fuente sin extensión> #n` con `n` = máximo usado con ese prefijo + 1 en todo el proyecto (no se reutilizan números mientras haya uno mayor). Duplicar da el siguiente número del mismo prefijo ("Intro" → "Intro #2").
- **Color**: el menos usado de la paleta de segmentos (19 colores); en empate, el de menor índice.
- **Rotación manual de LosslessCut**: desactivada en VideoMix (decisión del orquestador). Los rectángulos están en el espacio de la fuente orientada que decodifica el render; una rotación de previsualización haría que no coincidieran.

## Consecuencias

- Las operaciones de segmentos heredadas siguen funcionando y se reflejan en el proyecto. Las que crean segmentos nuevos (detectar escenas, generar N segmentos, duplicar segmento…) crean clips con los rectángulos por defecto.
- Cualquier código nuevo que edite clips debe hacerlo **en el proyecto** (`useMixProject`/`useMixClips`), nunca escribiendo segmentos: el timeline se actualiza solo.
- El historial de `useSegments` y su tope de 100 pasos no se usan en VideoMix; el del proyecto tiene el suyo (100 pasos).
- La agrupación de ediciones depende de temporizadores (0,7 s / 1 s) y de los eventos de puntero de `window`: una pausa larga sin soltar el ratón no parte el arrastre; dos arrastres del mismo clip separados por menos de 100 ms podrían quedar en un solo paso.
- T15 (timeline del montaje) y T16 (limpieza) pueden retirar la UI de segmentos que no aplica (exportar, invertir, etiquetas…) sin tocar esta sincronización.
