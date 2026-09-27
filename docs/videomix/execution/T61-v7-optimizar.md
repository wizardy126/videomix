# T61 · v7: "Optimizar montaje" (I2)

- **Hito**: M14 · **Modelo**: Opus · **Depende de**: — (en paralelo con T60) · **Estado**: en curso

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§15 (v7)**, §4, §11 (E2, E4, E5, E7, E8), §13 (G1, G2); [03-convenciones](../03-convenciones.md); [04-diseno](../04-diseno.md) §2–§3 (planificador, §3.10 red de seguridad).
- Notas de ejecución de T10, T10b, T38, T38b, T38c, T44b y **T52** (causa de la ventana ilimitada, clips pendientes, red de seguridad, banco de pruebas).
- UI: `MixSettingsDialog.tsx` / barra de la vista Mix, `RenderProgressDialog.tsx` (T41) como referencia de diálogo de progreso, `useMixRender.ts` / `useMixDuration.ts` (cómo se calcula el plan), acción de reordenar clips del reducer.

## Alcance

1. **Optimizador puro** (`planner/optimizeOrder.ts` o similar): búsqueda sobre el orden de la lista (p. ej. recocido simulado con intercambios y desplazamientos) evaluando cada candidato con el planificador real (el mismo que usa el render, incluida la red de seguridad si procede; decide y justifica) y comparando con el criterio de `planPriority`. **Respeta la ventana de reorden** (ningún clip se aleja de su posición original más de la ventana; ilimitada = libre) y deja intactas las restricciones (fijaciones, grupos, cadenas, secuencia). Determinista dada una semilla; con presupuesto de tiempo o de evaluaciones; devuelve el mejor orden y sus métricas. Tests, incluido el caso de 40 clips (16×1/3, 6×1/2, 18×2/3) del usuario con la lista agrupada por tipos: debe mejorar claramente al plan normal.
2. **Ejecución en segundo plano**: en un Web Worker (o troceado con cesiones al bucle de eventos si un worker no es viable con el empaquetado; justifica) para no congelar la interfaz.
3. **UI**: botón "Optimizar montaje…" (vista Mix, y menú Proyecto). Diálogo con tiempo **5 / 15 / 60 s (15 por defecto)**, barra de progreso, mejor resultado hasta ahora, **Parar** (se queda con el mejor); al terminar, **antes/después** (duración, relleno, tiempo con columnas vacías) y **Aplicar** / **Descartar**. Aplicar **reordena la lista de clips** en un paso de deshacer.
4. i18n (en + es), manual, e2e (optimizar un proyecto pequeño con orden malo, aplicar, deshacer).

## Coordinación

T60 cambia el interior del planificador en paralelo: usa el planificador solo a través de su API pública (`planMix`/`planMixBest` o lo que use el render) para no pisar sus ficheros.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde; métricas del caso del usuario en las notas.

## Notas de ejecución

## Revisión
