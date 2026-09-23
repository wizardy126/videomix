# T26 · v2: textos libres y presets globales (B1, B2)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T24 · **Estado**: hecha

## Alcance

1. **Render del overlay `text`** en `render/overlayFilters.ts`:
   - multilínea con alineación, usando `drawtext` con `textfile` o una línea por `drawtext` (hay que resolver bien el escapado);
   - borde, sombra y *fades*;
   - **animación de entrada**:
     - *slide*: `x`/`y` en función de `t` con *easing*;
     - *typewriter*: aparición carácter a carácter, con un `drawtext` por tramo o `enable` por prefijos, sin `if()` anidados.
   - Tests con ffmpeg real (se omiten si falta).
2. **Mini vista y UI**:
   - el texto se muestra en la mini vista (aproximado) y en la pista de Contadores y barras, que pasa a llamarse "Textos, contadores y barras";
   - panel de propiedades para el texto (área multilínea);
   - botón "Add text".
3. **Presets globales (B2)**:
   - se guardan en `configStore` (clave nueva, con migración y valor por defecto `[]`);
   - desde el panel de propiedades de un texto, contador o barra: "Guardar estilo…", "Aplicar estilo" (lista filtrada por tipo) y gestión (renombrar y borrar);
   - exportar e importar presets a un fichero JSON.
   - Un preset solo guarda propiedades de estilo, sin tiempos, anclajes ni textos.
4. **i18n**: español.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde. Fotogramas revisados de un texto multilínea, de *slide* a mitad y de *typewriter* a mitad.

## Notas de ejecución

### Resumen de cambios

- **Modelo (`fontSize`, decisión del orquestador en T24)**:
  - `textOverlayStyleSchema.fontSize?: number` (`src/common/videomix/overlayStyles.ts`): fracción del alto del fotograma. Es **aditivo y opcional**, sin migración: si falta (proyectos v3 guardados antes de T26), `getTextOverlayFontSize` lo saca de la caja como antes (las líneas llenan su alto). Está en el esquema de **estilo**, así que los presets de texto guardan el tamaño.
  - `overlays/textLayout.ts` (nuevo, puro): líneas, alto del bloque, `fitTextBox` y `getTextOverlayLayoutPatch` (cambiar texto, tamaño o interlineado devuelve el cambio + `fontSize` explícito + la caja ajustada: **la caja crece con las líneas y la letra no encoge**), centros de línea, pasos del *typewriter*, *easing* del *slide* y opacidad. Lo usan el render y la mini vista.
  - `createTextOverlay` crea el texto con `fontSize: 0.08` y la caja ajustada. `factories.getTextOverlayFontSize` se reexporta desde `textLayout`.
  - Validación: error `overlay-invalid-font-size` (`fontSize` ≤ 0 o no finito), con texto traducido en `renderDialogs.getIssueText`. Como las cajas, el esquema no lo limita.
- **Render** (`render/overlayFilters.ts`, `addText`; sustituye el `// todo` de T24): ver el diseño en `04-diseno` §9.1. Resumen: un `drawtext` por línea (`expansion=none`, texto literal con el doble escapado de T20), alineado por su `text_w` en la caja; vertical por métricas de la fuente (`y_align=font`, `y = centro − (font_a + font_d)/2`); `alpha` para los *fades*; *slide* con *ease-out* cúbico en `x`/`y`; *typewriter* con un `drawtext` por paso y su `enable`. Las opciones de fuente, color, borde y sombra se comparten con el contador (`textStyleOptions`).
  - **Truco del typewriter**: con alineación centrada o a la derecha, un prefijo dibujado solo se movería al crecer (su `text_w` cambia). Cada paso se dibuja como `prefijo\nlínea entera` con `line_spacing = 10·H`: la segunda línea queda muy por debajo del fotograma (no se ve) pero `text_w` pasa a ser el de la línea entera, y como `drawtext` alinea las líneas a la izquierda del bloque, el prefijo cae exactamente donde estará en la línea final. Comprobado con ffmpeg real (píxeles del texto parcial ⊂ píxeles del texto final).
  - Los espacios finales de cada línea no cuentan para la alineación; los iniciales sí. Las líneas vacías ocupan su sitio pero no generan `drawtext`. Pasos consecutivos que solo difieren en espacios se funden; caracteres que aparecen en el mismo fotograma no generan paso. Se cuentan grafemas (`Intl.Segmenter`), no unidades UTF-16.
  - `verifyFilterGraph`: no exige `%{…}` equilibrado en los `drawtext` con `expansion=none`.
- **UI**:
  - Carril "Textos, contadores y barras" (antes "Contadores y barras") y botón **"Add text"** (`useMixOverlays.userAddText`, texto "Your text" en el cursor).
  - Mini vista (`MixPlanView`): misma disposición que el render (líneas centradas en celdas del tamaño, bloque centrado en la caja), con *fades*, desplazamiento del *slide* y prefijo del *typewriter* en ese instante (la parte oculta conserva su hueco, así el prefijo está donde lo dibuja el render). Si el texto está seleccionado pero no se ve en ese instante, se muestra completo. Redimensionar la caja de un texto cambia su `fontSize` (sus líneas llenan la nueva altura), como el contador.
  - Panel (`OverlayPanel`): sección **Texto** con área multilínea (se aplica al salir o con Ctrl+Intro; Intro añade línea; Escape descarta), tamaño (% del alto), interlineado, color, fuente, alineación, borde, sombra, *fades* y sección **Animación de entrada** (ninguna, deslizar + lado, máquina de escribir, duración). Las filas de color/fuente y alineación/borde/sombra se comparten con el contador (`FontRows`, `OutlineRows`). En "Posición y tamaño" el texto no muestra "Alto" (sale de las líneas) y "pantalla completa" lo pone a todo el ancho y centrado, conservando su alto.
- **Presets (B2)**:
  - `Config.overlayStylePresets: OverlayStylePreset[]` (`src/common/types.ts`), por defecto `[]` en `configStore`. **Migración** en `configStore.init`: si la clave no es una lista o tiene entradas que no pasan `overlayStylePresetSchema`, se guardan solo las válidas (con aviso en el log).
  - `overlayStylePresets.ts` (renderer, puro): `createStylePreset` (solo `overlayStyleKeys`; fuente por ruta absoluta; tamaño del texto explícito), `getStylePresetPatch` (sustituye todo el estilo, también quita fuente o sombra que el preset no tenga; en un texto reajusta la caja), `sanitizeStylePresets`, `serializeStylePresets` / `parseStylePresetsFile`.
  - `hooks/useOverlayStylePresets.ts`: lee y escribe `configStore` por `@electron/remote` (como `useUserSettingsRoot`, sin tocarlo); cada cambio parte de la lista guardada, así nunca se pisan dos cambios. Exportar (diálogo de guardar, JSON) e importar (añade; ids repetidos renovados; entradas no válidas ignoradas; un fichero que no es de estilos da un error para el usuario).
  - `components/OverlayStylePresets.tsx`: en el panel de texto, contador y barra, sección **Estilo** con "Aplicar estilo…" (lista filtrada por tipo), "Guardar estilo…" (pide el nombre, `dialogs.askForStylePresetName`) y "Gestionar estilos…" (diálogo con renombrar, borrar, exportar e importar, agrupado por tipo). Aplicar un estilo es un paso de *undo* del proyecto; los presets en sí no se deshacen (son configuración global).
  - `useMixOverlays` devuelve también `withErrorHandling` para el panel (así `App.tsx` no cambia).
- **i18n**: `scan-i18n` y traducciones al español de las claves nuevas; la clave vieja "Countdowns and bars" se sustituye.
- **Docs**: `04-diseno` §9 (nota de `fontSize`) y nueva §9.1.

### Ficheros

Nuevos: `overlays/textLayout.ts` (+ test), `overlayStylePresets.ts` (+ test), `hooks/useOverlayStylePresets.ts`, `components/OverlayStylePresets.tsx`, `render/textOverlay.ffmpeg.test.ts`.
Modificados: `common/videomix/overlayStyles.ts`, `common/types.ts` (1 campo), `main/configStore.ts` (valor por defecto + migración), `overlays/factories.ts`, `project.ts` (+ test), `renderDialogs.tsx`, `render/overlayFilters.ts` (+ test), `render/verifyFilterGraph.ts`, `overlayTexts.ts`, `hooks/useMixOverlays.ts`, `components/MixPlanView.tsx`, `components/OverlayPanel.tsx`, `dialogs.ts`, `locales/{en,es}`.

### Tests

- `textLayout.test.ts`: líneas y grafemas, tamaño explícito o derivado, añadir una línea agranda la caja y conserva el tamaño (también en un texto sin `fontSize`), caja dentro del fotograma, centros de línea, *typewriter* (cuenta, inversa y pasos), *slide* y opacidad.
- `overlayFilters.test.ts`: un `drawtext` literal por línea con posiciones exactas (caracteres especiales de ida y vuelta), *fades* con fotogramas absolutos en un bloque intermedio, *slide* (x desde la izquierda, y desde abajo), *typewriter* (pasos, `enable` contiguos, `line_spacing`, misma `x` en todos), texto vacío; y textos al azar (con `'`, `%`, `{}`, `;`, `[]`, `\`, emoji, líneas vacías y las tres animaciones) en los planes aleatorios pasados por `verifyFilterGraph`.
- `overlayStylePresets.test.ts`: contenido del preset, aplicar y volver (quita fuente y sombra), no entre tipos, reajuste de la caja, lista guardada con basura, exportar/importar.
- `project.test.ts`: `overlay-invalid-font-size` y texto sin `fontSize` válido.
- `textOverlay.ffmpeg.test.ts` (ffmpeg real, 640×360, RGB sin codificar, texto localizado por diferencia con el render sin overlays): multilínea a la derecha (tres bandas, cada línea termina en el borde derecho de la caja, la más larga empieza más a la izquierda, nada fuera); *typewriter* a mitad (nada en el primer fotograma, píxeles del texto parcial ⊂ texto final, la segunda línea solo en su parte izquierda y con el mismo borde izquierdo); *slide* a mitad (a 1/8 del recorrido: 38–42 px del sitio final, nada en el primer fotograma); y **mismos píxeles** en bloques de 1 s que en un solo bloque, con cortes a mitad de las animaciones.

### Fotogramas revisados

Con `VIDEOMIX_OVERLAY_FRAMES_DIR` (640×360) y un render aparte a 1280×720 (texto centrado de 3 líneas con sombra a mitad del *fade in* y completo, texto alineado a la derecha deslizando desde abajo a 1/3 de su animación, y *typewriter* alineado a la izquierda con `¡ñandú!`): alineaciones correctas, líneas equiespaciadas con la misma base, *slide* a mitad y *typewriter* a mitad con los caracteres ya en su sitio final ("Hello" + "wo" en el centrado; "Typewrite" en el de la izquierda).

### Validación

`yarn tsc`, `yarn lint` (sin errores en mis ficheros; durante el trabajo aparecieron errores transitorios de T25/T27), `yarn test run` (54 ficheros, 623 tests, incluidos los de ffmpeg real) y `yarn build` en verde.

### Decisiones y dudas

- **Tamaño del texto en el preset**: se guarda (`fontSize` está en el esquema de estilo), a diferencia del contador, cuyo tamaño es la caja. Un "estilo de título" sin tamaño sería poco útil. No se guarda la caja (decisión de T24).
- **Arrastrar la caja cambia el tamaño**: en la mini vista, cambiar el alto de la caja de un texto recalcula `fontSize` para que las líneas la llenen (igual que el contador); cambiar el ancho no afecta a la letra. En el panel el alto no se edita: sale del tamaño y las líneas.
- **Recorrido del slide**: desde justo fuera del fotograma por el lado elegido (la caja entera fuera, o la línea si es más ancha que la caja), con *ease-out* cúbico. En la mini vista se aproxima con la caja.
- **Typewriter**: los caracteres aparecen de forma uniforme durante la animación; el primer fotograma muestra `floor(total / fotogramas)` caracteres (normalmente ninguno) y el último de la animación, todos. Los espacios cuentan como paso de tiempo pero no generan `drawtext`.
- **Glifos que faltan**: la fuente incluida (Open Sans) no tiene emoji; `drawtext` no los dibuja (no hay *fallback* de fuentes). Si hiciera falta, el usuario puede elegir otra fuente.
- **Mini vista**: usa la fuente del sistema; las posiciones horizontales son aproximadas, las verticales siguen el mismo modelo que el render.
- **Manual de usuario**: no se ha actualizado (la sección de overlays es de T23; lo dejo para el cierre de M8, T34).

## Revisión

- **Resultado**: aceptada. Textos multilínea, *slide* y *typewriter* verificados con ffmpeg real y revisión de fotogramas. Presets globales con exportar e importar. Los emoji no se dibujan con la fuente incluida; se acepta.
