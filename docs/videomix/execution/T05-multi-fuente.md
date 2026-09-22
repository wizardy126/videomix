# T05 · Integración multi-fuente en la app

- **Hito**: M2 · **Modelo**: Opus · **Depende de**: T04 · **Estado**: pendiente

## Objetivo

Que la app trabaje con un **proyecto VideoMix de varias fuentes**:
- panel izquierdo de fuentes;
- activar una fuente la carga en el player/timeline sin perder el proyecto;
- menú y atajos de proyecto.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §3 (P1, P2), §7
- [04-diseno](../04-diseno.md) §6.1, §6.2, §7
- [02-as-built](../02-as-built.md) §2 (menú e IPC), §4 (`loadMedia`, `resetState`, `userOpenFiles`, batch), §5 (autosave `.llc`)
- [03-convenciones](../03-convenciones.md) §5: cambios mínimos en `App.tsx`

## Alcance

1. **`useMixProject`** (T04) montado en `App.tsx` de forma que **no** lo borre `resetState()`, y expuesto a los componentes (prop o contexto nuevo `MixProjectContext`).
2. **Modo VideoMix** (la app funciona siempre así):
   - `loadMedia` no busca ni carga `.llc`, no importa capítulos como segmentos y no dispara `useSegmentsAutoSave`;
   - `userOpenFiles`: los vídeos soltados o abiertos se **añaden como fuentes** al proyecto (sin preguntar la acción de apertura), un `.vmx` abre el proyecto y un fichero de audio se ofrece como música del proyecto;
   - que sea con cambios pequeños y localizados (un flag o parámetro), comentando el *por qué*.
3. **`videomix/components/SourceList.tsx`** (panel izquierdo; sustituye a `BatchFilesList` en el layout):
   - lista de fuentes con nombre, duración y número de clips;
   - fuente activa resaltada; clic para activar (`loadMedia` de su ruta);
   - quitar la fuente, con confirmación si tiene clips;
   - botón para añadir;
   - aviso de fuente no encontrada con acción "Localizar…" (`relinkSource`).
4. **Menú (main, `menu.ts`)**: "Project" con New, Open…, Save, Save As… y Add videos…, y los canales IPC correspondientes en `App.tsx` (`mainActions` / `allActions`).
   - Las nuevas `KeyboardAction` van en `src/common/types.ts`, con atajos por defecto razonables en `configStore.ts`: Ctrl/Cmd+S guardar y Ctrl/Cmd+Shift+S guardar como, **comprobando conflictos** con los atajos existentes.
5. **Título de la ventana**: nombre del proyecto más un `*` si hay cambios sin guardar.
6. **Cierre**: si hay cambios sin guardar, confirmar (reutiliza el mecanismo `askBeforeClose` / `setAskBeforeClose`).
7. **Recuperación al arrancar**: si `findRecoverableProjects()` devuelve algo, se ofrece restaurarlo.
8. **Fuente activa**:
   - Se mantiene `currentSourceId` en el estado de VideoMix.
   - Al cambiar de fuente, el timeline muestra los segmentos que T07 sincronizará. Mientras tanto, déjalo vacío o con un placeholder.

## Fuera de alcance

- Clips, overlay y lista de clips (T06, T07).
- Eliminar la UI heredada (T16). En esta tarea solo se **sustituye** `BatchFilesList` en el layout.

## Criterios de aceptación

- Se pueden añadir 3 fuentes y cambiar entre ellas; el player carga cada una y el proyecto se conserva.
- Guardar, cerrar y abrir el `.vmx` restaura las fuentes.
- No se crean ficheros `*-proj.llc`.
- `yarn tsc && yarn lint && yarn test run` en verde.
- Las notas de ejecución incluyen **instrucciones de prueba manual** para el usuario.

## Notas de ejecución

## Revisión
