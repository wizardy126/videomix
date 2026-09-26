# T59 · v6: manual, i18n y cierre

- **Hito**: M13 · **Modelo**: Sonnet · **Depende de**: T56–T58 · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§9 (overlays) y §14 (v6)**, [03-convenciones](../03-convenciones.md), [04-diseno](../04-diseno.md) (overlays, §1.2 modelo).

## Alcance

1. **Auditoría real del manual** contra §14 y la UI (textos de `locales/es`, atajos de `configStore.ts`): bloques, repetir, estirar, ocultar/bloquear, variables, exportar/importar, biblioteca, adaptar proporción; y una **guía del formato `.vmxblock`** para editarlo a mano (ejemplo comentado, referencia al JSON Schema).
2. Ejemplos: una o dos plantillas `.vmxblock` de muestra en `docs/videomix/ejemplos/` (p. ej. "rótulo de ejercicio" con variables y "descanso" con contador + barra).
3. **Pequeños pendientes**: botón "Exportar selección" en el panel de selección múltiple (hoy solo desde el menú Proyecto → Plantillas de bloque); estabilizar el e2e 21 (lee la posición del *slider* de CRF mientras el diálogo de ajustes aún se abre: esperar a que esté abierto y estable).
4. `07-propuestas.md` (H1–H8 → ✅), revisión del español.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

### Auditoría real del manual (contra §14 y la UI)

`docs/videomix/manual-usuario.md` **no tenía ninguna sección de bloques ni plantillas**: T57 y T58 dejaron ambas nota "Manual de usuario: pendiente (T59)" y así estaba, a pesar de que sus propias tareas ya se habían dado por "hechas". Se ha revisado punto por punto contra 01-requisitos §14 (H1–H8) y la UI real (`locales/es/translation.json`, `src/main/menu.ts`, `BlockPanel.tsx`, `OverlaySelectionPanel.tsx`, `BlockDialogs.tsx`, `BlockTemplateDialogs.tsx`, `BlockTemplateButtons.tsx`) y se ha escrito la sección nueva **"8. Bloques de overlays y plantillas"** (renumerando 8→9 Previsualizar y renderizar, 9→10 Atajos, 10→11 Otros ajustes, y las referencias internas `§8`/`§8.1` que apuntaban a ellas), con:

- selección múltiple (Ctrl/Cmd+clic, Mayús+clic) y "Agrupar en bloque" (herencia de ancla, tiempos idénticos);
- el carril "Bloques" de la vista Montaje y el panel del bloque (nombre/color, enlazado + Desvincular, Oculto, Bloqueado, Duplicar/Repetir/Duración del bloque/Desagrupar/Borrar, capas, avisos, ancla, duración, variables, lista de miembros con "Volver al bloque"/"Quitar del bloque");
- Repetir (N veces cada X s / al inicio de cada clip seleccionado) y Estirar (Duración del bloque…);
- Ocultar y Bloquear (con las restricciones exactas: contenido compartido bloqueado si cualquier copia enlazada lo está);
- variables `{{nombre}}` / `{{nombre|valor}}` y el aviso de una sin valor ni defecto;
- exportar (bloque, o selección de overlays sueltos con "Exportar selección…"), importar (colocación, variables, Adaptar, importar desagrupado, ficheros que faltan, errores) y la biblioteca (Insertar bloque, Guardar en la biblioteca, Abrir carpeta), con la tabla del menú **Proyecto → Plantillas de bloques** contrastada literalmente contra `menu.ts` y sus traducciones en `locales/es`.

Cada frase de la sección nueva se ha comprobado contra el texto i18n real (claves en inglés y su traducción en `locales/es/translation.json`) o el código correspondiente; no queda ninguna a falta de contrastar. También se ha revisado el resto del manual (secciones 1–7 y 9–11) sin encontrar discrepancias nuevas de esta ronda.

### Guía del formato `.vmxblock` (H2) y ejemplos

- `docs/videomix/guia-vmxblock.md` (nuevo): estructura del fichero, tabla de campos obligatorios/opcionales por tipo de miembro, anclas relativas al bloque (`absolute`/`element`, sin anclas a clip), variables, qué decide quien importa (no está en el fichero) y cómo se reportan los errores de validación; enlaza el JSON Schema (`vmxblock.schema.json`) y explica el uso de `$schema` para autocompletar en el editor.
- `docs/videomix/ejemplos/rotulo-ejercicio.vmxblock` (dos textos con variables `{{exercise|Sentadillas}}` y `{{reps}}`, uno anclado al otro) y `docs/videomix/ejemplos/descanso.vmxblock` (cuenta atrás + barra vinculada + texto + pitido anclado a su fin), ambos comentados a mano (JSON5).
- `src/renderer/src/videomix/blocks/vmxBlockExamples.test.ts` (nuevo, 2 tests): carga los dos ficheros con `parseVmxBlockFile` (sin comprobar la existencia real de los ficheros de sonido, que es responsabilidad de quien llama, como documenta `vmxBlockFile.ts`) y los instancia con `instantiateVmxBlock` (incluida una adaptación a otra proporción), comprobando variables, anclas internas y duración. Así, si el analizador real deja de aceptar algo de la guía, el test lo detecta.
- `docs/videomix/README.md`: entradas nuevas en el índice (`guia-vmxblock.md`, `vmxblock.schema.json`, `ejemplos/`) y dos términos de glosario (Bloque, Plantilla `.vmxblock`).

### Pequeños pendientes

- **Botón "Exportar selección" en el panel de selección múltiple**: antes solo estaba disponible desde el menú Proyecto → Plantillas de bloque. Añadido en `MultiSelectionPanel` (`OverlaySelectionPanel.tsx`), junto a "Agrupar en bloque" y "Borrar", con la misma condición de habilitado (solo overlays sueltos seleccionados, ningún bloque) y llamando a `blockTemplates.userExportBlock({ overlayIds: selectedLooseOverlayIds })` (el hook ya soportaba un `sel` explícito). `App.tsx` pasa `mixBlockTemplates` a `OverlaySelectionPanel`, que lo reenvía al panel de selección múltiple. Claves i18n nuevas: `Export selection…` / `Exportar selección…` y el texto del tooltip deshabilitado.
- **Estabilizar el e2e 21**: el fallo intermitente descrito en las notas de T57 (`crfLabel.locator('input[type="range"]').boundingBox()` leído mientras el diálogo de Ajustes aún se estaba animando: `Dialog.module.css` anima `contentShow` 150 ms con `scale`+`translate`, así que el `boundingBox` podía leerse a mitad de esa transformación y el arrastre del *slider* caía en el punto equivocado). Arreglado esperando a que las animaciones del diálogo hayan terminado (`await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))`) antes de leer el `boundingBox` del *slider*, justo después de `await expect(dialog).toBeVisible()`.

### `07-propuestas.md` y revisión del español

- H1–H8 marcadas ✅ (T56–T59) en la fila de v6 del catálogo de propuestas.
- Revisión del español de la sección nueva del manual y de la guía `.vmxblock`; no se ha encontrado ningún error en las traducciones ya existentes de T56–T58 (`locales/es/translation.json`) al escribir la sección del manual sobre ellas.
- Se ha corregido el orden alfabético local de las dos claves nuevas en `locales/es/translation.json` (el fichero no es un `sort()` global como el inglés, pero sí bloques localmente alfabéticos por tarea; `Only loose overlays can be exported...` se ha movido junto a `Only loose overlays can be grouped...`/`Offset (s)`, en vez de quedar entre `Export selection…` y `Failed to export the block`).

### Validación

- `yarn tsc`, `yarn lint` y `yarn test run` (104 ficheros, 1240 tests, incluidos los 2 nuevos de `vmxBlockExamples.test.ts`) en verde.
- `yarn build` en verde.
- `yarn test-e2e`: **27/27** en verde, dos pasadas completas (comprobando en particular que el 21 ya no es intermitente y que 24/25 siguen en verde).

### Dudas

- Ninguna nueva para el usuario: las decisiones pendientes de T56–T58 (posición de capas al intercalar overlays sueltos y miembros, carpeta configurable de la biblioteca) quedaron ya resueltas de forma conservadora en esas tareas y no se han revisitado aquí.

## Revisión

- **Resultado**: aceptada. M13 cerrado.
- **Validación del orquestador**: tsc, lint, 1236 tests, e2e 27/27.
