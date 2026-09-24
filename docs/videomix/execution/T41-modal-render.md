# T41 · Modal de progreso del render

- **Hito**: M10 · **Modelo**: Opus · **Depende de**: — · **Estado**: pendiente

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

## Revisión
