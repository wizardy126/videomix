# T56 · v6: modelo de bloques, plantillas y lógica pura

- **Hito**: M13 · **Modelo**: Opus · **Depende de**: — · **Estado**: en curso

## Objetivo

Modelo de datos y lógica pura de H1–H8, con contratos estables para la UI (T57) y exportar/importar (T58).

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§9 (overlays) y §14 (v6)**, [03-convenciones](../03-convenciones.md), [04-diseno](../04-diseno.md) (overlays, §1.2 modelo).
- `videomix/types.ts` (overlays, anclas `absolute | clip | element`, `linkedCountdownId`), `project.ts` (migraciones), `projectReducer.ts`, `overlayTimeline.ts`/`resolveOverlayTimes`, `overlayRemoval.ts`, `overlayStylePresets.ts` (formato de fichero exportado de B2 como precedente), y todos los consumidores de `project.overlays` (render `render/overlayFilters.ts`, audio, preview, vista Mix, validación).

## Especificación orientativa (decide y documenta)

- **Definición + instancia** (sugerido): `blockDefs` (contenido: overlays miembro con tiempos relativos al inicio del bloque, nombre, color) y `blocks` (instancias: `defId`, ancla, valores de variables, oculto, bloqueado, plegado). Un bloque normal es una definición con una sola instancia; las repeticiones (H5) comparten definición; "desvincular" clona la definición. Si eliges otra representación, justifícala.
- **Expansión pura**: una función convierte instancias en overlays concretos (ids deterministas por instancia, anclas internas y `linkedCountdownId` remapeados, variables sustituidas, ocultos excluidos) para que render, audio, preview y validación sigan trabajando con una lista de overlays sin enterarse de los bloques. Las anclas a un bloque/instancia (`element`) deben seguir funcionando.
- **Operaciones puras**: agrupar (hereda el ancla del primer overlay por tiempo; los tiempos quedan idénticos), desagrupar (idénticos), duplicar, desvincular, estirar (H6: escala tiempos y duraciones; fundidos y entradas fijos), repetir (H5: N cada X s, o anclado al inicio de cada clip), adaptar a otra proporción (H7), sustitución de variables `{{nombre}}` / `{{nombre|defecto}}` (H4).
- **Formato `.vmxblock`** (H2): serializar (JSON indentado, estricto) y parsear (JSON5, validación con zod con errores legibles: ruta del campo y motivo), con `format`, `version`, proporción de salida de origen, `originalStart`, tiempos relativos, anclas a clips convertidas a relativas con el nombre del clip como dato informativo, ficheros como rutas relativas al `.vmxblock`. **JSON Schema** generado o escrito a mano y comprobado en un test contra el esquema zod (p. ej. `docs/videomix/vmxblock.schema.json` o junto al código).
- **Modelo v7** con migración v6→v7 (aditiva, según la convención), validación (`validateMixProject`) de bloques y ciclos de anclas.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run` en verde; tests de cada operación (incluida la invariancia de tiempos al agrupar/desagrupar y la ida y vuelta exportar→importar), y que un proyecto sin bloques produce exactamente los mismos grafos de render que antes.
- Sección nueva en [04-diseno](../04-diseno.md) con el modelo y los contratos para T57/T58 en las notas.

## Notas de ejecución

## Revisión
