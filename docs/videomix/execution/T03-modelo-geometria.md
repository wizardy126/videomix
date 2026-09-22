# T03 · Tipos, esquema `.vmx` y geometría

- **Hito**: M1 · **Modelo**: Opus · **Depende de**: T01 · **Estado**: hecha

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

### Resumen

Nuevos módulos puros en `src/renderer/src/videomix/` (sin React ni Electron):

- `types.ts`: esquemas zod y tipos del modelo, valores por defecto y proyecto vacío.
- `project.ts`: parseo con punto de migraciones, validación semántica (04-diseno §1.2) y helpers.
- `geometry.ts`: rectángulos, intervalos de proporción, recortes y reparto de anchos (04-diseno §2).
- `geometry.test.ts` y `project.test.ts`: 49 tests, incluidos dos tests de propiedades deterministas (PRNG con semilla): 5000 recortes aleatorios (la mitad con rectángulos impares) y 3000 filas aleatorias (1–5 clips, 360p–2160p, huecos pares e impares), con más de 100 casos de cada tipo (factible, con relleno, infactible).

Validación: `yarn tsc`, `yarn lint` y `yarn test run` en verde (13 ficheros, 142 tests).

### API pública

`types.ts`:
- Esquemas y tipos: `rectSchema`/`Rect`, `mixSourceSchema`/`MixSource`, `mixClipSchema`/`MixClip`, `transitionTypes` (const) + `transitionTypeSchema`/`TransitionType`, `mixResolutionSchema`/`MixResolution`, `mixMusicSchema`/`MixMusic`, `mixSettingsSchema`/`MixSettings`, `loudnessMeasurementSchema`/`LoudnessMeasurement`, `mixProjectV1Schema`/`MixProject`.
- Constantes: `MIN_RECT_SIZE` (16), `MIX_PROJECT_VERSION` (1), `mixResolutions` (`'1080p'` → `{ width: 1920, height: 1080 }`…), `mixFpsValues`, `mixPresets`, `defaultMixSettings`.
- `createEmptyMixProject()`.

`project.ts`:
- `parseMixProject(json: unknown): MixProject`: lanza `Error` si no es objeto, no tiene versión o es más nueva; `ZodError` si el esquema falla.
- `validateMixProject(project, { sourceDurations?, sourceSizes? }) → MixProjectIssue[]` con `{ level: 'error' | 'warning', code, message, clipId?, sourceId? }`. Códigos: `duplicate-source-id`, `duplicate-clip-id`, `unknown-source`, `invalid-time-range`, `end-after-source-duration`, `rect-too-small`, `max-rect-outside-frame`, `min-rect-outside-max`, `clip-shorter-than-transitions` (aviso), `odd-gap` (aviso).
- `getClipDuration(clip)`, `clipsBySource(clips) → Map<sourceId, MixClip[]>`.

`geometry.ts`:
- `rectAspect`, `getOrientation(maxRect)`, `rectContains(outer, inner)`, `clampRect(rect, bounds)` (encoge al tamaño de `bounds` y luego desplaza dentro).
- `normalizeRectEven(rect, 'shrink' | 'grow')`, `normalizeClipRects(maxRect, minRect?) → { max, min }`.
- `getAspectRange(maxRect, minRect?) → AspectRange { min, max, preferred }`.
- `getCropForAspect(maxRect, minRect | undefined, aspect) → { crop, fit: 'fill' | 'pillarbox' | 'letterbox' }`, `ASPECT_TOLERANCE`.
- `getScaleFactor(crop, cellWidth, cellHeight)`.
- `getWidthRange(range, height) → { min, max, preferred }` (anchos en px de salida; útil para que el planificador compruebe la factibilidad con los mismos números que `distributeWidths`).
- `distributeWidths({ clips, width, height, gap }) → { widths, fill } | undefined`.

### Decisiones

- **Esquema estructural, validación semántica aparte**: zod solo rechaza lo estructural (tipos, enteros, enums, colores `#rrggbb`, rectángulos con coordenadas ≥ 0). Las reglas de §1.2 (tamaño ≥ 16 px, rangos de tiempo, rectángulos dentro del fotograma, etc.) van en `validateMixProject`, para que un proyecto con un clip inválido se pueda abrir y corregir.
- **Ajustes incompletos**: `parseMixProject` completa los campos que falten en `settings` con `defaultMixSettings`, para que los `.vmx` guardados durante el desarrollo sigan abriéndose al añadir ajustes nuevos. Las migraciones (`migrations[n]`: vn → vn+1) están vacías porque solo existe la v1.
- **`LoudnessMeasurement`**: unión discriminada por `hasAudio` (`{ hasAudio: true, inputI, inputTp, inputLra, inputThresh }` | `{ hasAudio: false }`), para poder cachear también los clips sin audio. T12 puede ajustarla.
- **Validación con datos frescos**: el tamaño y la duración de la fuente salen de la cache de `MixSource`, sobrescribibles con `sourceDurations`/`sourceSizes`; si no se conocen, esas comprobaciones se omiten.
- **Geometría**: ver 04-diseno §2.4 (añadido): normalización a pares del máx. (encoger) y del mín. (agrandar e intersecar), redondeo del recorte que conserva `m ⊆ C ⊆ M`, `ASPECT_TOLERANCE` del 1 %, reparto en píxeles con límites pares por clip y redondeo por mayor resto.
- **`-0`**: los helpers de redondeo normalizan `-0` a `0` para que las comparaciones y los snapshots sean estables.

### Desviaciones del diseño

- 04-diseno §2.3 decía "se ajusta el último ancho para que la suma cuadre". Se sustituye por un redondeo por mayor resto en unidades de 2 px que respeta los límites de cada clip (ajustar solo el último podía sacarlo de su intervalo). Documentado en §2.4.
- El *water-filling* proporcional al margen no necesita iterar: todos los clips saturan a la vez (t = diferencia / Σ márgenes ∈ [−1, 1]).
- Tolerancia de proporción (`ASPECT_TOLERANCE` = 1 %) no prevista en el diseño: sin ella, los redondeos a pares provocarían pillarbox/letterbox de 1 px.
- Las matemáticas de §2.1–§2.2 eran correctas; no se han cambiado.

### Dudas abiertas

- **Rectángulos pares en la UI**: recomiendo que T06 ajuste los rectángulos a valores pares al editarlos. Así la normalización nunca cambia nada y el mín. se respeta al píxel. Con valores impares el comportamiento es correcto pero puede perder 1 px del mín. en un borde impar del máx.
- **Separación impar**: ¿se restringe `gap.width` a pares en la UI (paso 2)? Ahora solo hay aviso y queda 1 px de relleno.
- **Acortar la transición** de clips cortos (duración ≤ 2 × D): la validación solo avisa; la regla concreta de acortamiento la decide el planificador (T10).
- `maxColumns` solo tiene mínimo 1 en el esquema; si T10 necesita acotar la combinatoria, puede añadir un máximo.

## Revisión

- **Resultado**: aceptada. `tsc`, `lint` y `test` en verde (142 tests).
- **Dudas resueltas por el orquestador** (decisiones técnicas, sin impacto en los requisitos):
  - T06 ajustará los rectángulos a valores pares al editarlos.
  - T14 restringirá `gap.width` a pares (paso 2) y `maxColumns` a 1–6.
  - El acortamiento de la transición en clips cortos lo decide T10.
