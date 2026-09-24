# T42 · Vídeos convertidos (html5ify) en la carpeta de caché del proyecto

- **Hito**: M10 · **Modelo**: Opus · **Depende de**: — · **Estado**: pendiente

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

## Revisión
