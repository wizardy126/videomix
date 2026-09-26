# T58 · v6: exportar, importar y biblioteca de plantillas (H2, H3, H4, H7)

- **Hito**: M13 · **Modelo**: Opus · **Depende de**: T56 · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§9 (overlays) y §14 (v6)**, [03-convenciones](../03-convenciones.md), [04-diseno](../04-diseno.md) (overlays, §1.2 modelo).
- Notas de T56 (formato `.vmxblock`, JSON Schema, operaciones), T26 (exportar/importar presets de estilo: patrón de diálogos y ficheros), T42 (ficheros de la app), `projectFile.ts` (rutas relativas).

## Alcance

1. **Exportar** un bloque o la **selección** de overlays sueltos a `.vmxblock`, con casilla **"Incluir ficheros"** (copia PNG, sonidos y fuentes a una carpeta junto al `.vmxblock`, rutas relativas).
2. **Importar** con diálogo: vista previa (overlays, duración), colocación (**tiempos originales**, **desplazar ± s**, **en el cursor**, **anclado a un clip** inicio/fin + desfase), **variables** (formulario con los `{{nombre}}` encontrados y sus valores por defecto), **Adaptar** a la proporción si es distinta (H7, marcado por defecto), importar como bloque o desagrupado. Ficheros que faltan → localizarlos. Errores de validación mostrados con campo y motivo, sin importar a medias. Un paso de deshacer.
3. **Biblioteca** (H3): carpeta global de la app (en userData, o configurable), "Guardar en la biblioteca", menú **"Insertar bloque"** con nombre, duración y miniatura (fotograma central renderizado con ffmpeg o dibujado con el motor de la previsualización; decide), "Abrir carpeta de la biblioteca".
4. Menús y atajos donde encaje; i18n (en + es); e2e con un `.vmxblock` editado a mano (comentarios JSON5) y con ficheros incluidos.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

### Resumen de cambios

| Fichero | Cambio |
|---|---|
| `videomix/blocks/blockTemplateFiles.ts` (nuevo, puro) | Escribir un `.vmxblock` (con "Incluir ficheros": copia a `<nombre>_files/`), leerlo (rutas relativas a él), ficheros que faltan y "Localizar...", biblioteca (carpeta, nombres únicos, listado), `getTemplateSelection`. |
| `videomix/blocks/blockPreview.ts` (nuevo) | Fotograma central de una plantilla con el dibujo de overlays de la previsualización en vivo: `getTemplatePreviewOps` (puro) y `renderTemplatePreview` (canvas → PNG). |
| `videomix/components/BlockTemplateDialogs.tsx` (nuevo) | Diálogos de exportar (nombre, "Incluir ficheros"), importar (vista previa, colocación, variables, Adaptar, desagrupado, ficheros que faltan) y biblioteca ("Insertar bloque", con miniaturas). |
| `videomix/components/BlockTemplateButtons.tsx` (nuevo) | Botones "Insertar bloque…" e "Importar bloque…" de la barra de la vista Mix. |
| `videomix/hooks/useBlockTemplates.ts` (nuevo) | Flujos de usuario: exportar, guardar en la biblioteca, importar, insertar desde la biblioteca, abrir su carpeta. |
| `App.tsx` | Monta `useBlockTemplates` (con la selección de T57: `selectedBlockIds` / `selectedLooseOverlayIds`), 5 acciones en `mainActions` y la prop `blockTemplates` de `MixPlanView`. |
| `MixPlanView.tsx` | Prop opcional `blockTemplates` y una línea en la barra (`BlockTemplateButtons`). |
| `common/types.ts`, `KeyboardShortcuts.tsx` | Acciones `importBlock`, `exportBlock`, `saveBlockToLibrary`, `insertBlockFromLibrary`, `openBlockLibraryFolder` (sin tecla por defecto). |
| `main/menu.ts` | Proyecto → **Plantillas de bloques**: Insertar bloque..., Importar bloque..., Exportar bloque..., Guardar bloque en la biblioteca..., Abrir carpeta de la biblioteca. |
| `locales/{en,es}` | Textos nuevos (en con `scan-i18n`, es a mano). |
| Tests | `blocks/blockTemplateFiles.test.ts` (10): nombres, rutas con y sin ficheros, escribir → mover → leer → colocar, fichero a incluir que falta (no se escribe nada), localizar, `.vmxblock` a mano con comentarios y uno roto, biblioteca, selección, miniatura (fotograma central, variables, adaptar). e2e **25**. |
| Docs | `04-diseno` §11.7. |

### Decisiones (conservadoras)

1. **Miniatura**: dibujada con el motor de la previsualización (no ffmpeg): instantánea, sin vídeo, sin caché en disco, igual a lo que se ve en la previsualización en vivo. Fondo gris neutro, fotograma central = mitad de la duración (sin la cola de los sonidos). Se genera al abrir el diálogo.
2. **Biblioteca**: carpeta fija `userData/block-library`, sin ajuste para cambiarla (el requisito dejaba elegir; un ajuste más es más superficie). "Guardar en la biblioteca" guarda **siempre con sus ficheros**, para que la biblioteca no se rompa al mover o borrar los originales.
3. **Exportar**: "Incluir ficheros" desmarcada por defecto (no se copian ficheros sin pedirlo). Solo se exporta **un bloque** o **overlays sueltos** (varios bloques o mezcla → aviso; no hay bloques anidados). Si falta un fichero a incluir, no se escribe nada y se dice cuál. No se escribe `$schema`.
4. **Importar**: colocación por defecto "tiempos originales" (al importar de un fichero) y "en el cursor" (al insertar de la biblioteca). Si el `.vmxblock` estaba anclado a un clip, se preselecciona en "Anclado a un clip" el clip del proyecto con el mismo nombre (sin marcar esa opción). **Ficheros que faltan**: hay que localizarlos para poder importar (el botón queda desactivado); así no entra en el proyecto un bloque con ficheros rotos. La vista previa se dibuja sin ellos.
5. **Errores**: el diálogo de error de la app con "El fichero del bloque tiene errores; no se ha importado nada:" y una línea por problema (`campo: motivo`). Zod solo comprueba las referencias entre miembros si la forma es válida, así que un fichero puede mostrar sus errores en dos tandas.
6. **Atajos**: las 5 acciones se pueden asignar en "Atajos de teclado", sin tecla por defecto (no hay combinaciones libres evidentes y son acciones poco frecuentes).

### Para el orquestador / T59

- **Z-index de la vista Mix**: el eje de tiempos pegajoso de `MixPlanView` (`zIndex: 2`, T53) se dibuja **por encima de los diálogos** (se ve en la captura `25-block-import`: el eje cruza la parte baja del diálogo de importar). Afecta a cualquier diálogo alto; no lo he tocado (fichero de T57). Arreglo probable: `isolation: 'isolate'` en el contenedor de los carriles.
- Manual de usuario: pendiente (T59).
- La exportación de un **bloque** desde la interfaz depende de la selección de T57 (`selectedBlockIds`); el e2e 25 prueba "Exportar selección" con un overlay suelto y la importación como bloque.

### Validación

- `yarn tsc`, `yarn test run` (101 ficheros, 1234 tests) y `yarn build` en verde. `yarn lint` en verde (en una pasada intermedia hubo un error en `blocks/blockUi.test.ts`, de T57, ya corregido).
- `yarn test-e2e`: **27/27** en verde en la última pasada completa (incluido el 24 de T57); el e2e 25 revisado en capturas (`25-block-import`, `25-block-errors`, `25-block-export`, `25-block-library`). En una pasada completa falló una vez el 12 (T35b, recuento de clips), que pasa al repetirlo: carga del equipo / trabajo en paralelo de T57.

## Revisión

- **Resultado**: aceptada. Validación del orquestador (T57 + T58 juntas): tsc, lint, 1234 tests, e2e 27/27 dos veces.
