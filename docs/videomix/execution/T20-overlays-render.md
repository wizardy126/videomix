# T20 · Overlays: render de vídeo (PNG, contador, barra)

- **Hito**: M7 · **Modelo**: Opus · **Depende de**: T19 · **Estado**: hecha

## Objetivo

Dibujar las imágenes, los contadores y las barras de progreso sobre el vídeo final, en la previsualización y en el render.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §9.1
- [04-diseno](../04-diseno.md) §8.2 y §4
- [ADR-001](../decisiones/ADR-001-render.md): bloques, sumas planas de escalones y grafo en fichero
- Código: `render/buildVideoGraph.ts`, `buildRenderJob.ts`, `renderChunks.ts`, `verifyFilterGraph.ts` y el modelo y `resolveOverlayTimes` de T19

## Alcance

1. **Composición** sobre la salida de cada bloque (antes del *fade* global), con tiempo absoluto (`t + inicioDelBloque`), de modo que un elemento partido entre bloques salga continuo. Solo entran en el grafo de un bloque los elementos que lo tocan.
2. **PNG**: escala a la caja (px pares del fotograma de salida), *fade* in/out con alfa y `enable`. Orden de capas según el proyecto.
3. **Contador**:
   - `drawtext` con el formato automático (`SS` / `MM:SS`), 0–3 decimales, ceros a la izquierda, redondeo hacia arriba y desaparición en 0;
   - fuente del usuario o la incluida por defecto;
   - borde y sombra; tamaño de letra = altura de la caja × alto del fotograma.
   - Hay que resolver bien el escapado de `drawtext` y de las rutas de fuente en Windows (`:` y `\`).
4. **Fuente por defecto**: una fuente libre (licencia OFL, p. ej. Open Sans o Inter en TTF), en `resources`/`extraResources`. Hay que localizarla tanto en desarrollo como empaquetada, con una función en main o en `ffmpeg.ts`. Se añade su licencia a la carpeta de licencias o se menciona en las notas.
5. **Barra de progreso**: relleno animado en las cuatro direcciones y los modos llenar/vaciar, con fondo y borde, sin `if()` anidados.
6. **Bloques**: los elementos no obligan a cortar bloques. Hay que comprobar que las expresiones de tiempo son exactas en los cortes.
7. **Tests**:
   - snapshots de grafos con overlays y `verifyFilterGraph` ampliado;
   - test con ffmpeg real (320×180): PNG a mitad de *fade*, contador (lee el fotograma y comprueba que hay texto en la región) y barra al 50 % (mide el ancho de relleno por color). Se omite si falta ffmpeg.
8. **Mini vista del fotograma** (T15): dibujar las cajas de los elementos visibles en el instante (solo el contorno y el tipo). Si choca con T22, coordínalo y documéntalo en las notas.

## Criterios de aceptación

- Fotogramas revisados: PNG con transparencia, contador cerca del cero y barra a mitad de recorrido.
- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

### Resumen de cambios

- **`render/overlayFilters.ts`** (nuevo, puro): `buildOverlayFilters(overlays, ctx, cv)` añade las entradas y cadenas de los elementos visuales de un bloque. Tipo `VideoGraphOverlays = { overlays, times, defaultFontPath }` (`times` = el `Map` de `resolveOverlayTimes`).
- **`render/ffmpegArgs.ts`** (nuevo): `formatNumber` y `toFfmpegColor` salen de `buildVideoGraph.ts` (que los reexporta, sin cambios para los usos existentes) para evitar un import circular. `toFfmpegColor` acepta también `#rrggbbaa` → `0xrrggbbaa`. `escapeFilterValue` hace el doble escapado de textos y rutas.
- **`buildVideoGraph`** y **`buildRenderJob`**: parámetro opcional `overlays` (aditivo). Los elementos se componen después de columnas, rellenos y barras de separación y antes del *fade* global (que también los funde).
- **`overlays/overlayFrames.ts`** (nuevo, puro): fotogramas de un elemento, caja en px (pares, ≥ 2), valor y texto del contador, fracción de la barra y **`getVisibleOverlayBoxes`** para la mini vista.
- **`verifyFilterGraph`**: el parser respeta los escapes `\x` fuera de comillas (como `av_get_token`); nuevas `unescapeFilterToken` y `parseFilterOptions`; comprueba que `drawtext`/`overlay` con `enable` usan `between(t,a,b)` con `a < b`, y que `drawtext` lleva `fontfile`, `enable` y un texto con `%{…}` equilibrado.
- **`hooks/useMixRender.ts`** (mínimo): pasa `overlays: { overlays: project.overlays, times: overlayTimes, defaultFontPath }` a `buildRenderJob`, reutilizando el `overlayTimes` que ya calcula T21 con `soundDurations`. `prepare` comprueba también los ficheros de los elementos (imágenes, sonidos y fuentes, con `getOverlayFiles`) y la fuente incluida si algún contador la usa.
- **Main**: `getDefaultOverlayFontPath()` en `src/main/ffmpeg.ts` (expuesta por `remoteApiLegacy.ffmpeg` y reexportada en `renderer/src/ffmpeg.ts`).
- **`script/videomix/rendererImports.ts`**: resuelve subrutas de paquetes CommonJS sin extensión (`lodash/omit`, que usan los módulos de overlays), para que los scripts de desarrollo (y T23) puedan cargar `overlays/*`.
- **Docs**: `04-diseno` §8.2 con el diseño final.

### Fuente por defecto (añadido al repositorio)

- `resources/fonts/OpenSans-Bold.ttf`: Open Sans Bold estática, descargada de `https://raw.githubusercontent.com/googlefonts/opensans/main/fonts/ttf/OpenSans-Bold.ttf` (147 KB). `@fontsource/open-sans` solo trae woff/woff2, y no hay otra TTF en `node_modules`.
- `resources/fonts/OpenSans-OFL.txt`: su licencia (SIL OFL 1.1), de `…/googlefonts/opensans/main/OFL.txt`. Se empaqueta junto a la fuente.
- `package.json` → `build.extraResources` (común a todas las plataformas): `{ "from": "resources/fonts", "to": "fonts" }`.
- Localización: empaquetada, `process.resourcesPath/fonts/OpenSans-Bold.ttf`; en desarrollo, `path.resolve('resources/fonts/OpenSans-Bold.ttf')` (igual que `locales`, relativa al directorio de trabajo).
- Se eligió la variante **Bold**: con borde encima del vídeo se lee mejor que la Regular, y sus cifras son tabulares, así que el texto alineado a la derecha no baila.
- El `drawtext` de este ffmpeg (BtbN n8.0) tiene libfreetype; solo usa `fontfile` (no hace falta fontconfig).

### Decisiones

- **Tiempo en fotogramas**: inicio y fin con `round(t·fps)` (como el resto del render). El contador y la barra usan los fotogramas **sin recortar** (`rawStart`/`rawEnd`): un contador cortado por el final del vídeo no llega a 0, y una barra que empieza antes del vídeo aparece ya en parte llena.
- **Contador**: valor = `ceil(restantes · 10^d / fps)`, con `restantes = finRaw − (f0 + round(t·fps))`: son operaciones con enteros, así que el valor es exacto en cada fotograma (no depende de errores de coma flotante de `t`). Muestra `ceil(duración)` en el primer fotograma y desaparece al llegar a 0. El formato se decide **por valor mostrado**: `M:SS` mientras es ≥ 60 s y `SS` por debajo. Los ceros a la izquierda afectan al primer campo (`05`, `01:05`); los segundos en `M:SS` siempre llevan dos cifras. Separador decimal `.`.
  - El cambio de formato no usa `if()`: se generan hasta dos `drawtext` con su `enable`, y el fotograma del cambio se calcula en JS (`getCountdownSecondsFormatFrames`).
  - `fontsize = round(caja.alto · H)`; `x = cajaX + (cajaAncho − text_w)·{0, ½, 1}`; `y = cajaY + (cajaAlto − text_h)/2`. El *fade* de salida es `alpha = min(1, restantes / (fadeOut·fps))`.
  - El borde y la sombra se pasan de px de referencia a px de salida; un borde > 0 tiene al menos 1 px.
- **PNG**: se decodifica y escala **una vez** y se repite con `loop` (con `-loop 1` se decodificaría el PNG en cada fotograma). La base de tiempos de la imagen empieza en su inicio sin recortar, así los `fade` (`st` ≥ 0) son exactos en cualquier bloque. `-f image2 -pattern_type none` evita que un nombre con `%d` o `*` se interprete como secuencia. La imagen se estira a la caja (la UI puede ajustar la proporción, como dice T19).
- **Barra**: no se puede hacer con `drawbox` (sus `w`/`h` no se evalúan por fotograma) ni con `crop` (tampoco). Se compone en una capa RGBA del tamaño de la caja: fondo (admite alfa) → capa de relleno del tamaño interior desplazada por fotograma (`overlay … eval=frame:format=rgb`, que la recorta a la capa) → borde con `drawbox … replace=1`, que tapa lo que sobra del relleno. Fracción = `(f − inicioRaw)/(finRaw − inicioRaw)` (0 en el primer fotograma, igual que el contador), redondeada a px. Dirección: el relleno crece desde el lado de origen (`ltr` desde la izquierda, `btt` desde abajo…); `empty` es el complemento.
- **Escapado** (`escapeFilterValue`): nivel de opción entre comillas simples (`'` → `'\''`) y nivel de grafo con `\` delante de `\ ' [ ] , ;`. Cubre `C:\…`, `\\servidor\…`, `:` en rutas y el `%{eif:…:d:2}` del texto. Hay tests de ida y vuelta con el mismo algoritmo que `av_get_token`.
- **Bloques**: los elementos no cortan bloques. Se comprobó con ffmpeg real que el render en bloques de 1 s da **exactamente los mismos píxeles** (diferencia 0) que el de un solo bloque en las zonas de los elementos, con cortes a mitad de un PNG, un contador y dos barras.

### Mini vista del fotograma (punto 8)

`MixPlanView.tsx` es de T22, así que no se ha tocado. T22 debe usar:

```ts
getVisibleOverlayBoxes({ overlays: project.overlays, resolved, time, fps: settings.fps, width?: plan.width, height?: plan.height })
  → { id, type: 'image' | 'countdown' | 'progressBar', name, box /* 0..1 */, pixelBox? /* px del render */, layer }[]  // de abajo arriba
```

Usa el mismo redondeo a fotogramas que el render (un elemento que acaba en 3 s no se ve en el fotograma 90). Para mostrar el texto del contador en la vista puede usar `getCountdownTextAt(overlay, getOverlayFrames(resolved.get(id), fps), frame, fps)`.

### Tests

- `overlays/overlayFrames.test.ts`: redondeo del contador, formatos, fotograma del cambio `M:SS` → `SS` para 24–60 fps y 0–3 decimales, fracción de la barra, cajas en px y `getVisibleOverlayBoxes`.
- `render/overlayFilters.test.ts`: escapado de ida y vuelta, *snapshot* de un bloque con los tres tipos, orden de capas (bajo el *fade* global), solo los elementos del bloque y tiempos absolutos en un bloque intermedio, cambio de formato del contador, `buildRenderJob` y 10 planes aleatorios con elementos al azar pasados por `verifyFilterGraph`.
- `render/overlayFilters.ffmpeg.test.ts` (ffmpeg real, 320×180, salida `rawvideo` RGB sin codificar; se omite sin ffmpeg, medios o fuente): PNG a mitad del *fade* (½ verde + ½ fondo, y la mitad transparente sin cambios), contador con texto en su caja y nada fuera, desaparición en 0, barra al 50 % (40 de 80 px rojos) y barra vertical vaciándose (39 de 78 px, con borde), y píxeles idénticos entre 1 bloque y bloques de 1 s. Con `VIDEOMIX_OVERLAY_FRAMES_DIR=<dir>` guarda los fotogramas en PNG.

### Fotogramas revisados

Revisados a ojo (320×180 del test y 1280×720 con un logo PNG circular con alfa sobre `testsrc`): PNG a mitad del *fade* con la parte transparente intacta; contador cerca de 0 con decimales (`0.1`, `00.07`) y con `M:SS` (`1:15`, `1:13`), con borde y sombra; barra a mitad; y los fotogramas 29/30 y 59/60 a ambos lados de un corte de bloque (`1.6` → `1.5`, barra continua).

### Validación

`tsc`, `lint`, `test run` (525 tests) y `build` en verde para los ficheros de esta tarea. En el árbol compartido quedan errores de `tsc`/`lint` en ficheros de T22 en curso (`components/OverlayPanel.tsx`, `components/TmpExp.tsx`), ajenos a T20.

### Pendiente / dudas

- Los avisos de tiempo de `resolveOverlayTimes` (recortado, fuera del vídeo) no se añaden a la confirmación previa al render: sus textos y la UI son de T22 (§9.2 pide el aviso; se muestra en la vista Mix).
- Formato del contador por valor mostrado (`1:00` → `59`), no por duración total: es la lectura literal de §9.1. Si se prefiere mantener `M:SS` todo el contador cuando dura ≥ 60 s (`0:59`), es un cambio pequeño en `overlayFilters.ts` y `formatCountdown`.

## Revisión

- **Resultado**: aceptada. Lint y tests de T20 en verde, incluido el test con ffmpeg real píxel a píxel. Fuente Open Sans Bold (OFL) incluida en `resources/fonts`.
- **Decisión del orquestador**: si el contador empieza en ≥ 60 s, se mantiene `M:SS` durante toda la cuenta (`1:00` → `0:59` → … → `0:01`). Es más legible y no cambia de ancho. El cambio es pequeño; se hará en T23.
- Los avisos de tiempo de los overlays en la confirmación previa al render se hacen en T22 o T23.
