# T31 · v2: miniaturas (A2)

- **Hito**: M8 · **Modelo**: Sonnet · **Depende de**: T29 · **Estado**: pendiente

## Alcance

1. **Generación**:
   - miniatura por clip: fotograma de `start` recortado al máx., ~160 px de alto, JPEG;
   - generada con ffmpeg (`captureFrameToFile` o equivalente, con `crop`);
   - caché en `userData/videomix-thumbs/`, con clave de ruta, mtime, `start` y `maxRect`;
   - cola con concurrencia limitada.
2. **Uso**: miniatura en las filas de `ClipList` y en los bloques de la vista Mix (si el bloque es lo bastante ancho).
3. Se regeneran al cambiar `start` o `maxRect`, con *debounce*, y hay limpieza de las antiguas.
4. **Tests** de la clave y de la cola.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

## Revisión
