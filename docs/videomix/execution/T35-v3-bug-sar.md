# T35 · v3: bug SAR y re-vincular con otra resolución (B1, B2)

- **Hito**: M9 · **Modelo**: Opus · **Depende de**: — · **Estado**: pendiente

## Contexto

- [01-requisitos](../01-requisitos.md) §11 (B1, B2).
- **Diagnóstico** (revisado por el orquestador, correcto):
  - `getSourceMeta` (`videomix/workspace.ts`) guarda el tamaño codificado orientado (aplica la rotación, pero no el SAR).
  - El editor (`ClipRectEditor.tsx`) usa `videoWidth`/`videoHeight`, que ya aplican el SAR.
  - El render (`buildVideoGraph.ts`, `cropFilter`) y las miniaturas (`src/main/videomix/thumbnails.ts`) recortan en píxeles codificados.
  - Caso real: 1280×720 con SAR 679:640 da 1358×720 de visualización. Un rect con borde derecho en 1310 es válido en el editor y falla con `max-rect-outside-frame`.
  - Con el reproductor compat, el editor usa el tamaño del stream (codificado): también hay que aplicar el SAR ahí.
- **Bug relacionado**: `setSourceMeta` y `relinkSource` (`projectReducer.ts`) cambian el tamaño sin tocar los rectángulos de los clips.

## Alcance

1. **Una sola fuente de verdad en píxeles de visualización**:
   - `getSourceMeta` aplica el SAR **antes** de la rotación: el ancho codificado × SAR y después se orienta.
   - Hay que guardar el SAR en `MixSource` (campo aditivo `sar?: { num, den }`), porque ffmpeg lo necesita para convertir.
   - Proyectos existentes: al activar una fuente se refresca su meta (ya ocurre). Los rectángulos guardados en píxeles de visualización pasan a ser válidos sin migrar nada.
2. **Render y miniaturas**: el rectángulo (en píxeles de visualización) se convierte a píxeles codificados **en el `crop`**, sin añadir un escalado del fotograma completo. El escalado a la celda, que ya lleva `setsar=1`, corrige la proporción.
   - **Rotación**: el autorotate de ffmpeg (transpose) invierte el SAR. En una fuente rotada 90° o 270°, el factor se aplica al eje vertical del fotograma ya rotado. Hay que verificarlo empíricamente.
   - Redondeo a pares en píxeles codificados.
   - Hay que revisar el resto de filtros que usan tamaños de la fuente (relleno desenfocado, capa de columna).
3. **Editor con reproductor compat**: el tamaño del stream también aplica el SAR.
4. **Previsualización en vivo**: debe seguir coherente, porque dibuja desde `<video>` en píxeles de visualización. Hay que verificar que `drawImage` con el rectángulo de origen use las coordenadas correctas: `drawImage` trabaja en píxeles intrínsecos del vídeo, que en Chromium son los de visualización; hay que confirmarlo.
5. **Re-vincular** (B2): si cambia el tamaño de la fuente (por `relinkSource` o `setSourceMeta`), los `maxRect`/`minRect` de sus clips se **escalan proporcionalmente**.
   - Si cambia la proporción, además se ajustan al fotograma (pares, mín. ⊆ máx.) y se avisa con un toast.
   - La primera vez que se refresca una meta que antes era desconocida no se escala nada.
6. **Tests**:
   - `getSourceMeta` con SAR y con SAR + rotación;
   - conversión de rectángulo a `crop` codificado;
   - escalado al re-vincular;
   - con ffmpeg real: genera en `generateTestMedia` una fuente anamórfica (p. ej. 1280×720 con `setsar=679/640`) y otra anamórfica rotada 90°; renderiza un clip con un rectángulo conocido y comprueba por píxeles que el encuadre coincide con el que da el `<video>` (o con un recorte hecho escalando primero a visualización);
   - miniaturas iguales.
7. Añade la fuente anamórfica a los escenarios e2e si es sencillo.

## Criterios de aceptación

- El caso real (rect 78,14,1232×694 sobre 1280×720 SAR 679:640) valida y se renderiza con el encuadre del editor.
- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

## Revisión
