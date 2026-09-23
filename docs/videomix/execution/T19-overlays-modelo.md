# T19 · Overlays: modelo, migración v2 y anclajes

- **Hito**: M7 · **Modelo**: Opus · **Depende de**: — · **Estado**: pendiente

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

## Revisión
