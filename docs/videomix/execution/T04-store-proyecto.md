# T04 · Store del proyecto y persistencia

- **Hito**: M1 · **Modelo**: Opus · **Depende de**: T03 · **Estado**: pendiente

## Objetivo

Crear el hook que mantiene el proyecto VideoMix en memoria, con undo/redo, y su persistencia en `.vmx`, incluido el autoguardado de recuperación.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §7
- [04-diseno](../04-diseno.md) §1, §6.2
- [02-as-built](../02-as-built.md) §4, §5 (`useStateWithHistory` en `useSegments`, `edlStore.ts` para la E/S con JSON5 y los diálogos de remote)
- [03-convenciones](../03-convenciones.md)

## Alcance

1. **`src/renderer/src/videomix/projectReducer.ts`** (puro): acciones tipadas sobre `MixProject`, testeables.
   - Fuentes: `addSources`, `removeSource` (que elimina también sus clips, con aviso gestionado en la UI), `relinkSource`.
   - Clips: `addClip`, `updateClip`, `removeClip`, `duplicateClip`, `reorderClips(ids)`.
   - Ajustes: `updateSettings`.
   - `setLoudnessCache`.
2. **`src/renderer/src/videomix/hooks/useMixProject.ts`**:
   - Estado: proyecto, `projectPath`, `dirty`, `undo`, `redo`, `canUndo` y `canRedo` (historial acotado, p. ej. 100).
   - Las ediciones continuas, como arrastrar un rectángulo, deben poder agruparse en un solo paso de historial. Para ello, el hook expone un `commit` o un modo *transient*; el diseño se documenta aquí.
3. **`src/renderer/src/videomix/projectFile.ts`**:
   - `saveMixProject(path, project)`: JSON5 con indentación. Convierte las rutas de las fuentes y de la música a relativas respecto al `.vmx` y mantiene `absolutePath`.
   - `loadMixProject(path)`: resuelve las rutas (relativa → absoluta) e informa de las fuentes que faltan.
   - La lógica de rutas va separada en funciones puras con tests (usar `node:path` vía `window.require` solo en el borde, como hace `edlStore.ts`, o pasar el módulo `path` como parámetro para poder testear).
4. **Recuperación**:
   - Autoguardado con debounce (1–2 s) del proyecto no guardado o sucio en `<userData>/videomix-recovery/`, un fichero por sesión o proyecto.
   - Al guardar explícitamente se limpia.
   - `findRecoverableProjects()` para que T05 ofrezca recuperar al arrancar.
   - Para obtener `userData`, reutiliza un mecanismo existente o añade una función mínima en main (`remoteApi`).
5. **Acciones de usuario** (sin UI todavía; las enganchará T05): `userNewProject`, `userOpenProject`, `userSaveProject` y `userSaveProjectAs`, con los diálogos de remote (patrón `edlStore.ts`, filtro `*.vmx`) y confirmación si hay cambios sin guardar.

## Fuera de alcance

- Montar el hook en `App.tsx`, los paneles y los menús (T05).

## Criterios de aceptación

- Tests del reducer, de la conversión de rutas y del *round-trip* guardar → cargar (sin disco o con `tmpdir`).
- El undo/redo y la agrupación de ediciones continuas están documentados.
- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

## Revisión
