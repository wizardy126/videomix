# T41 · Modal de progreso del render

- **Hito**: M10 · **Modelo**: Opus · **Depende de**: — · **Estado**: hecha

## Objetivo

Hoy, mientras se renderiza (mezcla final o previsualización), el usuario percibe la interfaz "congelada": solo ve el porcentaje en el título de la ventana y en el icono de la barra de tareas. Durante el render debe verse, además de lo que ya se hace, un **modal** con:

- el texto de la fase (análisis de sonoridad, render de vídeo, audio…);
- una **barra de progreso** que se va rellenando, con el porcentaje;
- el **tiempo transcurrido** y el **tiempo restante aproximado**;
- un botón **Cancelar**.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md), [03-convenciones](../03-convenciones.md).
- `src/renderer/src/videomix/hooks/useMixRender.ts`: fases (`setWorking` + `setProgress`) y cancelación con `AbortController`.
- `src/renderer/src/components/Working.tsx` (heredado): caja con animación Lottie, "Elapsed", porcentaje y "Abort". Se monta al final de `App.tsx` (`{working && <Working … />}`).
- Dónde se actualizan el título y la barra de tareas con el progreso (buscar `setProgressBar` / `document.title` / `progress`).

## Alcance

1. **Diagnóstico primero** (documentarlo en las notas): ¿por qué el usuario no ve el `Working` heredado o lo ve "congelado"? Comprobarlo de verdad: lanzar la app con Xvfb (ver 06-entorno §e2e), iniciar un render y tomar capturas durante el render. Posibles causas: el overlay queda oculto o detrás de la vista Mix; el hilo del renderer se bloquea (p. ej. llamadas síncronas de `@electron/remote` o re-renders de `App` a cada evento de progreso); la animación no se actualiza. Si hay un bloqueo real del hilo del renderer, corregirlo (p. ej. limitar la frecuencia de `setProgress`, evitar trabajo síncrono), porque un modal nuevo no serviría de nada si el hilo está bloqueado.
2. **Componente nuevo** `src/renderer/src/videomix/components/RenderProgressDialog.tsx` (Radix `Dialog` como el resto de diálogos de VideoMix, modal, no se cierra con Esc ni clic fuera; Esc puede equivaler a Cancelar con confirmación o no hacer nada, decide y documenta):
   - título según el tipo (render de la mezcla / render de la previsualización) y texto de la fase actual;
   - barra de progreso (elemento con `role="progressbar"` y `aria-valuenow`) + porcentaje con un decimal;
   - "Transcurrido m:ss" (desde el inicio del render completo, no de cada fase) y "Restante ≈ m:ss";
   - botón **Cancelar**, que usa el mismo `AbortController` que ya existe (mismo efecto que el "Abort" heredado: se matan los ffmpeg, se borran temporales, la caché ya completa se conserva y no aparece diálogo de error).
3. **Estimación del restante** en una función pura con tests (`videomix/render/renderEta.ts` o similar):
   - basada en el progreso de la fase de render de vídeo/audio (la de análisis de sonoridad suele ser corta; si se incluye, que la estimación no salte de forma absurda al cambiar de fase);
   - no mostrar estimación hasta tener datos suficientes (p. ej. ≥ 3 s y ≥ 2 % de progreso): "Calculando…";
   - suavizada (media móvil o similar) para que no oscile a cada evento;
   - con caché incremental los bloques cacheados avanzan de golpe: la estimación debe seguir siendo razonable.
4. **Integración**: en modo VideoMix, durante un render se muestra el modal nuevo en lugar del `Working` heredado (no los dos a la vez). El `Working` heredado se sigue usando para el resto de operaciones (html5ify, etc.). El título y la barra de tareas siguen mostrando el progreso como hasta ahora.
5. i18n: textos con `t()` en inglés, `yarn scan-i18n`, y traducción en `locales/es/translation.json`.
6. **e2e**: ampliar un escenario de render existente en `e2e/videomix.e2e.ts` para comprobar que el modal aparece con barra y tiempos, y otro (o el mismo) que pulse Cancelar y compruebe que el render se interrumpe sin diálogo de error y la UI vuelve a estar operativa.
7. Manual (`docs/videomix/manual-usuario.md`): sección de render.

## Fuera de alcance

- Cambiar cómo se calcula el porcentaje global de cada fase.
- Tocar la gestión de vídeos convertidos (T42, en paralelo: **no toques el código de `loadMedia`/html5ify de `App.tsx`**; tus cambios en `App.tsx` deben ser mínimos y localizados).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.
- Capturas del modal durante un render real en `test-results/e2e-screenshots/`.
- La UI responde durante el render (el contador de tiempo avanza de forma fluida).

## Notas de ejecución

### Resumen

- Diálogo nuevo `RenderProgressDialog` (Radix `Dialog`, modal) para el render y la previsualización del montaje: título según el tipo, fase, barra (`role="progressbar"`, `aria-valuenow`) con porcentaje con un decimal, "Transcurrido" (desde el inicio del render completo), "Restante ≈ m:ss" / "Calculando…" y **Cancelar**. Sustituye al `Working` heredado solo para el render de VideoMix; el resto de operaciones siguen con `Working`. El título de la ventana y la barra de tareas no cambian.
- Estimación del restante en `videomix/render/renderEta.ts` (pura, 9 tests).
- `WorkingState` (useLoading) lleva un campo opcional `mixRender` (`videomix/render/renderStatus.ts`): tipo, inicio, fase, inicio de la fase y línea base de la estimación. `App` muestra el diálogo nuevo cuando existe y `Working` en otro caso.

### Diagnóstico: por qué la interfaz parecía congelada

Comprobado con la app real (build de producción, Xvfb, Playwright): proyecto con las 3 fuentes de prueba, pestaña Mezcla, render a 1080p (~13 s), capturas cada 0,5 s y medidas en la página durante el render.

- **Causa: el `Working` heredado estaba tapado por la previsualización en vivo** (T32). `MixLivePreview` tiene `position: absolute; z-index: 1` dentro del contexto de apilamiento raíz; `Working` (y también los diálogos Radix, portados a `#app-root`) tienen `z-index: auto`, así que se pintan **debajo**. Como la caja de `Working` va centrada en la ventana, queda entera detrás del lienzo negro de la previsualización: en las capturas no se ve nada (solo un velo casi imperceptible fuera del área del reproductor), y `document.elementFromPoint` en el centro de `Working` devuelve el `<canvas>` de la previsualización. Por eso el usuario solo veía el porcentaje del título.
- **El hilo del renderer no se bloqueaba**: durante el render hubo 7–15 *long tasks* de 86–200 ms (≈ 0,5–1,1 s en total en 13 s) y un `setInterval` de 50 ms nunca tardó más de ~260 ms; el título se actualizaba ~2 veces/s (26–38 cambios por render). Los eventos de progreso llegan de main por IPC (callbacks de `@electron/remote`, asíncronos) y cada uno re-renderiza `App`, pero con la frecuencia real (≈ 2/s por ffmpeg) no es un problema. **No se ha limitado la frecuencia de `setProgress`** (no hacía falta y no se quería tocar el cálculo del progreso); el diálogo tiene su propio reloj de 250 ms para que el tiempo avance de forma fluida entre eventos.
- **Corrección**: el overlay y el contenido del diálogo nuevo llevan `z-index: 2` (por encima del `z-index: 1` de la previsualización). Primero se probó a contener el `z-index` de la previsualización con `isolation: isolate` en el contenedor del reproductor de `App.tsx` (arreglaba también `Working` y los demás diálogos), pero la previsualización en vivo dejaba de pintar los fotogramas de vídeo (escenario e2e 7: solo se veía el texto superpuesto): se descartó.
- **Pendiente (fuera de alcance, para el orquestador)**: el mismo problema de apilamiento afecta, en la pestaña Mezcla, al `Working` heredado de otras operaciones y a los demás diálogos Radix centrados: por ejemplo, en `test-results/e2e-screenshots/08a-preview-dialog.png` la previsualización en vivo se pinta por encima del diálogo "Mix preview". Un arreglo general (p. ej. `z-index` en `Dialog.module.css`/`AlertDialog.module.css` y en `Working`, cuidando los menús Radix que se abren dentro de diálogos, o quitar el `z-index` de `MixLivePreview` y reordenar sus hermanos) merece su propia tarea.

### Decisiones

- **Esc y clic fuera no hacen nada** (opción más conservadora: evita cancelar un render sin querer; el botón Cancelar está a la vista). El diálogo tampoco da el foco inicial al botón Cancelar, para que una tecla pensada para otra cosa (Espacio, Intro) no cancele el render.
- **Cancelar** llama al mismo `abortWorking` que el "Abort" heredado (mata los ffmpeg y aborta el `AbortController`): mismo efecto (temporales borrados, fragmentos ya en caché conservados, `RenderAbortedError` sin diálogo de error). Sin confirmación, como el heredado; el botón se desactiva y pasa a "Cancelando…" tras pulsarlo.
- **Preguntas durante el render** (sonidos sin medir, T21b; aviso del paso a codificación por software, T25): se muestran con swal. Un diálogo Radix modal debajo les quitaría el foco (y los eventos de puntero del `body`), así que mientras duran la fase pasa a `'confirm'` y el diálogo de progreso se cierra; al responder se restaura.
- **Estimación del restante** (`renderEta.ts`):
  - Solo con la fase de render (vídeo y audio): durante el análisis de sonoridad (normalmente corto y sin relación con la velocidad del render) pone "Calculando…". Cada fase (y el reintento con software) empieza de cero.
  - Velocidad = progreso / tiempo sobre una ventana deslizante: los últimos 20 s o, mientras sea más corto, la segunda mitad del tiempo transcurrido desde la línea base (así el arranque de los primeros ffmpeg, varios segundos sin progreso, no pesa mucho tiempo en renders cortos). Esa velocidad se suaviza con una media móvil exponencial por tiempo (τ = 2 s), de modo que una ráfaga de eventos cuenta lo que el tiempo que cubre. Entre eventos el restante cuenta hacia atrás solo.
  - Nada hasta tener ≥ 3 s y ≥ 2 % de progreso desde la línea base.
  - Caché incremental: `runRenderJob` marca como hechos los fragmentos cacheados de golpe antes de lanzar el primer ffmpeg. `useMixRender` envuelve `deps.runFfmpeg` y, en la primera llamada, fija la línea base (hora y progreso de ese momento), de modo que ese salto no cuenta como velocidad. Sin tocar `runRenderJob` ni el cálculo del porcentaje.
  - Con el render real de 13 s: "Calculando…" hasta ~3,8 s, luego 47 s → 21 → 14 → 8 → 4 → 1 s, frente a unos 8 → 6 → 5 → 4 → 3 → 0,5 s reales: sobreestima al principio (arranque) y converge en unos segundos; en renders largos (minutos) el arranque pesa mucho menos.
- La barra de tareas y el título siguen igual (`setProgress` y `working.text` no cambian).

### Ficheros

- Nuevos: `src/renderer/src/videomix/components/RenderProgressDialog.tsx`, `src/renderer/src/videomix/render/renderEta.ts` (+ `renderEta.test.ts`), `src/renderer/src/videomix/render/renderStatus.ts`.
- `src/renderer/src/videomix/hooks/useMixRender.ts`: estado del diálogo en `setWorking` (fases, `ask` para las preguntas, línea base al primer ffmpeg).
- `src/renderer/src/hooks/useLoading.ts`: campo opcional `mixRender` en `WorkingState`.
- `src/renderer/src/App.tsx`: import, `Working` solo sin `mixRender`, y el diálogo nuevo (3 cambios pequeños, junto a `Working`).
- `locales/en/translation.json` (`yarn scan-i18n`) y `locales/es/translation.json`: 7 textos nuevos.
- `e2e/videomix.e2e.ts`: helper `expectRenderProgress` (título, barra, porcentaje, tiempos y que nada tapa el diálogo); escenario nuevo **8b** (cancelar: Esc no cierra, Cancelar interrumpe, sin error ni fichero, título sin %) y el render con ffprobe pasa a **8c** (captura del diálogo con progreso si el render aún no ha terminado).
- `docs/videomix/manual-usuario.md` §8.

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (83 ficheros, 1000 tests), `yarn build`: en verde.
- `yarn test-e2e`: 18/18 en verde (incluido el escenario 15 de T42, en paralelo). Capturas: `test-results/e2e-screenshots/08b-render-progress.png` (diálogo durante el render, sobre la vista Mezcla), `08b-render-cancelled.png`, `08c-render-progress.png` (32 % con la barra).
- Diagnóstico y medidas con un spec temporal de Playwright (fuera de `e2e/`, ya borrado): antes del cambio, `Working` bajo el lienzo; después, el diálogo arriba, el contador "Transcurrido" avanza cada segundo y la estimación como se describe arriba.

## Revisión

- **Resultado**: aceptada. Modal validado en capturas de renders reales; el diagnóstico (preview en vivo con `z-index: 1` tapando `Working` y los diálogos) queda como T43.
- **Validación del orquestador**: tsc, lint, 1000 tests y e2e 18/18.
