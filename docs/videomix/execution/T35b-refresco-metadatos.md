# T35b · v3: refrescar metadatos (tamaño + SAR) al abrir y antes de renderizar

- **Hito**: M9 · **Modelo**: Sonnet · **Depende de**: T35 · **Estado**: hecha

## Objetivo

Desbloquear a un usuario con un proyecto anterior a T35 cuya fuente anamórfica (1280×720, SAR 679:640) sigue fallando la validación del render con `max-rect-outside-frame`, porque desde T35 el tamaño de visualización + SAR (`MixSource.width`/`height`/`sar`) solo se refresca con ffprobe al **activar** la fuente en el reproductor (`useMixWorkspace` → `setSourceMeta`). Si esa fuente no se reactiva en la sesión (habitual: al abrir un proyecto con varias fuentes solo se activa la primera), la caché del `.vmx` sigue con el tamaño codificado antiguo y la validación falla aunque el encuadre del editor sea correcto.

Es el punto 5 pendiente de T35, listado en [T39](T39-v3-ui-cadenas-render.md).

## Contexto (leer antes de empezar)

- [T35-v3-bug-sar.md](T35-v3-bug-sar.md): `getSourceMeta` (`workspace.ts`) devuelve tamaño de visualización + SAR; `sourceResize.ts` (`getSourceFrameChange`) decide si hay que reescalar los rectángulos de los clips al cambiar el tamaño de una fuente, con dos casos que **no** reescalan: la migración implícita B1 (fuente sin SAR cuya talla guardada es el tamaño codificado de la nueva meta — el caso real del usuario) y la primera vez que se conoce el tamaño.
- [T39-v3-ui-cadenas-render.md](T39-v3-ui-cadenas-render.md) punto 5.
- [03-convenciones](../03-convenciones.md).

## Alcance

1. **Al abrir/recuperar un proyecto**: refrescar en segundo plano, con ffprobe, la meta de todas las fuentes cuyo fichero existe, con concurrencia limitada.
2. **Antes de validar/renderizar** (`useMixRender`, `prepare`): refrescar, con `await`, la meta de las fuentes realmente usadas (las de al menos un clip), para que la validación y el render usen el tamaño correcto aunque no se haya refrescado en segundo plano todavía.
3. Mantener la regla de no reescalar de T35 (`sourceResize.ts`).
4. Aplicar el refresco como caché (sin paso de undo, sin marcar el proyecto como no guardado), igual que `setSourceMeta`.

## Fuera de alcance

- Cualquier cambio en `planner/**`, `render/renderTimeline.ts`, `render/buildVideoGraph.ts`, `preview/**` o `ClipList` (en curso en T38b).
- Tocar la regla de reescalado en sí (`sourceResize.ts`), ya correcta desde T35.

## Notas de ejecución

### Diagnóstico confirmado

El efecto de `useMixWorkspace` que mantiene al día la caché de la fuente activa solo se dispara para la fuente cargada en el reproductor. `useMixRender`'s `prepare()` validaba `project` (el snapshot de React que llega por parámetro del hook), así que aunque se refrescara la caché a mitad de `prepare()`, esa misma llamada no lo vería sin esperar a un nuevo render.

### Cambios

- **`workspace.ts`** (puro, sin Electron/React):
  - `refreshSourcesMeta(sources, { pathExists, probe }, onMeta, { concurrency })`: con `p-map`, prueba cada fuente cuyo fichero existe (`pathExists`), calcula su meta con `getSourceMeta` (a partir de `probe`, p. ej. `readFileFfprobeMeta`) y llama a `onMeta(source, meta)` solo si `isSourceMetaChanged`. Un fichero que falta o un `probe` que lanza se saltan (solo se registran con `console.warn`), así una fuente rota no bloquea el resto. Las dependencias se inyectan (como `loudness.ts`), así queda testeable en Node.
  - `getUsedSources(sources, clips)`: las fuentes referenciadas por al menos un clip (para renderizar solo hace falta refrescar estas).
- **`useMixProject.ts`**: nuevo `getProject()`, que lee `historyRef.current.present` (la ref, no el snapshot `project`). Como `setHistory` actualiza esa ref de forma síncrona, `getProject()` está al día justo después de una actualización de la misma tanda (p. ej. `setSourceMeta`), sin esperar al siguiente render. Se expone en el objeto que devuelve el hook.
- **`useMixWorkspace.ts`**:
  - `applyRefreshedSourceMeta(source, meta)` agrupa lo que ya hacía el efecto de la fuente activa (aviso de cambio de proporción con clips, T35 B2, y `setSourceMeta`); ahora lo reutilizan tanto ese efecto como el refresco en segundo plano.
  - `handleProjectReplaced` (abrir, recuperar o nuevo proyecto) lanza `refreshSourcesMeta` sobre las fuentes sin fichero ausente, sin esperar (`.catch` solo registra el fallo): no bloquea la apertura ni la activación de la primera fuente, que sigue ocurriendo igual.
- **`useMixRender.ts`** (`prepare`):
  - Antes de validar, `await refreshSourcesMeta(getUsedSources(project.sources, project.clips), …, (source, meta) => setSourceMeta(source.id, meta))` y después `getProject()` para trabajar con el proyecto ya al día (validación, `planRender`, avisos de tiempos de overlay…), en vez del `project` que llega por parámetros del hook.
  - `render()` (la fase de render en sí) también lee `getProject()` al entrar, en vez de cerrar sobre el `project` que tenía en el momento en que se creó ese *callback* (que podía ser anterior al refresco que `prepare()` acaba de hacer): así el render usa los mismos tamaños/SAR que la validación, y los rectángulos de los clips ya reescalados si `sourceResize.ts` lo pidió.
- No hace falta duplicar la lógica de reescalado de T35 (B2): al pasar por `setSourceMeta` → `relinkSource` (`projectReducer.ts`), el reescalado (o su ausencia, según las reglas de `sourceResize.ts`) ya se aplica solo.

### Tests

- **Unitarios** (`workspace.test.ts`): `getUsedSources` (solo las fuentes con clips, sin duplicar, orden de la lista de fuentes) y `refreshSourcesMeta` (solo prueba las fuentes cuyo fichero existe; `onMeta` solo con un cambio real; un fallo de `probe` no detiene las demás fuentes; respeta `concurrency`).
- **e2e** (nuevo escenario 12, `videomix.e2e.ts`): crea un proyecto con una fuente normal (se activa primero al abrir) y la fuente anamórfica (activada una vez, para fijar su clip al rectángulo real del bug de T35: 78,14 1232×694, inválido a 1280×720 y válido a 1358×720); tras guardarlo, edita el `.vmx` (JSON5) para simular la caché de antes de T35: la fuente anamórfica vuelve a 1280×720 sin `sar`. Nuevo proyecto, reabre el `.vmx` editado (se activa la fuente normal, nunca la anamórfica) y previsualiza: antes de T35b fallaría con `max-rect-outside-frame`; con T35b se renderiza sin activar la fuente.

### Validación

- `yarn tsc`, `yarn lint` (ficheros tocados) y `yarn test run` (918 tests): en verde.
- `yarn build`: en verde.
- `yarn test-e2e`: 14/14 (dos pasadas completas seguidas). El escenario 7 (audio de la previsualización en vivo) dio un fallo puntual al ejecutar el fichero completo (umbral de brillo del canvas no alcanzado, bajo Xvfb con carga), ajeno a este cambio: pasó de nuevo al aislarlo (como ya documentaba T35 para otro test con síntoma similar).

### Límites y dudas

- El refresco en segundo plano al abrir no avisa (toast) de un cambio de proporción con clips; solo lo hace el de `useMixRender.prepare()` indirectamente (vía `setSourceMeta`, que sí pasa por `applyRefreshedSourceMeta`) — en la práctica no cambia nada porque ambos caminos llaman a la misma función. Si en el futuro se quiere silenciar el aviso durante el render (para no interrumpir con un toast justo antes de renderizar), habría que separar ese caso.
- No se ha tocado la concurrencia por defecto (3, como el resto de usos de `p-map` en el código) ni se ha expuesto como ajuste de usuario: no estaba en el alcance.

## Revisión

(La rellena el orquestador: resultado, commit(s).)

## Revisión

- **Resultado**: aceptada. Desbloquea al usuario: los proyectos antiguos con fuentes anamórficas se renderizan sin activar antes la fuente, cubierto por el e2e 12. `tsc`, `lint`, tests (918), `build` y `test-e2e` en verde.
