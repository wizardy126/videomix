# T03 · Tipos, esquema `.vmx` y geometría

- **Hito**: M1 · **Modelo**: Opus · **Depende de**: T01 · **Estado**: pendiente

## Objetivo

Definir el modelo de datos de VideoMix (tipos + esquemas zod versionados) y la librería de geometría pura sobre la que se apoyan el overlay, el planificador y el generador del grafo.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.2, §6, §7
- [04-diseno](../04-diseno.md) §1 y §2 (especificación principal)
- [03-convenciones](../03-convenciones.md) §2, §5, §9
- Patrón de esquemas: `llcProjectV1Schema` / `V2` en `src/renderer/src/types.ts`

## Alcance

1. **`src/renderer/src/videomix/types.ts`**:
   - esquemas zod y tipos de `Rect`, `MixSource`, `MixClip`, `TransitionType` (con la lista de transiciones como `const` exportado), `MixSettings`, `MixProject` (`version: 1`) y `LoudnessMeasurement` (placeholder mínimo que T12 completará);
   - `defaultMixSettings`;
   - `createEmptyMixProject()`.
2. **`src/renderer/src/videomix/project.ts`** (puro):
   - `parseMixProject(json: unknown): MixProject`, con un punto de migraciones preparado aunque solo exista la v1;
   - `validateMixProject(project, { sourceDurations? }) → Issue[]`, que aplica las reglas de 04-diseno §1.2;
   - helpers `getClipDuration` y `clipsBySource`.
3. **`src/renderer/src/videomix/geometry.ts`** (puro), según 04-diseno §2:
   - `clampRect`, `rectContains`, `normalizeRectEven`, `rectAspect`, `getOrientation(maxRect)` (horizontal si w/h > 1);
   - `getAspectRange(maxRect, minRect?) → { min, max, preferred }`;
   - `getCropForAspect(maxRect, minRect | undefined, aspect) → { crop: Rect, fit: 'fill' | 'pillarbox' | 'letterbox' }`;
   - `distributeWidths({ clips: AspectRange[], width, height, gap }) → { widths: number[], fill: number } | undefined` (water-filling, anchos pares y suma exacta);
   - `getScaleFactor(crop, cellWidth, cellHeight)`.
4. **Tests**: `geometry.test.ts` y `project.test.ts`, que cubren:
   - casos límite: `min == max`, `min` pegado a un borde del máx., proporciones extremas, fila infactible, sobrante de relleno, redondeo a pares que cuadre la suma;
   - parseo y rechazo de proyectos inválidos.

## Fuera de alcance

- Estado React, persistencia a disco (T04) y UI.

## Criterios de aceptación

- API documentada con JSDoc breve (contrato para T06, T10 y T11).
- Cobertura de tests de todas las funciones públicas, con propiedades verificadas:
  - el recorte contiene al mín. y está dentro del máx.;
  - la proporción del recorte es la pedida (±1 px);
  - la suma de anchos más los huecos más el relleno es igual a W.
- `yarn tsc && yarn lint && yarn test run` en verde.

## Validación

```
yarn tsc && yarn lint && yarn test run
```

## Notas de ejecución

## Revisión
