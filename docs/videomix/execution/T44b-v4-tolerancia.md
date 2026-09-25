# T44b · v4: tolerancia de encaje del 1 % sin deformar

- **Hito**: M11 · **Modelo**: Opus · **Depende de**: T44 · **Estado**: hecha

## Objetivo

Hoy un clip sin rectángulo mín. tiene **un único ancho posible** (`getWidthRange` colapsa a un par), y el planificador trabaja con píxeles pares exactos. Si la celda de una fracción no es un par exacto (p. ej. 1/3 de 1280 px, o según la separación), ese clip no encaja nunca del todo: quedan 2–4 px de relleno o se amplía con E7. Es lo que el usuario sufre "por unos pocos píxeles".

**Decisión del usuario**: tolerancia del **1 %** en la proporción. El desajuste se absorbe, **en este orden de preferencia**:

1. **Recortar dentro del máx.** en el eje secundario (p. ej. quitar ~1 % de alto, repartido arriba y abajo, y escalar esa imagen un ≤ 1 %), o en el principal si sobra ancho. Sin deformar y sin mostrar nada fuera del máx. No es posible si el mín. toca ese borde.
2. Si no, **ampliar unos píxeles fuera del máx.**, si la fuente tiene material y el clip permite "Ampliar más allá del máx." (E7).
3. Solo si nada de eso es posible, **estirar como mucho un 1 %** (lo que ya hace hoy `getCropForAspect` dentro de `ASPECT_TOLERANCE`).

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.2, §11 (E7) y §12, [03-convenciones](../03-convenciones.md), [04-diseno](../04-diseno.md) (§3, §10 de T44).
- `geometry.ts` (`ASPECT_TOLERANCE`, `getAspectRange`, `getWidthRange`, `distributeWidths`, `getCropForAspect`, `getExtendedCropForAspect`, `getExtensionRoom`), `planner/` (`planMix.ts`, `extendPlan.ts`, `validatePlan.ts`), `fitFractions.ts` (T44), `render/buildVideoGraph.ts`, `preview/previewDraw.ts`, `thumbnails.ts`.
- Notas de ejecución de T44 (contratos de `fitFractions`) y T38b (E7).

## Alcance

1. **Rango de anchos con tolerancia**: el planificador (`getWidthRange`/`distributeWidths` o donde encaje mejor) acepta anchos cuya proporción se desvía hasta un 1 % del rango del clip. Prefiere siempre los anchos dentro del rango exacto: la tolerancia solo se usa cuando sin ella quedaría relleno o sería inviable (documenta cómo se garantiza). Tests, incluido el caso de tres clips 9:16 sin mín. en 1280×720 y 1920×1080 con y sin separación, que deben quedar **sin relleno**.
2. **Recorte con desajuste** (`getCropForAspect` y la versión extendida de E7): implementa el orden 1 → 2 → 3 con la función pura que decide el recorte para una celda, devolviendo también qué estrategia usó. Siempre rectángulos pares, dentro del fotograma, conteniendo al mín.
3. **Coherencia**: render, previsualización en vivo y miniaturas usan esa misma función, así que salen iguales. El indicador de encaje de T44 (`fitFractions`) cuenta como ✓ lo que entra con la tolerancia (y como ↔ si necesita ampliar más allá de lo que da la tolerancia). "Ajustar a" y el imán siguen apuntando a la proporción exacta.
4. **Impacto en proyectos existentes**: los planes pueden cambiar ligeramente (se rehacen los bloques de caché afectados). Documéntalo. Revisa y actualiza los snapshots afectados justificando cada cambio en las notas, sin aceptar cambios a ciegas.
5. **Test con ffmpeg real**: tres clips 9:16 sin mín. en 1280×720 → sin columnas de relleno (comprobación por píxeles) y sin deformación apreciable.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde; `yarn test-e2e` en verde.
- [04-diseno](../04-diseno.md) actualizado (tolerancia y orden de estrategias).

## Notas de ejecución

### Resumen

- **Geometría** (`geometry.ts`, 04-diseno §2.7 nueva, §2.2, §2.4, §2.5):
  - `getTolerantWidthRange(range, H)`: anchos pares `[ceilPar(aMin·0,99·H), floorPar(aMax·1,01·H)]` (unidos a los de `getWidthRange`); son exactamente los anchos a los que `getCropForAspect`/`getColumnFit` dan `fill`.
  - `distributeWidths`: el caso factible con los límites exactos es **idéntico** al de antes (el reparto se ha extraído a `spreadWidths` sin cambios). Solo si quedaría relleno o la fila no cabe, **y la tolerancia lo resuelve del todo**, los clips salen de su intervalo: desde sus anchos máx. (o mín.) y solo los px necesarios, repartidos en proporción al margen de tolerancia de cada uno (mayor resto, pares). Si no lo resuelve, devuelve lo de antes (máx. + relleno, o `undefined`).
  - `getCropForAspect` devuelve `{ crop, fit, strategy }` (`CellCrop`, `CropStrategy = 'none' | 'crop' | 'extend' | 'stretch'`). Dentro de la tolerancia y fuera del intervalo: clip **sin mín.** → `crop` (pierde ≤ 1 % en el eje del desajuste, centrado en el máx., escala uniforme); clip **con mín.** → `stretch` (recorte del límite, como antes). `none` si el redondeo par del tamaño ya cubre el desajuste, si está dentro del intervalo o si es pillarbox/letterbox. Dentro del intervalo el resultado es el mismo de siempre.
  - `getExtendedCropForAspect`: además del pillarbox/letterbox, convierte un `stretch` en `extend` si la colocación tiene `extendedMaxRect` en ese eje (celda más ancha en columnas, más alta en filas: la transpuesta). Devuelve también `strategy`.
- **Orden 1 → 2 → 3**: (1) lo decide `getCropForAspect` (solo necesita los rectángulos); (2) lo prepara `extendPlan` (`getNeededExtension` pide ampliación también cuando la celda quieta daría `stretch` hacia el eje principal, unos pocos px) y lo aplica `getExtendedCropForAspect` con el `extendedMaxRect` del plan; (3) es lo que queda. Un clip sin mín. nunca llega a 2 ni a 3 dentro de la tolerancia, porque 1 siempre es posible.
- **Planificador** (`planMix.ts`): `Clip.tolerantWidths`; las cotas de poda de T38c usan los anchos tolerados (inviable si Σ mín. tolerados > útil; relleno mínimo 0 si Σ máx. tolerados ≥ útil, si no el de los máx. exactos), así que siguen siendo exactas; `getFitKey` (E8) cuenta como encaje lo que entra con la tolerancia (como la sustitución directa, que ya la usaba). Las decisiones de puntuación no cambian.
- **Avisos** (`planWarnings.ts`): sin cambios de lógica. Una celda dentro de la tolerancia que usa la ampliación (`strategy: 'extend'`) **no** genera el aviso `extended`; solo lo generan las celdas con pillarbox/letterbox que E7 amplía (más allá de la tolerancia), como antes. El `extendedMaxRect` sí está en la colocación, así que render y previsualización muestran esos px.
- **Encaje** (`fitFractions.ts`): `fits` con la tolerancia; `extends` = necesita E7 más allá; `missing`/`excess` son lo mínimo para encajar con la tolerancia (~1 % menos que antes). Parámetro nuevo `exact` (sin tolerancia). "Ajustar a" sigue ajustando hacia el encaje exacto (el bucle de ±2 px usa `exact`) y solo da `min-too-large` si ni con la tolerancia encaja; el imán no cambia (proporción exacta de la celda).
- **Coherencia**: render (`buildVideoGraph`), previsualización en vivo (`previewDraw.getClipCellDraw`) y avisos usan la misma función con el mismo `extendedMaxRect`, sin cambios en esos ficheros. Las miniaturas recortan el máx. entero (no dependen de la celda): no cambian.
- **Docs**: 04-diseno §2.7 (nueva: tolerancia y orden de estrategias) y retoques en §2.2, §2.4, §2.5, §3.3, §3.8, §3.9 y §10.2 (se quita la "limitación" de los clips rígidos).

### Decisiones

1. **La tolerancia solo se usa si elimina todo el relleno** (o hace caber la fila). Primero probé a usarla también para reducir un relleno que igualmente iba a quedar (p. ej. tres 9:16 de verdad en 1920×1080: 96 → 84 px), pero recortaba los clips sin quitar el relleno, interfería con E7 (que convierte ese relleno en material) y cambiaba muchos más planes. Es lo más conservador y lo que pide el objetivo ("por unos pocos píxeles").
2. **Estrategia 1 (recortar dentro del máx.) solo para clips sin mín.** Con mín., el recorte en el límite del intervalo ya ocupa todo el mín. en el eje del desajuste (`aMax = M.w / m.h`, `aMin = m.w / M.h`), así que recortar más siempre cortaría el mín.: es el caso "el mín. toca ese borde". Sin mín. (mín. = máx.), el máx. entero es lo deseado pero no un límite duro, y el requisito pide recortar ~1 %. Un mín. explícito igual al máx. cuenta como mín. (límite duro): no se recorta.
3. **Estrategia 2 solo en el eje principal** (el de E7) y solo con `extendBeyondMax` y material: una celda algo más estrecha que el mín. en columnas (o más baja en filas) no se puede resolver ampliando en ese eje, así que se estira ≤ 1 %.
4. **Aviso `extended`**: decidido por el usuario (vía orquestador) tras la primera entrega: los pocos px que amplía la tolerancia **no** se avisan (sustituyen a un estiramiento ≤ 1 %); solo las ampliaciones de E7 más allá de la tolerancia. En la primera versión sí se avisaban.
5. **"Tres clips 9:16 sin mín."**: un 9:16 de verdad mide 405 px a 720 (607,5 a 1080) y una tercera parte de 1280 son 426,67 px: un 5 % de diferencia, fuera de la tolerancia del 1 % (queda relleno, o lo cubre E7 como antes). Lo he interpretado como **clips de fuentes 9:16 (y 16:9) ajustados a 1/3 con "Ajustar a"** (proporción ≈ 9:16, la del tercio), que es el caso del objetivo ("por unos pocos píxeles"). Test explícito de que los 9:16 exactos siguen igual (`geometry.test.ts`).
6. **Reparto de la tolerancia** en proporción al margen de cada clip (su ancho × 1 %), con mayor resto: con tres iguales, un clip recibe 428 px y los otros 426 (no se pueden repartir 2 px entre tres con anchos pares).
7. **Recorte par**: 2 px no se reparten en mitades pares, así que el corte de un eje puede ir entero a un lado (p. ej. `crop=1078:1920:2:0`); con 4 px o más, a los dos.

### Impacto en proyectos existentes

- Los planes solo cambian donde antes quedaba relleno (o una fila no cabía) por menos de un 1 % por clip, y los recortes solo cambian en celdas que antes se estiraban. Los bloques de la caché de render cuyo grafo cambia se vuelven a renderizar solos (la clave es el contenido del grafo, T28); no hace falta cambiar `RENDER_CACHE_VERSION`.
- Medido con 3000 proyectos aleatorios (3–14 clips, fuentes 16:9/9:16/1:1/4:3/4K, rectángulos enteros, aleatorios y con mín., E7 al 50 %, salidas 16:9, 9:16 y 1:1, separación 0–12, 2–4 columnas, ventana 0–5), comparando el planificador de `HEAD` con el nuevo: **2700 planes idénticos**; de los 300 que cambian, 293 tenían relleno, pillarbox o letterbox, 3 una ampliación E7, y 4 solo difieren en detalles derivados (un factor de upscale 2,33 → 2,34 por el recorte del 1 %; un keyframe que antes solo servía para quitar un relleno oculto por E7). En esos 300: relleno × tiempo −13 %, pillarbox/letterbox 696 → 687, keyframes 2029 → 2014.

### Snapshots y tests existentes que cambian (revisados uno a uno)

- `buildRenderJob.test.ts.snap`:
  - *removal plan*, `chunk-0000`: el clip rígido 9:16 `e` (1080×1920) en una columna de 202×360 (0,5611 frente a 0,5625, −0,25 %): antes `crop=1080:1920:0:0` estirado; ahora `crop=1078:1920:2:0` (2 px de ancho a un lado) con escala uniforme.
  - *removal plan*, `chunk-0001`: el mismo clip en la capa que encoge: el primer fotograma usa ese recorte, así que la escala de la unión es 204 px constante (antes 202 → 204) y el primer fotograma deja fuera de la ventana 2 px por la derecha en vez de estirar. Diferencia sub-píxel.
  - *fills plan*, `chunk-0001`: el cuadrado rígido `d` en el último fotograma de la animación (≈ 361,3×360, +0,4 %): ahora se recorta ~2 px de alto y escala uniforme (`h` 360 → 362 en ese fotograma) en vez de estirar en horizontal.
- `buildVideoGraph.test.ts` (giros E9): el máx. rígido 1080×920 en una celda de 360×306 (+0,2 %) se recorta a 918 (`crop=918:1080:202:0` en 90°, `crop=1080:918:840:160` en 180°, `crop=918:1080:800:0` en 270°) en vez de estirarse; 1080/918 = 360/306 exacto. Lo que prueba el test (recorte en el fotograma sin girar y giro solo del recorte) no cambia.
- `planMix.test.ts` (*clips ending less than D apart*): 1296 + 608 dejaban 16 px de relleno (0,8 %); ahora 1308 + 612 sin relleno (dos rígidos recortados < 1 %).
- `fitFractions.test.ts`: `missing`/`excess` con la tolerancia (1920 → 646 en vez de 640, 40 → 34, 160 → 154, 56 → 48); los valores de antes se comprueban con `exact: true`.
- `geometry.test.ts`: los `toEqual` de recortes llevan `strategy`; la propiedad aleatoria de `getCropForAspect` distingue `crop` (sin mín., ≤ 1 % + redondeo, centrado, más cerca de la proporción pedida que el máx. entero) del resto; la de `distributeWidths` comprueba los límites tolerados y que la tolerancia solo aparece cuando los exactos dejarían relleno o no cabrían, y nunca con relleno restante.
- Sin cambios: los snapshots del planificador (`planMix`, `linksLimit`, `pinsGroups`, `reorderWindow`, `extendPlan`) y del resto de grafos.

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (90 ficheros, 1094 tests, con los de ffmpeg real), `yarn build` y `yarn test-e2e` (18) en verde.
- Tests nuevos:
  - `geometry.test.ts`: límites tolerados (y que son los que `getCropForAspect` llena); tres rígidos ajustados a 1/3 en 1280×720 (fuente 16:9: 428/426/426; fuente 9:16 720×1280 → 720×1214, que antes no cabía), con separación, y 1920×1080 con separación 6 y 8; que un relleno que no se cubre del todo (9:16 reales) y un reparto exacto no cambian; estrategias `crop` (ancho y alto, centrado), `stretch` (con mín., también mín. = máx.), `none` bajo el redondeo, `extend` con E7 (y transpuesta en filas; un clip sin mín. recorta en vez de ampliar; una celda más estrecha se estira).
  - `planner/tolerance.test.ts`: tres clips sin mín. ajustados a 1/3 de 4 fuentes (16:9 y 9:16, 1080p y 720p) en 1280×720 y 1920×1080 con separación 0, 4, 5, 8 y 10, con y sin E7: sin relleno, sin avisos, sin ampliación, recorte con la proporción de la celda (< 0,2 %) y que pierde < 1,2 % del área; lo mismo en filas (720×1280); clips con mín.: con E7, 2 px fuera del máx. sin aviso `extended`; con E7 y celdas de 640 px (ampliación real, > 100 px) sí hay aviso para cada clip; sin E7, estiramiento ≤ 1 % y sin relleno.
  - `fitFractions.test.ts`: "Ajustar a 1/3" de un clip sin mín. a 1280 da ✓ con tolerancia y no exacto (fuentes 16:9 y 9:16); propiedad aleatoria sin mín.; con mín., el resultado sigue siendo exacto salvo < 2 % de casos.
  - `previewDraw.test.ts`: la previsualización en vivo dibuja el mismo recorte que el render (`1078:1920:2:0`) en la celda entera.
  - **ffmpeg real** `render/tolerance.ffmpeg.test.ts`: tres clips sin mín. ajustados a 1/3 de 1280×720, E7 desactivado, de una fuente 9:16 (1080×1822 de 1080×1920) y de fuentes 16:9 (640×1080 y 426×720). Antes de T44b los anchos exactos no sumaban 1280 (comprobado). Ahora la fila no tiene relleno, **ninguna columna del fotograma renderizado es de color de relleno** (#ff8000, comprobación por píxeles), cada recorte tiene la proporción de su celda (< 0,2 %: escala uniforme) y cada celda coincide con ese recorte hecho por ffmpeg directamente (diferencia media 0,01–1,6) y con una referencia independiente sin deformación: el máx. escalado uniformemente para cubrir la celda, centrado y cortado (0,01–4,3; el máximo sale del recorte par de 2 px a un solo lado). Con `VIDEOMIX_TOLERANCE_FRAMES_DIR` escribe los fotogramas: los revisé (tres columnas de barras de color, sin franjas). La diferencia con un estiramiento de ≤ 1 % no se puede medir con las barras verticales de los medios de prueba, así que no se afirma (la ausencia de deformación queda garantizada por la proporción del recorte).
- **e2e**: `8b. a render can be cancelled from its progress dialog (T41)` fallaba siempre en este entorno, **también en `HEAD` sin mis cambios** (copia con `git archive` compilada y ejecutada aparte): justo después de "Render anyway", el SweetAlert de confirmación está aún desvaneciéndose (`swal2-hide`, z-index 1060) sobre el diálogo de progreso cuando se comprueba `isOnTop`. Cambio mínimo en `e2e/videomix.e2e.ts`: `expect.poll(async () => isOnTop(dialog)).toBe(true)` (sigue detectando un diálogo tapado por la previsualización en vivo, que es lo que protege). Dos pasadas completas en verde.

### Dudas para el orquestador

Resueltas por el orquestador: (1) la interpretación de "tres clips 9:16" (decisión 5) es correcta, sin cambios; (2) los px de la tolerancia no se avisan (decisión 4, aplicado).

## Revisión

- **Resultado**: aceptada. Sin aviso "ampliado" para los píxeles de la tolerancia (decisión del orquestador). El ajuste del e2e 8b (espera con `expect.poll` a que se desvanezca la confirmación) se acepta.
- **Validación del orquestador**: tsc, lint, 1095 tests y e2e 18/18.
