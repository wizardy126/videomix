# T50 · v4: i18n, manual, e2e y cierre

- **Hito**: M11 · **Modelo**: Sonnet · **Depende de**: T44–T49 · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).

## Alcance

1. `scan-i18n` y revisión del español de todo lo nuevo.
2. **Manual**: indicador de encaje, imán y "Ajustar a"; copiar/pegar encuadre; bandas negras (botón y automático, ajuste); keyframes (Animar, auto-key, interpolaciones, atajos). Tabla de atajos.
3. Actualizar el estado en [07-propuestas](../07-propuestas.md) (A5, A7, A9, F1, F2 → ✅).
4. Revisar que los e2e de T45–T49 cubren lo acordado; proyecto de ejemplo con un clip animado renderizado y revisado (script en `script/videomix/`).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

### Resumen

- **Manual** (`docs/videomix/manual-usuario.md`): las tareas T45–T49 ya habían ido añadiendo, cada una, la sección correspondiente del manual (chips de encaje/imán/"Ajustar a" en §3, copiar/pegar encuadre en §3, bandas negras en §2/§3/§5, animar el encuadre en §3, filas de atajos en §9). Esta tarea es una **revisión de cierre**, no una redacción desde cero: he contrastado cada párrafo contra el código real (textos i18n de `locales/es/translation.json`, `data-testid`, atajos por defecto de `src/main/configStore.ts`) y no he encontrado discrepancias — nombres de botones, orden de los pasos y atajos coinciden exactamente. Solo he revisado que la tabla de atajos de §9 (`Ctrl/Cmd+Mayús+C/V`, `Mayús+,`/`Mayús+.`/`Mayús+Retroceso`) siguiera presente y correcta (T46 y T49 ya la habían completado). No ha hecho falta ningún cambio de contenido en el manual.
- **Traducciones**: comparé todas las claves de `locales/en/translation.json` contra `locales/es/translation.json` (script ad hoc). Las 133 claves sin traducción son todas del as-built de LosslessCut (P5: caen a inglés, no se tocan); ninguna de las claves nuevas de v4 (encaje, imán, "Ajustar a", bandas negras, keyframes, copiar/pegar encuadre) falta o quedó sin traducir. `yarn scan-i18n` no generó cambios.
- **07-propuestas**: A5, A7, A9 → ✅ v4 (con la tarea que las cerró); la nota fuera de catálogo de F1/F2 → ✅ (T44, T44b, T45).
- **Script de ejemplo** (`script/videomix/renderKeyframesExample.ts`, siguiendo el patrón de `renderChainsExample.ts`): proyecto de 3 clips sobre `test-media/` con las tres características de v4 pedidas:
  - un clip **animado** (A9): keyframes de paneo y zoom sobre `h-1080p-10s.mp4`, con las tres interpolaciones (`smooth` 0→2 s, `linear` 2→4 s, `hold` 4→6 s);
  - un clip **ajustado a 1/3 con la tolerancia** (F1/F2/T44b): `fitMaxRectToFraction` sobre una fuente 9:16 real (`v-1080x1920-12s.mp4`); como 1280/3 = 426,67 px no es entero, solo la tolerancia del 1 % (T44b) hace que `getClipFractionFits` (el indicador F1) devuelva "encaja" en vez de "no encaja";
  - un clip con **bandas negras quitadas** (A7): `cropdetect` real por ffmpeg (mismo patrón que `src/main/videomix/blackBars.ts`) sobre `h-bars-1280x960-6s.mp4`, seguido de `cropDetectToDisplayRect` → `getPictureRect` → `removeBlackBarsFromRects`, igual que el botón "Quitar bandas negras".
  - El script comprueba con aserciones (no solo revisión visual): la detección de bandas da el rectángulo esperado (±8 px), el ajuste a 1/3 hace que F1 lea "encaja", el plan resultante no tiene aviso `fill` (relleno) y la columna del clip ajustado mide lo esperado (±8 px de 1280/3), el keyframe `hold` mantiene el encuadre del instante 4 s hasta el 6 s, y por último ffprobe confirma la resolución y duración del render. Escribe 4 fotogramas (`frame-*.png`) para revisión manual, que he mirado: se ve el paneo/zoom del clip animado y la ausencia de bandas negras en el tercer clip.

### Decisiones y desviaciones

1. **Los tres clips no comparten fila simultáneamente**: al principio intenté que los tres clips se vieran a la vez en 3 columnas (como pide "asserting the plan"), pero dos de los tres clips tienen proporción **rígida** 16:9 (el clip animado, sobre el fotograma completo de una fuente 16:9; el de bandas quitadas, cuyo contenido es 1280×720, también 16:9): un clip rígido 16:9 a la altura del lienzo (720 px) necesita 1280 px de ancho — el lienzo entero —, así que el planificador nunca los mete en una columna estrecha junto a otros. Les añadí un **rectángulo mín. más estrecho** (igual que haría un usuario editando el encuadre) para darles el margen de proporción que necesitan para compartir fila; con eso el planificador decide su propio reparto (aquí, 2 columnas casi todo el tiempo, con el tercer clip sustituyendo al animado cuando este termina), que es un resultado igual de válido y real. Las aserciones se ajustan a lo que el planificador decide (sin exigir "3 columnas simultáneas"), no a una disposición prefijada a mano.
2. **Detección de bandas negras con ffmpeg propio, no `src/main/videomix/blackBars.ts`**: ese módulo usa `runFfmpeg` de main (rutas y `AbortSignal` de Electron), no apto para un script de Node suelto; repliqué el mismo patrón de muestreo (unas pocas muestras con *seek*, `cropdetect`, 30 fotogramas) con el `spawn` ya usado por los demás scripts de `script/videomix/`, reutilizando el parser puro y compartido (`src/common/videomix/cropDetect.ts`).
3. **Sin música ni overlays**: como `renderChainsExample.ts`, todos los clips van silenciados (sin medir sonoridad) porque el objetivo es la geometría/temporización, no el audio.

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (93 ficheros, 1136 tests, sin cambios: no se tocó código de producción), `yarn build` y `yarn test-e2e` (22/22) en verde.
- `node script/videomix/renderKeyframesExample.ts` en verde (todas las aserciones pasan); fotogramas revisados a mano con la herramienta de lectura de imágenes.

### Dudas para el orquestador

Ninguna.

## Revisión

- **Resultado**: aceptada. M11 cerrado.
