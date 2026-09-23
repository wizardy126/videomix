# T19 · Overlays: modelo, migración v2 y anclajes

- **Hito**: M7 · **Modelo**: Opus · **Depende de**: — · **Estado**: hecha

## Objetivo

Añadir los elementos superpuestos al modelo del proyecto, con migración, validación, acciones del reducer y resolución pura de tiempos.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §9 (especificación funcional)
- [04-diseno](../04-diseno.md) §8.1 (modelo propuesto; se puede refinar documentando los cambios) y §1
- Código: `videomix/types.ts`, `project.ts` (migraciones), `projectReducer.ts`, `projectFile.ts` (rutas relativas y absolutas), `planner/types.ts` (`ColumnPlacement`)

## Alcance

1. **Esquemas zod y tipos** de `MixOverlay`:
   - `MixProject` pasa a `version: 2` con migración v1 → v2 (`overlays: []`);
   - `parseMixProject` acepta v1 y v2.
2. **Rutas**: `projectFile` guarda y resuelve las rutas de las imágenes, sonidos y fuentes igual que las fuentes de vídeo (relativa y absoluta, e informe de ficheros que faltan).
3. **Reducer**:
   - acciones `addOverlay`, `updateOverlay`, `removeOverlay`, `duplicateOverlay`, `moveOverlayLayer` (subir, bajar, al frente, al fondo);
   - al borrar un clip o un elemento, los anclajes que dependían de él pasan a absolutos (acción que recibe el tiempo resuelto).
4. **`videomix/overlays/resolveOverlayTimes.ts`** (puro):
   - recibe el proyecto, el plan y las duraciones de los sonidos y devuelve `start`, `end` y avisos por elemento;
   - orden topológico y detección de ciclos;
   - vínculo de la barra con un contador;
   - recorte a la duración del vídeo, con aviso.
5. **Validación** en `validateMixProject`: referencias rotas, ciclos, cajas fuera del rango 0..1, duraciones ≤ 0 y colores.
6. **Tests** de todo lo anterior: migración, *round-trip* guardar/cargar, ciclos, cadenas de anclajes y borrado de referencias.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run` en verde.
- Los proyectos v1 existentes se abren sin pérdida.

## Notas de ejecución

### Resumen de cambios

- `videomix/types.ts`: esquemas zod de los overlays, `mixProjectV2Schema` (= `mixProjectSchema`), `MIX_PROJECT_VERSION = 2` y `createEmptyMixProject()` con `overlays: []`. Se mantiene `mixProjectV1Schema` como base.
- `videomix/project.ts`: migración `1 → 2` (`overlays: []`); `parseMixProject` acepta v1 y v2 y devuelve siempre v2 (al guardar se escribe v2). `validateMixProject` valida también los overlays; `MixProjectIssue` tiene `overlayId`.
- `videomix/projectReducer.ts`: acciones de overlays y desanclaje al borrar clips, fuentes o elementos.
- `videomix/projectFile.ts`: rutas relativas/absolutas de imágenes, sonidos y fuentes TTF/OTF, e informe `missingOverlayFiles`.
- `videomix/overlays/`: `anchors.ts` (grafo de anclajes), `resolveOverlayTimes.ts`, `factories.ts` (fábricas, presets de caja, px de referencia).
- `hooks/useMixProject.ts`: envoltorios `addOverlay`, `updateOverlay`, `removeOverlay`, `duplicateOverlay`, `moveOverlayLayer`, `relinkOverlayFile`; `removeClip`/`removeSource` aceptan `resolved` opcional.
- `hooks/useMixWorkspace.ts` (mínimo): estado `missingOverlayFiles` (se rellena al abrir/recuperar) y `userLocateOverlayFile(overlayId, kind)`. No muestra toast ni UI (T22).
- Tests: `overlays/*.test.ts` (resolución, grafo, fábricas), y ampliados `project.test.ts` (migración, *round-trip*, validación), `projectReducer.test.ts` y `projectFile.test.ts` (rutas, ficheros que faltan, v1 desde disco).
- Docs: `04-diseno` §1.2 y §8.1 actualizados con el modelo final.

### Modelo final (`videomix/types.ts`)

```ts
type OverlayAnchor =
  | { kind: 'absolute', time: number }                        // ≥ 0 (esquema)
  | { kind: 'clip', clipId: string, edge: 'start' | 'end', offset: number }
  | { kind: 'element', elementId: string, edge: 'start' | 'end', offset: number };
interface OverlayBox { x: number, y: number, width: number, height: number }   // fracciones 0..1 (lo comprueba validateMixProject)
interface OverlayFile { path: string, absolutePath: string }
// base: { id, name, anchor }
ImageOverlay       { type: 'image', path, absolutePath, duration, box, fadeIn ≥ 0, fadeOut ≥ 0 }
CountdownOverlay   { type: 'countdown', duration, box, align: 'left'|'center'|'right', decimals: 0|1|2|3, leadingZeros,
                     color, font?: OverlayFile, border: { width ≥ 0, color }, shadow?: { x, y, color }, fadeOut ≥ 0 }
ProgressBarOverlay { type: 'progressBar', duration, linkedCountdownId?, box, fillColor, backgroundColor,
                     border: { width ≥ 0, color }, direction: 'ltr'|'rtl'|'btt'|'ttb', mode: 'fill'|'empty' }
SoundOverlay       { type: 'sound', path, absolutePath, gainDb }
MixProject.overlays: MixOverlay[]   // orden = capas, el último encima
```

Refinamientos respecto a la propuesta de §8.1:

- **Colores** `#rrggbb` o `#rrggbbaa` (`OVERLAY_COLOR_REGEX`), para poder usar fondo transparente o semitransparente.
- **Longitudes fuera de cajas** (grosor del borde del texto y de la barra, desplazamiento de la sombra) en **px de referencia** de una salida de 1080 px de alto: `overlayPxToOutput(v, altoSalida) = v · altoSalida / 1080` (`OVERLAY_REFERENCE_HEIGHT`). Así valen en cualquier resolución y la UI puede mostrarlos como "px".
- **Contador**: `box.height` es el tamaño de letra (fracción del alto); el texto va centrado en vertical en la caja y alineado en horizontal según el campo nuevo **`align`**. Con `right`, el texto se queda pegado al margen derecho aunque cambie su ancho (p. ej. de `10` a `9`). T20: `x = cajaX + (cajaAncho − text_w) · {0, ½, 1}`.
- `shadow` es opcional (`undefined` = sin sombra) en vez de `| undefined` obligatorio.
- El **borde de la barra** se dibuja por dentro de la caja.
- Una barra **vinculada** ignora su `anchor` y su `duration` (se conservan para cuando se desvincula).
- Rangos que pueden quedar mal al editar (cajas, duraciones ≤ 0) **no** los rechaza el esquema, para que el proyecto siga abriéndose y se pueda corregir: los informa `validateMixProject`.

### `resolveOverlayTimes` (`overlays/resolveOverlayTimes.ts`)

```ts
resolveOverlayTimes(
  project: Pick<MixProject, 'overlays' | 'clips'>,
  plan: Pick<MixPlan, 'duration' | 'placements'>,
  { soundDurations }?: { soundDurations?: Record<overlayId, seconds> },
): Map<overlayId, ResolvedOverlayTime>

interface ResolvedOverlayTime {
  start: number, end: number,        // recortados a [0, plan.duration]; se dibuja/suena solo si end > start
  rawStart: number, rawEnd: number,  // sin recortar; los anclajes a este elemento usan estos
  warnings: OverlayTimeWarning[],
}
type OverlayTimeWarning =
  | { type: 'cycle' }                                            // absoluto en max(0, offset)
  | { type: 'missing-clip', clipId }                             // clip borrado o no colocado por el planificador → max(0, offset)
  | { type: 'missing-element', elementId }                       // → max(0, offset)
  | { type: 'missing-linked-countdown', countdownId }            // la barra usa su propio anclaje y duración
  | { type: 'unknown-duration' }                                 // sonido sin duración en soundDurations → dura 0
  | { type: 'clipped' } | { type: 'outside-video' };
```

- Pura, O(elementos + colocaciones): un recorrido por cadenas con memo. El test crea una cadena de 2000 elementos en orden inverso.
- Cada elemento depende como mucho de otro (su ancla `element` o el contador vinculado), así que el grafo es funcional; `findOverlayCycleIds` marca solo los miembros del ciclo. Los que dependen de un ciclo se resuelven con normalidad a partir del tiempo de respaldo.
- Las duraciones no finitas o negativas cuentan como 0.

### Grafo de anclajes (`overlays/anchors.ts`)

- `getOverlaysById`, `getLinkedCountdown(overlay, byId)`, `getOverlayDependencyId(overlay, byId)`.
- `findOverlayCycleIds(overlays): Set<string>`.
- `canOverlayDependOn(overlays, overlayId, targetId)`: para que la UI (T22) ofrezca solo anclas o contadores que no creen ciclos.
- `getDependentOverlays(overlays, { clipId } | { overlayId })`: dependientes directos. Sirve para avisar con un toast al borrar.
- `detachOverlayReferences(overlays, { clipIds?, overlayIds?, resolved? })`: la usa el reducer.

### Reducer (`projectReducer.ts`)

- `addOverlay { overlay, index? }`: sin `index`, se añade encima. Lanza si el id está repetido.
- `updateOverlay { overlayId, patch: MixOverlayPatch }`: `MixOverlayPatch` es una unión de `Partial` por tipo. Las claves opcionales (`font`, `shadow`, `linkedCountdownId`) con `undefined` se eliminan, y un parche sin cambios devuelve el mismo objeto.
- `removeOverlay { overlayId, resolved? }`, `removeClip { clipId, resolved? }` y `removeSource { sourceId, resolved? }`: los elementos anclados a lo borrado pasan a `absolute` en `max(0, resolved.rawStart)`. Las barras vinculadas a un contador borrado se desvinculan y, con `resolved`, toman `anchor` absoluto y `duration = rawEnd − rawStart`. Sin `resolved` se usa `max(0, offset)` y la barra conserva su propio anclaje y duración. `resolved` es directamente el `Map` que devuelve `resolveOverlayTimes` **antes** del borrado.
- `duplicateOverlay { overlayId, newId, name? }`: la copia va justo encima del original y los dependientes no se duplican.
- `moveOverlayLayer { overlayId, to: 'up' | 'down' | 'front' | 'back' }`: los elementos visuales saltan al siguiente o anterior **visual**, porque los sonidos no tienen capa; los sonidos se mueven entre sonidos.
- Todas funcionan dentro de `batch`.

### Fábricas (`overlays/factories.ts`)

- `createImageOverlay({ id, name, start?, filePath })`: 5 s, centrada, 30 % × 30 %, *fade* de entrada y salida de 0,5 s. La UI puede ajustar el alto a la proporción de la imagen.
- `createCountdownOverlay({ id, name, start? })`: 10 s, arriba a la derecha (caja de 0,2 × 0,1 con margen de 0,03), `align: 'right'`, 0 decimales, sin ceros a la izquierda, `#ffffff`, borde de 4 px de referencia `#000000`, sin sombra, sin *fade*, fuente incluida (`font` ausente).
- `createProgressBarOverlay({ id, name, start?, linkedCountdownId? })`: abajo, ancho completo menos márgenes (x = 0,03, ancho = 0,94, alto = 0,03), relleno `#ffffff`, fondo `#00000080`, borde de 2 px `#000000`, `ltr`, `fill`, 10 s.
- `createSoundOverlay({ id, name, start?, filePath })`: `gainDb: 0`.
- Todas usan un anclaje absoluto en `max(0, start)`.
- `getOverlayBoxPreset(preset, size, margin = OVERLAY_MARGIN)`, con presets `topLeft | topRight | bottomLeft | bottomRight | center | fullScreen`.
- `overlayPxToOutput(v, outputHeight)` e `isVisualOverlay(o)`.

### Validación (`validateMixProject`)

Códigos nuevos (con `overlayId`):

- Errores: `duplicate-overlay-id`; `overlay-box-out-of-range` (fuera de 0..1, con tolerancia de 1e-9, o con ancho o alto ≤ 0; no aplica a sonidos); `overlay-invalid-duration` (≤ 0 o no finita; no aplica a barras vinculadas ni a sonidos); `overlay-invalid-color`.
- Avisos, porque `resolveOverlayTimes` tiene respaldo: `overlay-broken-reference` (clip, elemento o contador vinculado inexistente o que no es un contador), `overlay-cycle` y `overlay-fades-too-long`.

### Ficheros (`projectFile.ts`)

- Al guardar, `path` pasa a relativo en imágenes, sonidos y fuentes, igual que en las fuentes de vídeo.
- Al abrir o recuperar, se busca primero la ruta relativa y después la absoluta.
- `LoadedMixProject.missingOverlayFiles: { overlayId, kind: 'media' | 'font' }[]`, en orden de capas.
- Helpers exportados: `getOverlayFiles(overlay)` y `mapOverlayFiles(overlay, fn)`.
- Para reenlazar: `useMixProject().relinkOverlayFile(overlayId, kind, filePath)` o, con diálogo, `useMixWorkspace().userLocateOverlayFile(overlayId, kind)`.

### Pendiente para T20–T23

- **T22**:
  - pasar `resolved` al borrar clips (`useMixClips`, `clipSegments` → `removeClip` en *batch*), fuentes (`useMixWorkspace.userRemoveSource`) y elementos, y avisar con `getDependentOverlays`;
  - mostrar `missingOverlayFiles`, que no se poda si se borra el elemento: filtrar por ids existentes;
  - añadir textos traducidos para los nuevos códigos de `validateMixProject` en `renderDialogs.getIssueText`, que ahora usa el mensaje en inglés.
- **T20/T21**: añadir los ficheros de overlays (imágenes, sonidos, fuentes) a la comprobación de ficheros que faltan de `useMixRender.prepare`. T21 debe pasar `soundDurations` (id → s).

### Dudas

Ninguna bloqueante. Los tiempos de respaldo de ciclos y referencias rotas, `max(0, offset)`, son una decisión propia: el requisito solo cubre el borrado, que sí conserva el tiempo actual.

## Revisión

- **Resultado**: aceptada. `tsc`, `lint` y tests (458) en verde.
- **Decisión del orquestador**: se acepta el *fallback* `max(0, offset)` para ciclos y referencias rotas; el caso normal (borrar una referencia desde la UI) conserva el tiempo actual.
- **Pendientes repartidos**:
  - T22: pasar `resolved` en los puntos donde se borran clips, fuentes y elementos; traducir los códigos de aviso nuevos; filtrar `missingOverlayFiles`.
  - T20: comprobar los ficheros de overlays que falten antes de renderizar.
  - T21: `soundDurations`.
