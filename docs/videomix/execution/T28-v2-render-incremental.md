# T28 · v2: render incremental con caché (D1)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T25 · **Estado**: hecha

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

### Resumen de cambios

- **`render/renderCache.ts`** (nuevo, puro, sin React ni Electron):
  - `getStepKeySource` / `getRenderCacheKeys(job, { fileIdentities })`: clave de cada bloque y de la pasada de audio = SHA-256 (Web Crypto, `sha256Hex`; 40 caracteres hex) de un texto con:
    - los argumentos del paso, con la salida sustituida por `<out>` y el fichero del grafo por `<file n>` + su contenido: no queda ninguna ruta temporal;
    - la identidad (`tamaño:mtime`, `getFileIdentity`) de cada fichero del proyecto que lee el paso: los que salen como argumento (`-i`) y los que aparecen escapados en el grafo (fuentes de `drawtext`);
    - `RENDER_CACHE_VERSION`.
    Los argumentos incluyen ya el encoder resuelto (T25), CRF/preset, fps y tamaño; el grafo del audio lleva las ganancias de sonoridad. Un bloque no depende de su índice: si dos bloques son idénticos comparten fichero.
  - `applyRenderCache(job, { dir, keys, runId, join, fps })`: cada bloque escribe en `v-<clave>.<run>-<i>.part.mp4` dentro de la caché y lleva `cache: { path: v-<clave>.mp4, tolerance: 1/fps }`; el audio, `a-<clave>.m4a` con 0,1 s de tolerancia. La lista del `concat` sigue en el directorio temporal, con las rutas absolutas de la caché entre comillas (`getConcatListLine`), y el `concat` lee el audio de la caché.
  - `pruneRenderCache`: tras un render correcto borra, en la carpeta de ese tipo de render, los ficheros de caché que no ha usado (y parciales de más de 6 h); si la caché entera del proyecto supera `maxBytes`, borra por LRU (mtime), los usados por este render los últimos. Solo toca nombres con el patrón de la caché.
  - Rutas: `getProjectCacheRoot` → `.<nombre>.vmx.cache` junto al `.vmx`; `getUnsavedCacheParent` → `userData/videomix-cache`; `getRenderCacheDir` → `render/` o `preview-<W>x<H>/`. `getStaleUnsavedCaches`: cachés de proyectos sin guardar sin usar en 7 días.
- **`render/buildRenderJob.ts`** (solo tipos): `RenderStep.cache?: RenderStepCache` y `RenderJob.cacheDir?`. No se ha tocado la generación de grafos.
- **`render/runRenderJob.ts`**:
  - nueva dependencia opcional `verifyCached(path, { duration, tolerance })`;
  - antes de lanzar nada comprueba (de 4 en 4) qué pasos están en caché; esos no se ejecutan, cuentan como hechos al instante en el progreso y no aparecen en "Last commands";
  - los demás escriben a su parcial y se renombran a la caché al terminar (misma carpeta: renombrado atómico);
  - crea `cacheDir`; al fallar o cancelar borra los parciales, pero los bloques ya terminados se quedan en la caché (el siguiente intento los aprovecha);
  - devuelve `{ renderedChunks, reusedChunks, audioReused }`.
- **`hooks/useMixRender.ts`**:
  - raíz de la caché: `.<nombre>.vmx.cache` si el proyecto está guardado; si no, `userData/videomix-cache/<nanoid de la sesión>`;
  - identidades de las fuentes, pistas de música, ficheros de elementos y la fuente incluida (`fs.stat`), claves, `applyRenderCache`, `runRenderJob` y `pruneRenderCache` (sus errores solo se registran);
  - `verifyCached`: `stat` (fichero no vacío) + `getDuration` (ffprobe de la cabecera, ya expuesto por main) + `utimes` para el LRU;
  - al arrancar borra las cachés de proyectos sin guardar de más de 7 días;
  - `userClearRenderCache`: borra la caché del proyecto y todas las de proyectos sin guardar, con un *toast* con los MB liberados.
  - El reintento con software de T25 reconstruye el job con otras claves (el encoder forma parte de ellas); lo que dejara el intento con hardware se limpia al terminar.
- **Ajuste global**: `Config.renderCacheMaxBytes` (`src/common/types.ts`, `src/main/configStore.ts`), por defecto 5 GB (`DEFAULT_RENDER_CACHE_MAX_BYTES`); `0` desactiva la caché (render como antes, todo en el temporal). **Sin UI**: se cambia en `config.json` de `userData`.
- **Menú y acciones**: Project → "Clear render cache" (`menu.ts`), `KeyboardAction` `clearRenderCache` (sin atajo por defecto, aparece en Keyboard shortcuts, categoría Project) y `mainActions` en `App.tsx` (una línea).
- **`script/videomix/renderPlan.ts`**: `--cache <dir>` renderiza por el mismo camino que la app (`renderCache` + `runRenderJob` + `pruneRenderCache`) y dice cuántos bloques ha codificado y reutilizado.
- **i18n**: `scan-i18n` (3 claves nuevas, traducidas al español). El `scan-i18n` también añadió al inglés claves de T29, que está en curso; su traducción es cosa de T29.
- **Docs**: `04-diseno` §4.2 (caché de render, script) y §9.

### Decisiones

- **Carpeta oculta**: los requisitos (D1) piden una carpeta oculta y el task-doc dice `<nombre>.vmx.cache/`. Se usa `.<nombre>.vmx.cache/` (con punto: oculta en macOS y Linux). En Windows no se marca como oculta (haría falta `attrib +h`); queda visible.
- **Clave sobre los argumentos y no solo sobre el grafo**: así cualquier cambio de codificación, de entrada (`-ss`/`-t` de cada clip) o de tamaño invalida el bloque sin tener que enumerar parámetros.
- **Identidad de fichero** = tamaño + mtime (no se lee el contenido: sería lento con vídeos grandes). Un fichero sustituido con el mismo tamaño y la misma mtime no se detectaría.
- **Verificación**: tamaño > 0 y duración de ffprobe (solo lee la cabecera; el render sin cambios de 5 bloques tarda 0,17 s en total) dentro de 1 fotograma. No se cuentan fotogramas (`-count_frames` decodifica el bloque entero). La escritura atómica hace que un fichero con nombre final siempre sea completo; la verificación cubre ficheros dañados desde fuera (probado con uno truncado y otro vacío).
- **Límite de tamaño por proyecto** (no global de todos los proyectos: no hay un índice de cachés repartidas por el disco). Si un solo render supera el límite, se guarda solo lo que cabe.
- **Previsualización**: su propia carpeta por resolución (`preview-640x360/`), así su limpieza no borra los bloques del render final ni al revés. Su clave ya incluye tamaño, fps y codificación.
- **Proyecto sin guardar**: la caché va a `userData/videomix-cache/<id de sesión>`; al guardarlo, el primer render vuelve a codificar todo en la carpeta del proyecto (no se copia).
- **"Vaciar caché"** también borra las cachés de proyectos sin guardar, que no se ven desde ningún otro sitio.

### Medidas (`renderPlan.ts`, ejemplo de 7 clips y 17,5 s sobre los medios de T02, 1920×1080, `medium` CRF 20, 2 bloques en paralelo)

| Caso | Bloques | Tiempo |
|---|---|---|
| Sin caché (antes) | 5 codificados | 15,0–18,7 s |
| Con caché, primera vez | 5 codificados | 14,9 s |
| Con caché, sin cambios | 0 codificados, 5 reutilizados | **0,17 s** |
| Con caché, clip 7 con otro inicio en su fuente (misma duración) | 1 codificado, 4 reutilizados | **6,1 s** |
| Igual con `--max-chunk 5`: primera vez / sin cambios / clip 7 cambiado | 7 / 0 / 2 codificados | 14,5 s / 0,20 s / 6,3 s |

El render sin cambios queda en la verificación con ffprobe más el `concat`. Tras cambiar el clip se borran los bloques que ya no se usan (1 y 2 ficheros, respectivamente). El script usa audio en silencio, así que el audio siempre se reutiliza; con audio real, cambiar un clip también rehace la pasada de audio, que es corta.

### Tests

- `renderCache.test.ts`:
  - la clave no depende del directorio temporal (POSIX y Windows);
  - cambiar el inicio del clip `c` o del `a` cambia exactamente los bloques en los que se ve;
  - un fichero de entrada con otro tamaño o mtime cambia solo los bloques que lo leen;
  - otro códec cambia todas las claves;
  - el audio tiene su propia clave: cambia con el audio, no con un recorte;
  - `applyRenderCache` (rutas parciales, lista del `concat` y audio);
  - comillas en la lista del `concat`, rutas de la caché, `pruneRenderCache` (no usados, parciales, LRU con los del render al final, carpeta inexistente) y cachés caducadas.
- `runRenderJob.test.ts` (fs y ffmpeg falsos): solo se ejecutan los pasos que faltan, el progreso avanza al instante con los que están en caché, un segundo render lo reutiliza todo, y un fallo borra los parciales pero conserva los bloques terminados. Sin `verifyCached` siempre se renderiza.
- `renderCache.ffmpeg.test.ts` (ffmpeg real, 320×180, bloques de 1 s):
  - primer render: todos los bloques;
  - segundo sin cambios: **0 bloques** y el audio reutilizado, con los mismos fotogramas (`framemd5`);
  - con el clip `c` cambiado: **solo los bloques en los que se ve**, fotogramas idénticos a un render sin caché, y en la caché quedan solo los ficheros de este render;
  - un bloque truncado y otro vacío se vuelven a renderizar.
- `yarn tsc`, `yarn test run` (702 tests) y `yarn build` en verde. `yarn lint` sin errores en los ficheros de T28; quedan 2 `no-shadow` en `buildVideoGraph.test.ts`, de T29 (en curso).

### Prueba manual (la app no se puede lanzar aquí)

1. Guarda un proyecto con varios clips y renderiza: aparece `.<nombre>.vmx.cache/render/` junto al `.vmx` con `v-*.mp4` y `a-*.m4a`.
2. Renderiza otra vez sin cambios: el progreso salta casi al final y termina en segundos; "Last ffmpeg commands" solo muestra el `concat`.
3. Cambia el inicio de un clip (o su rectángulo) y renderiza: solo se rehacen los bloques de ese clip y la pasada de audio. Los bloques viejos desaparecen de la carpeta.
4. Previsualización: crea `preview-640x360/` y no toca `render/`.
5. Cancela un render a medias: no quedan `*.part.*` en la caché; al repetir, los bloques terminados se reutilizan.
6. Project → "Clear render cache": la carpeta desaparece y sale "Render cache cleared (N MB freed)".
7. Con `"renderCacheMaxBytes": 0` en `config.json` el render funciona como antes, sin carpeta de caché.

### Dudas

- Carpeta oculta en Windows (ver Decisiones). Si se quiere, `attrib +h` desde main al crearla.
- ¿Hace falta UI para el tamaño máximo? Por ahora solo está en `configStore`.

## Revisión

- **Resultado**: aceptada. Re-render sin cambios en 0,17 s y un cambio en un clip rehace 1 de 5 bloques. `tsc` validado en un árbol limpio sin los cambios de T29.
- **Se aceptan**:
  - carpeta `.<nombre>.vmx.cache`;
  - límite de tamaño por proyecto;
  - sin copiar la caché de sesión al guardar;
  - "Clear render cache" también borra las cachés de sesión.
- Las traducciones al español de los textos de T28 van en el commit de T29, que comparte `locales`.
