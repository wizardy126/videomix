# T42 · Vídeos convertidos (html5ify) en la carpeta de caché del proyecto

- **Hito**: M10 · **Modelo**: Opus · **Depende de**: — · **Estado**: hecha

## Objetivo

Heredado de LosslessCut: si una fuente está en un formato que el reproductor no soporta, se convierte a un formato reproducible (html5ify, incluido el modo `fastest`, que crea un vídeo "dummy") y ese fichero se guarda junto al original (o en `customOutDir`). En VideoMix:

- **Proyecto guardado** (`projectPath` conocido): el fichero convertido se guarda dentro de la carpeta de caché del proyecto (`getProjectCacheRoot`, `.<nombre>.vmx.cache`, ver `render/renderCache.ts`), y se **reutiliza** al volver a activar la fuente o al reabrir el proyecto (no se vuelve a convertir).
- **Proyecto sin guardar**: se mantiene el comportamiento heredado.

## Contexto (leer antes de empezar)

- [03-convenciones](../03-convenciones.md), [02-as-built](../02-as-built.md) (html5ify).
- `src/renderer/src/App.tsx`: `loadMedia` (`ensureWritableOutDir`, `findExistingHtml5FriendlyFile(fp, cod)`, `needsAutoHtml5ify`, `html5ifyAndLoadWithPreferences(cod, …)`) y el manejador de error de reproducción (≈ línea 2431, usa `customOutDir`). También la acción de menú "Convertir a formato soportado" (`userHtml5ifyCurrentFile`).
- `src/renderer/src/hooks/useHtml5ify.tsx`, `src/renderer/src/hooks/useFfmpegOperations.ts` (`html5ify`, `html5ifyDummy`), `src/renderer/src/util.ts` (`getHtml5ifiedPath`, `findExistingHtml5FriendlyFile`, `getSuffixedOutPath`).
- `src/renderer/src/videomix/render/renderCache.ts`: `getProjectCacheRoot`, poda de la caché (solo toca ficheros con nombre de caché de render: comprobar que los convertidos no se borran ni cuentan en la poda, o decidir y documentar lo contrario).

## Especificación

1. Una función pura (p. ej. `getPreviewConversionDir(path, cacheRoot, sourceAbsolutePath)` en `videomix/`) que devuelve la carpeta de conversión de una fuente dentro de la caché del proyecto: p. ej. `<cacheRoot>/converted/<hash corto de la ruta absoluta de la fuente>/`. El subdirectorio por fuente evita colisiones entre fuentes con el mismo nombre de fichero en carpetas distintas. Tests.
2. En modo VideoMix con proyecto guardado, todas las rutas html5ify de una fuente (conversión automática al cargar, conversión tras error de reproducción, acción manual del menú) usan esa carpeta como `customOutDir` de la conversión, creándola si no existe. **Solo** para la conversión: el resto de usos de `customOutDir` no cambian.
3. Al cargar una fuente con proyecto guardado se busca primero un convertido existente en la carpeta de caché; si no hay, en la ubicación heredada (compatibilidad con conversiones hechas antes de este cambio); si tampoco, se convierte en la caché.
4. Sin proyecto guardado: exactamente el comportamiento actual.
5. Si el proyecto se guarda por primera vez (o con "Guardar como") después de convertir, no hace falta mover nada: la próxima conversión irá a la caché. Documentar.
6. Tests unitarios de la lógica pura y, si es razonable, un e2e: con un medio de prueba que el reproductor no soporte (generarlo en `generateTestMedia.ts` si no hay ninguno, p. ej. un códec no soportado por Chromium), abrir un proyecto guardado, añadir la fuente y comprobar que el convertido aparece en `.<nombre>.vmx.cache/converted/…` y no junto al original; al reabrir, que no se vuelve a convertir.
7. Manual: nota breve en la sección de fuentes/caché.

## Fuera de alcance

- El modal de render (T41, en paralelo: tus cambios en `App.tsx` deben limitarse a la lógica de html5ify/`loadMedia`).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

**Resumen**

- `videomix/previewConversion.ts` (puro): `getPreviewConversionDir(path, cacheRoot, sourceAbsolutePath)` → `<cacheRoot>/converted/<16 hex del SHA-256 de la ruta absoluta>` (reutiliza `sha256Hex` de `renderCache.ts`, así que es asíncrona). Tests en `previewConversion.test.ts`: forma de la ruta, estabilidad, fuentes homónimas en carpetas distintas y que `pruneRenderCache` no toca ni cuenta los convertidos.
- `videomix/hooks/usePreviewConversion.ts`: con VideoMix y proyecto guardado, `ensureConversionOutDir(fp)` (crea la carpeta; si falla, avisa en consola y devuelve `undefined` → ubicación heredada) y `findExistingConvertedFile(fp)` (usa `findExistingHtml5FriendlyFile` sobre esa carpeta; `undefined` si no existe). Sin proyecto guardado o fuera de VideoMix, ambas devuelven `undefined`.
- `useMixProject`: expone `getProjectPath()` (lee `projectPathRef`). Hace falta porque al abrir un proyecto su primera fuente se carga en la misma cadena asíncrona, antes del siguiente render: el `projectPath` del estado estaría desfasado en `loadMedia`.
- `hooks/useHtml5ify.tsx`: nuevo parámetro opcional `getConversionOutDir`; `html5ifyAndLoad` (por donde pasan las tres rutas: conversión automática en `loadMedia`, conversión tras error de reproducción y la acción de menú) usa esa carpeta en lugar de `cod` si devuelve algo. La conversión por lotes (`convertFormatBatch`, no disponible en VideoMix) no cambia.
- `App.tsx` (3 cambios localizados): monta `usePreviewConversion`, pasa `getConversionOutDir` a `useHtml5ify` y en `loadMedia` busca primero en la caché y luego en la ubicación heredada. `ensureWritableOutDir`/`cod` y el resto de usos de `customOutDir` no cambian.
- Medio de prueba nuevo `mpeg4-640x360-5s.mkv` (MPEG-4 Part 2, que `willPlayerProperlyHandleVideo` marca como no reproducible) en `generateTestMedia.ts`, `e2e/run.ts` (lista de medios obligatorios) y la tabla de `06-entorno-desarrollo.md`.
- e2e `15` (describe propio, su propia app): dos copias del medio con el mismo nombre en carpetas distintas (copias en un temporal, para no escribir en `test-media/`). Proyecto sin guardar → el `-html5ified-dummy.mkv` aparece junto a la fuente; tras guardar, la segunda fuente se convierte en `.converted.vmx.cache/converted/<hash>/` y nada junto a ella; el reproductor muestra el convertido. Al reabrir, cada fuente vuelve a mostrar su convertido (la antigua el de junto a la fuente, compatibilidad; la nueva el de la caché) y ninguno se reescribe (mismo `ctime`; se usa `ctime` porque la conversión copia el `mtime` de la fuente).
- Manual (sección 2, fuentes, y 8.1, caché) y `04-diseno.md` (§ caché): nota breve.

**Decisiones**

- Hash: SHA-256 de la ruta tal cual (la ruta absoluta en uso de la fuente, que en memoria es `source.path`), sin normalizar mayúsculas en Windows; depende solo de la fuente, no del proyecto. 16 hex (64 bits) basta para evitar colisiones.
- Poda: los convertidos quedan fuera. `pruneRenderCache` solo mira los ficheros directamente dentro de las subcarpetas de la raíz (`converted/` solo contiene carpetas) y además con nombre de caché de render; lo cubre un test.
- **Proyecto → Vaciar caché de render** borra la raíz entera (T28), así que también borra `converted/`. Lo dejo así (no toco `useMixRender.ts`, que T41 está modificando): son ficheros regenerables y la acción es explícita para liberar espacio; se vuelven a crear al activar la fuente. Documentado en el manual. **Duda para el orquestador**: si se prefiere conservarlos, basta con que `userClearRenderCache` borre las entradas de la raíz menos `converted/`.
- Si no se puede crear la carpeta de caché (p. ej. carpeta del proyecto de solo lectura), se convierte en la ubicación heredada en vez de fallar.
- Punto 5 (guardar por primera vez o "Guardar como" después de convertir): no se mueve nada. Las conversiones hechas antes se siguen encontrando junto a la fuente (búsqueda heredada), y las nuevas van a la caché del proyecto actual. Tras "Guardar como" a otro nombre, la caché del nombre anterior no se copia: la próxima conversión de esa fuente se hará en la nueva caché (salvo que exista una junto a la fuente).
- El cierre de fichero de LosslessCut con "borrar temporales" (`cleanupFilesDialog`) sigue borrando `previewFilePath` esté donde esté; no se ofrece en VideoMix de forma habitual y no cambia.

**Ficheros tocados**

- Nuevos: `src/renderer/src/videomix/previewConversion.ts`, `previewConversion.test.ts`, `src/renderer/src/videomix/hooks/usePreviewConversion.ts`.
- Modificados: `src/renderer/src/App.tsx`, `src/renderer/src/hooks/useHtml5ify.tsx`, `src/renderer/src/videomix/hooks/useMixProject.ts`, `script/videomix/generateTestMedia.ts`, `e2e/run.ts`, `e2e/videomix.e2e.ts` (imports, helper `playerSrc` y el escenario 15), `docs/videomix/manual-usuario.md`, `docs/videomix/04-diseno.md`, `docs/videomix/06-entorno-desarrollo.md`.
- Hay que ejecutar `yarn generate-test-media` (sin `--force`) para generar el medio nuevo.

**Validación**

- `yarn tsc`: verde (en una pasada intermedia falló `render/renderEta.ts`, fichero en curso de T41; en la última pasada, verde).
- `yarn lint`: los únicos errores son de `test-results/t41diag/*.ts`, ficheros de diagnóstico de T41 (en `test-results/`, no del repo); mis ficheros pasan eslint sin avisos.
- `yarn test run`: 83 ficheros, 1000 tests en verde (una pasada con carga concurrente dio 1 fallo puntual que no se repitió).
- `yarn build`: verde.
- `yarn test-e2e`: 18/18 en verde (1,3 min). En pasadas anteriores, ejecutadas a la vez que las de T41 (compartiendo `out/` y `test-results/`), fallaron puntualmente el 8a (audio del preview en vivo) y una vez el 15 por un artefacto de traza desaparecido; el 15 pasa también suelto.

## Revisión

- **Resultado**: aceptada. Decisión del orquestador: "Borrar caché de render" conservará `converted/` (se hace en T43).
- **Validación del orquestador**: tsc, lint, 1000 tests y e2e 18/18.
