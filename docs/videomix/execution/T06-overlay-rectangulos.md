# T06 · Overlay de rectángulos máx./mín.

- **Hito**: M2 · **Modelo**: Opus · **Depende de**: T03 · **Estado**: pendiente

## Objetivo

Componente que dibuja y permite editar los rectángulos **máx.** y **mín.** de un clip sobre el vídeo, en coordenadas de la fuente.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.2
- [04-diseno](../04-diseno.md) §1.1, §2, §6.4
- [02-as-built](../02-as-built.md) §6: `<video>` con `object-fit: contain` en `App.tsx`, `MediaSourcePlayer` y rotación
- `geometry.ts` (T03)

## Alcance

1. **`videomix/overlayMath.ts`** (puro, con tests):
   - `getVideoContentBox(containerSize, videoSize)`, con el cálculo de `object-fit: contain`;
   - `toSourceCoords` y `toScreenCoords`;
   - aplicación de un arrastre (mover o redimensionar por tirador) con restricciones: `min ⊆ max ⊆ frame`, tamaño mínimo de 16 px, proporción fija opcional para el máx. y el mín. empujado o recortado cuando el máx. encoge.
2. **`videomix/components/RectOverlay.tsx`**:
   - SVG absoluto encima del `<video>` (mismo contenedor);
   - máx. con borde sólido del color del clip y el exterior oscurecido (máscara);
   - mín. con borde discontinuo;
   - 8 tiradores por rectángulo y arrastre interior para mover;
   - puntero y teclado: las flechas mueven 2 px y con Shift 10 px;
   - los rectángulos se ajustan siempre a valores pares (ver 04-diseno §2.4);
   - etiqueta con `w×h`, proporción y orientación;
   - props controladas `{ maxRect, minRect, onChange(transient), onCommit, aspectLock, videoSize, … }`;
   - no interfiere con el clic del vídeo fuera de los rectángulos, ni con la rueda (seek/zoom).
3. **Barra de herramientas mínima**:
   - presets de proporción del máx.: libre, 9:16, 3:4, 1:1, 4:3, 16:9;
   - "Mín. = Máx." (borrar el mín.);
   - "Rellenar fotograma".
4. **Tamaño real del vídeo**: `videoWidth` / `videoHeight` del elemento, que ya tienen en cuenta la rotación de metadatos en Chromium; hay que verificarlo.
   - Con el reproductor compat y la **rotación manual** de LosslessCut (`rotation` en `App.tsx`), documenta el comportamiento.
   - Propuesta: en VideoMix se ignora o desactiva la rotación manual.
5. Monta el overlay en `App.tsx` solo cuando hay un clip seleccionado o en edición. La integración real de los datos la hace T07. En esta tarea, basta una integración mínima con estado local o de prueba.

## Fuera de alcance

- La creación y persistencia de clips (T07).

## Criterios de aceptación

- Tests de `overlayMath` que cubran:
  - contenedores más anchos y más altos que el vídeo (bandas laterales y superiores);
  - redondeo;
  - restricciones de arrastre y proporción fija.
- `yarn tsc && yarn lint && yarn test run` en verde.
- Instrucciones de prueba manual en las notas.

## Notas de ejecución

## Revisión
