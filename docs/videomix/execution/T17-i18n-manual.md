# T17 · i18n (es), atajos y manual de usuario

- **Hito**: M5 · **Modelo**: Sonnet · **Depende de**: T16 · **Estado**: hecha

## Objetivo

Dejar la UI de VideoMix traducida al español, los atajos revisados y un manual de usuario.

## Contexto (leer antes de empezar)

- [03-convenciones](../03-convenciones.md) §7

## Alcance

1. Ejecuta `yarn scan-i18n` y traduce al español en `locales/es/translation.json` **todas** las claves nuevas de VideoMix. Revisa también que las claves de LosslessCut que siguen visibles tengan traducción.
2. Revisa el diálogo de atajos (`KeyboardShortcuts.tsx`): que las acciones nuevas aparezcan con nombre y categoría.
3. Escribe `docs/videomix/manual-usuario.md` en español: crear un proyecto, añadir fuentes, crear clips (tiempo y rectángulos máx./mín.), orden, ajustes de montaje, previsualizar y montar, música y atajos.

4. **Pendientes de T16** (ver sus notas):
   - Ocultar los enlaces de ayuda específicos de LosslessCut (How to use, FAQ, Troubleshooting, Learn more, reporter de errores). "Source code" pasa a `https://github.com/wizardy126/videomix` y se añade "User manual" al manual del punto 3, que abre el fichero en GitHub. "Licenses" se mantiene.
   - "Open folder": añadir solo ficheros de vídeo (sin imágenes).
   - Renombrar a VideoMix los textos visibles que aún dicen LosslessCut ("Quit LosslessCut", "Allow multiple instances of LosslessCut", etc.). Se cambia la clave en inglés y la traducción al español; los demás idiomas caen a inglés.
   - Añadir "Split clip" (acción existente `splitCurrentSegment`, que en VideoMix divide el clip) al menú Project.

## Criterios de aceptación

- Con el idioma en español, la UI de VideoMix no muestra textos en inglés.
- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

### i18n (es)

- `yarn scan-i18n` no dio ninguna clave nueva de partida (el árbol ya estaba extraído); se volvió a ejecutar tras los cambios de este task-doc (renombres, "Split clip", "User manual") y `locales/en/translation.json` quedó actualizado (las claves viejas `"Quit LosslessCut"` y `"Allow multiple instances of LosslessCut..."` se sustituyen automáticamente por las nuevas: el extractor sí purga claves que ya no aparecen en el código).
- **Comprobación de claves alcanzables**: en vez de traducir las ~177 claves que le faltaban a `locales/es/translation.json` frente a `en`, se comprobó cuáles son realmente alcanzables en modo VideoMix (la mayoría son funciones de LosslessCut ocultas por T16: pistas, export sin pérdidas, EDL, detección de escena, generación/selección/expresiones de segmentos, lote/concat, `ExportConfirm`/`ConcatDialog`/`StreamsSelector`/`WhatsNew`, que no se montan). Para eso se cruzó la lista de claves que faltan con los `t('...')`/`i18n.t('...')` reales de `KeyboardShortcuts.tsx`, `Settings.tsx`, `mifi.ts`, `GenericDialog.tsx`, `TopMenu.tsx`, `BottomBar.tsx`, `NoFileLoaded.tsx`, `App.tsx`, `dialogs/index.tsx`, `menu.ts` y todo `videomix/`. Se tradujeron las que sí son alcanzables (atajos de segmentos que sobreviven como "clip" — saltos, dividir, quitar punto de corte —, "Toggle dark mode", "Read all keyframes", "Source code", "Success!" del diálogo de fin de render, el aviso de FFmpeg no funcional al arrancar, etc.); quedan 141 claves sin traducir, todas de funcionalidad oculta. El script de comprobación fue un one-off en `/tmp` (no se ha guardado en `script/videomix/`: es una comprobación puntual, no una herramienta reutilizable).
- Renombradas (clave inglesa + traducción es; el resto de idiomas cae a inglés, como pide 03-convenciones §7):
  - `"Quit LosslessCut"` → `"Quit VideoMix"` (diálogo de atajos).
  - `"Allow multiple instances of LosslessCut to run concurrently? (experimental)"` → `"Allow multiple instances of VideoMix to run concurrently? (experimental)"` (Ajustes avanzados).
- No se ha tocado `reporting.tsx` (menciona "LosslessCut"/Discord/GitHub discussions de mifi): con "Report an error" oculto del menú (ver más abajo) solo queda alcanzable si el usuario asigna manualmente un atajo a `openSendReportDialog` (que sigue en el diálogo de atajos, sin acción por defecto) o si falla ffmpeg al exportar/concatenar (rutas que tampoco existen en VideoMix). Se ha dejado fuera de alcance por ser un caso residual de LosslessCut; si se quiere cubrir del todo habría que reescribir ese texto para VideoMix.

### Diálogo de atajos (`KeyboardShortcuts.tsx`)

- Ya tenía nombre y categoría "Project" (traducida "Proyecto") para las acciones de T05/T07/T13: `newProject`, `openProject`, `saveProject`, `saveProjectAs`, `addSourcesDialog`, `addClip`, `duplicateCurrentClip`, `removeCurrentClip`, `showMixSettings`, `previewMix`, `renderMix`. No hizo falta ningún cambio ahí; solo se revisó que ninguna acción nueva de T14/T15/T16 quedara sin nombre (T14 no añadió `KeyboardAction`, T15 tampoco, T16 solo ocultó acciones existentes).

### Pendientes de T16 (punto 4 del alcance)

- **Enlaces de ayuda**: en `menu.ts`, "How to use", "FAQ", "Troubleshooting" y "Learn More" pasan a `llcOnly(...)` (ocultos en VideoMix). "Report an error" (el reporter de errores) también, junto con "Feature request" que ya estaba oculto (se agruparon en un mismo `llcOnly` con el separador). "Licenses" se mantiene sin cambios.
  - `githubUrl` (`src/common/constants.ts`) pasa de `https://github.com/mifi/lossless-cut/` a `https://github.com/wizardy126/videomix/`; lo usan "Source code" (este menú) y el panel "About" (`aboutPanel.ts`), que con ello también apunta al repo de VideoMix.
  - Se añade "User manual" (clave nueva, traducida) entre "Keyboard & mouse shortcuts" y el bloque oculto de "Report an error"/"Feature request"; abre `userManualUrl`, un enlace `blob` de GitHub a `docs/videomix/manual-usuario.md` en la rama de desarrollo actual (`claude/videomix-analysis-planning-97c8lp`, 01-requisitos §8 W1). **Duda para el orquestador**: si esta rama se fusiona a `main` u otra, hay que actualizar `userManualUrl` a mano (no hay redirección automática a la rama por defecto de GitHub para un `blob` concreto).
- **"Open folder"**: `classifyOpenedPaths` (`videomix/workspace.ts`) trata las extensiones de imagen (`jpg`, `jpeg`, `png`, `gif`, `bmp`, `webp`, `tif`, `tiff`, `heic`, `heif`, `avif`, `svg`) como `unsupportedPaths` en vez de `mediaPaths`: ya no se añaden como fuentes de vídeo (ni al soltarlas sueltas ni al leer una carpeta recursivamente). Con imágenes de por medio sale el mismo toast "Estos ficheros no se pueden usar como fuentes" que para un `.llc`/`.csv`. Test nuevo en `workspace.test.ts`.
- **Renombrar "LosslessCut" → "VideoMix"**: ver la sección de i18n arriba (`"Quit LosslessCut"` y el ajuste de "Allow multiple instances..."). Se revisó todo el árbol (`grep -rn LosslessCut src`) y no queda ningún otro texto de UI con "LosslessCut" alcanzable en modo VideoMix; el resto son o bien código/comentarios (fuera del alcance de este punto) o texto dentro de componentes que T16 dejó sin montar (`ExportConfirm`, `WhatsNew`, `ConcatDialog`, `StreamsSelector`) o rutas que no se disparan en VideoMix (`reporting.tsx`, ver arriba).
- **"Split clip"**: añadido al menú Project (entre "Add videos..." y "Mix settings...", con separadores), reutilizando la acción existente `splitCurrentSegment` (igual que hace la tecla `B`; en VideoMix ya divide el clip, no crea segmentos nuevos).

### Manual de usuario

- `docs/videomix/manual-usuario.md`: crear/abrir/guardar proyecto y recuperación; añadir fuentes (vídeo, carpeta, música); crear clips (I/O, N, B, Retroceso, duplicar/eliminar) y sus rectángulos máx./mín.; la lista de clips (nombre, color, mute, ganancia, avisos, reordenar); orden de montaje; ajustes de montaje (las 5 secciones de T14); la pestaña "Montaje" del plan (T15); previsualizar/renderizar (T13) con sus avisos; tabla de atajos con los valores reales de `configStore.ts` (solo los que sobreviven a `retiredKeyboardActions`); y una nota sobre qué ajustes generales se mantienen. No se documenta nada que no esté implementado (p. ej. no se menciona el ajuste manual del plan, fuera de alcance de v1 por 01-requisitos §9).
- El manual usa la terminología exacta de la UI en español (comprobada contra `locales/es/translation.json`): "Ajustes de montaje", "Vista previa"/"Renderizar" (botones cortos de la barra inferior) vs. "Previsualizar el montaje"/"Renderizar el montaje..." (menú Project), "Localizar...", "Fichero no encontrado", etc.

### Validación

- `yarn tsc`: sin errores.
- `yarn lint`: sin errores (solo los avisos preexistentes de `jsx-ast-utils` sobre `TSSatisfiesExpression`, ajenos a esta tarea).
- `yarn test run`: 36 ficheros, 414 tests en verde (1 nuevo: filtrado de imágenes en `classifyOpenedPaths`).
- `yarn build`: OK.
- No se ha podido ejecutar la app aquí (sin pantalla): la revisión de alcanzabilidad de i18n se ha hecho por lectura de código, no navegando la UI. **Pendiente de validación manual por el usuario**: recorrer la app en español (menú Project con "Split clip", menú Help reducido con "User manual", diálogo de atajos con "Quit VideoMix", Ajustes avanzados con el texto de instancias múltiples, y "Open folder" sobre una carpeta con imágenes y vídeos mezclados) y comprobar que no aparece texto en inglés.

### Dudas para el orquestador

1. `userManualUrl` apunta a la rama de trabajo actual (no a `main`); si se cambia la rama por defecto habrá que actualizarla a mano.
2. `reporting.tsx` sigue mencionando LosslessCut/Discord/GitHub discussions de mifi; queda como residual de muy difícil alcance en VideoMix (ver arriba). ¿Se reescribe para VideoMix en una tarea futura o se acepta?

## Revisión

- **Resultado**: aceptada. `tsc`, `lint`, tests (414) y `build` en verde. Manual creado.
- **Decisiones del orquestador**:
  - La URL del manual apunta a la rama de trabajo. Al integrar en la rama por defecto hay que cambiarla en `src/common/constants.ts` (queda anotado en el plan).
  - `reporting.tsx` queda como está, porque es prácticamente inalcanzable en VideoMix. Pasa al backlog.
