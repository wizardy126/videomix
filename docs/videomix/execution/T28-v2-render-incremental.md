# T28 · v2: render incremental con caché (D1)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T25 · **Estado**: pendiente

## Alcance

1. **Clave estable por bloque**: hash del grafo del bloque, independiente de rutas temporales (hay que normalizar las rutas de grafo y de salida), de los ficheros de entrada (ruta absoluta, mtime y tamaño) y de los argumentos de codificación. El audio lleva su propia clave con la misma idea.
2. **Caché** en `<nombre>.vmx.cache/`, junto al proyecto. Si el proyecto no está guardado, en `userData/videomix-cache/<id>`.
   - `runRenderJob` reutiliza los bloques que ya existen (verificando tamaño y duración) y renderiza solo los que faltan.
   - Escritura atómica (temporal y renombrado).
3. **Límites**: se limpian los bloques que no usa el último render. Ajuste global de tamaño máximo por defecto; acción "Vaciar caché" en el menú Project.
4. **Previsualización**: su caché va separada, por resolución.
5. **Progreso**: los bloques en caché cuentan como hechos al instante.
6. **Tests**:
   - estabilidad de la clave: mismo proyecto → misma clave; un cambio en un clip → solo cambian los bloques afectados;
   - test con ffmpeg real: re-render sin cambios ≈ 0 bloques rehechos.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde. Tiempos medidos antes y después con `renderPlan.ts`.

## Notas de ejecución

## Revisión
