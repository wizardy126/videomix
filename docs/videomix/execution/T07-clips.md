# T07 · Clips: creación, sincronización y lista

- **Hito**: M2 · **Modelo**: Opus · **Depende de**: T05, T06 · **Estado**: pendiente

## Objetivo

Crear y editar clips (tiempo + rectángulos + ajustes) y mostrarlos todos en el panel derecho.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.2, §4.4, §5 (mute y ganancia por clip), §7
- [04-diseno](../04-diseno.md) §6.3, §6.5
- [02-as-built](../02-as-built.md) §5 (`useSegments`, `loadCutSegments`, `segId`), §7 (`SegmentList`, dnd-kit, virtualización)

## Alcance

1. **Sincronización clips ↔ segmentos de la fuente activa** (04-diseno §6.3):
   - implementa la estrategia recomendada o la alternativa;
   - **registra la decisión en `docs/videomix/decisiones/ADR-002-clips-segmentos.md`**, con el razonamiento y cómo queda el undo/redo.
   - Requisitos:
     - editar inicio/fin en el timeline actualiza el clip;
     - los segmentos sin `end` (marcadores) no son clips;
     - undo/redo coherente;
     - cambiar de fuente no pierde nada.
2. **Crear clip**:
   - acción "Add clip" (botón en BottomBar o en la barra VideoMix, más un atajo) desde el segmento actual o desde la selección inicio/fin;
   - nombre por defecto `<fuente sin extensión> #n`, color siguiente de la paleta y `maxRect` igual al fotograma completo.
3. **Clip seleccionado**:
   - el overlay (T06) edita sus rectángulos con commit al historial al soltar;
   - al seleccionar un clip de otra fuente, se activa esa fuente, se hace seek a `start` y se selecciona.
4. **`videomix/components/ClipList.tsx`** (panel derecho, sustituye a `SegmentList` en el layout):
   - todos los clips, virtualizados y reordenables con dnd-kit (patrón `SegmentList`);
   - por fila: número, color (selector de la paleta), nombre editable, fuente, `start`–`end`, duración, icono de orientación (horizontal/vertical según el máx.), mute, ganancia en dB (−20…+20) y avisos: clip más corto que 2 × transición, mín. no definido (informativo);
   - menú contextual: duplicar, eliminar, ir a la fuente;
   - miniatura: frame de `start` recortado al máx. Si es costosa, déjala como mejora opcional y documéntalo. Puede reutilizar `captureFrame`.
5. **Atajos**: nuevas `KeyboardAction` para añadir, eliminar y duplicar clip, sin conflictos.

## Fuera de alcance

- El plan de montaje y el render.

## Criterios de aceptación

- Flujo completo:
  1. añadir 2 fuentes;
  2. crear 3 clips en cada una con rectángulos distintos;
  3. reordenar, cambiar de fuente, deshacer y rehacer;
  4. guardar y abrir: todo se conserva.
- Tests de la lógica pura de sincronización y de numeración y nombres.
- `yarn tsc && yarn lint && yarn test run` en verde.
- Instrucciones de prueba manual en las notas.

## Notas de ejecución

## Revisión
