# T61 · v7: "Optimizar montaje" (I2)

- **Hito**: M14 · **Modelo**: Opus · **Depende de**: — (en paralelo con T60) · **Estado**: hecha

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

### Resumen

- **Optimizador puro** `planner/optimizeOrder.ts` (+ `optimizeOrder.test.ts`, 8 tests): recocido simulado sobre el orden de la lista, cada candidato planificado con `planMixBest` y comparado con `comparePlanQuality` según "Priorizar". Solo usa la API pública del planificador (`planMixBest`, `comparePlanQuality`, `getReorderWindowSize`, `createRandom`); no toca ningún fichero existente de `planner/`.
- **Segundo plano**: Web Worker `optimize/optimizeOrderWorker.ts` (mensajes tipados en `optimize/optimizeOrderMessages.ts`).
- **Pegamento puro** `optimize/optimizeMix.ts` (+ 3 tests): entrada del optimizador, métricas antes/después y paso del orden del planificador a la lista completa.
- **UI**: `components/MixOptimizeDialog.tsx` + `hooks/useMixOptimize.ts`; botón "Optimizar montaje…" en la barra de la vista Montaje (junto al zoom) y en el menú Proyecto (acción `optimizeMix`, sin atajo por defecto, listada en el diálogo de atajos).
- **Cambios en ficheros compartidos** (mínimos): `App.tsx` (import, estado, acción, prop `onOptimize` y montaje del diálogo), `MixPlanView.tsx` (prop y botón), `menu.ts` (entrada), `common/types.ts` (acción), `KeyboardShortcuts.tsx` (nombre de la acción), locales `en` (`yarn scan-i18n`) y `es` (34 claves), `e2e/videomix.e2e.ts` (escenario 26 nuevo).
- **Docs**: 04-diseno §3.12 (tras la §3.11 de I1, T60) y manual §4 "Optimizar montaje".

### Algoritmo

- **Estado**: una permutación de la lista (`perm[p]` = índice original del clip en la posición `p`). Los clips fijados (su `pinTime` o el de su grupo) y los de la secuencia no se mueven (`getFixedClipIds`): el planificador no los toma por su posición en la lista, así que moverlos solo haría ruido.
- **Movimientos** (al 50 %): intercambiar dos clips o llevar uno a otra posición desplazando los de en medio. Se elige un clip y un destino dentro de su ventana; el movimiento se descarta si **algún clip quedaría a más de N posiciones de su posición original** (N = ventana del proyecto; ilimitada = libre). Hasta 20 intentos por paso.
- **Evaluación**: `planMixBest` con los ajustes del proyecto (el mismo plan que usa el render y la estimación "≈ m:ss"). Un orden ya visto no se vuelve a planificar (caché de 20 000 órdenes).
- **Criterio**:
  - el mejor se guarda con `compareOrderQuality`: `comparePlanQuality` con la prioridad del proyecto, sumando al `order` del plan el desplazamiento de la lista respecto al original (entre dos órdenes igual de buenos gana el que menos mueve la lista);
  - además, **solo cuenta como mejor un orden que no empeora la otra medida** respecto al original (`keepsSecond`, con los mismos pasos de 0,05 s y 0,01): con "duración", no más relleno; con "relleno", no más largo. Ver Decisiones 3;
  - el paseo usa una energía escalar: medida principal + 0,05 × la otra + 1 × lo que la otra supere la original + 0,001 × desplazamiento.
- **Enfriamiento**: rondas de 200, 400, 800… pasos; cada una empieza desde el mejor orden y baja la temperatura geométricamente del 0,5 % al 0,005 % de la medida principal original. Así cualquier presupuesto tiene rondas completas y reinicios, y la secuencia de candidatos **no depende del tiempo**: es determinista dada la semilla (fija, 1), y el tiempo solo decide dónde se corta.
- **Métricas antes/después** (`getMixOrderMetrics`): duración y relleno de `PlanQuality` (plan completo, antes del corte de E4 y de la ampliación de E7, como la red) y **tiempo con columnas vacías** (`getEmptyColumnTime`: unión de los tramos en que alguna columna del layout no tiene clip, es decir, el final del vídeo). El relleno se muestra en **segundos de fotograma completo** (fracción × s), no en %: un vídeo más corto con menos relleno podía mostrar un porcentaje mayor y confundir.

### ¿Planificador con o sin red de seguridad?

Con la red (`planMixBest`), por tres motivos:

1. Es exactamente el plan que se renderiza después de aplicar: el antes/después coincide con lo que verá el usuario (el e2e comprueba que la estimación "≈ m:ss" pasa al valor "después" y vuelve al deshacer).
2. La red incluye la ventana 0, en la que el plan sigue la lista: es justo la palanca que da reordenar la lista. Sin la red, con ventana ilimitada el planificador volvería a reordenar a su manera y el orden de la lista pesaría poco.
3. El coste extra es pequeño: las ventanas 10, 3 y 0 son mucho más baratas que la ilimitada (y con prioridad "duración" se abandonan pronto).

### Segundo plano: Web Worker

- Viable con el empaquetado: el repo ya usa un worker de Vite (`worker/eval.ts`, `import … from './x?worker'`) y el planificador es puro (sin DOM ni Electron). `yarn build` genera `optimizeOrderWorker-*.js` (92 kB).
- El worker recibe `{ input, seed, durationMs }` (un `PlanMixInput` clonable, sin tamaños de fuente) y trabaja en trozos de 5 pasos, mirando el reloj entre trozos. Publica el mejor orden **en cuanto mejora** y el progreso cada 200 ms, y termina solo al acabar el tiempo.
- **Parar** hace `terminate()` y se queda con el último mejor recibido: es inmediato aunque un candidato tarde (no hay que esperar a que el bucle ceda). Cerrar el diálogo o desmontarlo también termina el worker.
- El antes/después se calcula al final en el hilo principal (dos planes; ≈ 0,1 s con 40 clips).

### Métricas del caso del usuario

Caso de los tests (`userCase`): 40 clips "Ajustar a" exactos, sin mín., en 16:9 1920×1080, 3 columnas, transición 0,5 s, duraciones pseudoaleatorias de 4 a 16 s (semilla 7); lista agrupada: 16 × 1/3, 6 × 1/2, 18 × 2/3. Cota de área (Σ fracción × duración) = 199,3 s. Banco en Node (vitest, con la validación de desarrollo de `planMixBest` activa, así que la app hace algo más de evaluaciones por segundo), **15 s por caso**, semilla 1. "HEAD" = planificador de `HEAD` (sin T60, copiado con `git archive` fuera del repo); "T60 en curso" = el del árbol de trabajo en el momento de medir (I1 a medio hacer: puede cambiar).

| Planificador | Ventana | Priorizar | Evaluaciones | Antes (duración / relleno) | Después (duración / relleno) | Clips movidos |
|---|---|---|---|---|---|---|
| HEAD | ilimitada | duración | 3763 | 239,2 s / 53,2 | **146,2 s / 25,3** | 40 |
| HEAD | ilimitada | relleno | 3998 | 239,2 s / 53,2 | **184,6 s / 3,1** | 39 |
| HEAD | 10 | duración | 5646 | 239,2 s / 53,2 | 128,0 s / 34,3 | 35 |
| HEAD | 10 | relleno | 4917 | 239,2 s / 53,2 | 189,8 s / 26,1 | 37 |
| HEAD | 3 | duración | 14 092 | 244,5 s / 57,0 | 222,0 s / 48,5 | 28 |
| HEAD | 3 | relleno | 14 998 | 244,5 s / 57,0 | 222,2 s / 47,3 | 29 |
| T60 en curso | ilimitada | duración | 3150 | 185,9 s / 4,5 | 184,6 s / 3,8 | 36 |
| T60 en curso | ilimitada | relleno | 1527 | 185,9 s / 4,5 | 185,6 s / 3,4 | 39 |
| T60 en curso | 10 | duración | 4152 | 242,7 s / 55,0 | 175,2 s / 9,6 | 37 |
| T60 en curso | 10 | relleno | 3482 | 242,7 s / 55,0 | 179,2 s / 10,5 | 38 |
| T60 en curso | 3 | duración | 8390 | 243,5 s / 57,1 | 220,0 s / 49,8 | 26 |
| T60 en curso | 3 | relleno | 7794 | 244,5 s / 57,0 | 222,9 s / 45,7 | 24 |

(Relleno en segundos de fotograma completo. El tiempo con columnas vacías es ≤ 1 s en todos salvo "T60, 10, relleno": 0 → 7,7 s, que no está acotado; ver Dudas 4.)

- **Lectura**:
  - Con el planificador de `HEAD` (el que vio el usuario), la ventana ilimitada pasa de 239 s a 146 s (−39 %) con "duración" y a 185 s con relleno casi nulo (53 → 3,1) con "relleno". Por debajo de la cota de área (199 s) solo se llega con letterbox: con "duración", el criterio acepta franjas si acortan (T52, duda 5), y el optimizador lo explota más que el planificador; el relleno total aun así baja a menos de la mitad.
  - Con I1 (T60) la ilimitada ya empareja bien los 1/3 con los 2/3 (186 s, relleno 4,5) y el optimizador solo rasca algo (−1,3 s, −15 % de relleno). Donde más aporta entonces es con ventanas finitas: con 10, 243 → 175 s y relleno 55 → 9,6.
  - Con ventana 3 el margen es pequeño: la lista agrupada no deja que un 2/3 llegue hasta los 1/3 moviéndose 3 posiciones (más las 3 del planificador).
- **Velocidad** (Node, con validación de desarrollo): ~250 evaluaciones/s con ilimitada, ~375/s con 10 y ~950/s con 3 (40 clips). La mayor parte de la mejora llega en las primeras ~1000 evaluaciones (unos segundos); 15 s afina.
- **Test del caso del usuario**: con ventana 10, 300 pasos (~1–2 s) deben dar un plan mejor por la prioridad, ≥ 10 % más corto y con < 50 % del relleno; con ilimitada, 150 pasos nunca peor en ninguna medida (con I1 ya queda poco que ganar ahí, y así el test no depende de cómo termine T60). Se comprueba además que el plan resultante es válido (`validatePlan`), el determinismo, la ventana, los clips fijos y la prioridad "relleno".

### Decisiones

1. **Ventana**: se aplica a la **posición en la lista** frente a la original (lo que dice el task-doc: "ningún clip se aleja de su posición original más de la ventana"). El planificador sigue reordenando dentro de su ventana a partir de la lista nueva, como con cualquier lista. Ver Dudas 1.
2. **Clips fijos**: fijados, grupos fijados y secuencia no se mueven. Los clips de grupos y cadenas sí se mueven: grupos y cadenas no dependen del orden de la lista (`getClipChains` ordena por tiempo de la fuente) y todos los candidatos se planifican con ellos; los clips sin duración válida (fuera del plan) se quedan en su sitio.
3. **Solo mejoras sin contrapartida** (lo más conservador): solo se ofrece un orden que mejora la medida principal sin empeorar la otra respecto al orden actual. Así el antes/después nunca muestra "más corto pero con más relleno" (sin esta regla, con "duración", ventana ilimitada y el planificador de T60 en curso, el optimizador llegó a 188 → 153 s a costa de subir el relleno de 6 a 26, casi todo letterbox). Además, "Aplicar" solo se activa si mejora la duración o el relleno: un orden que solo empata en ambas y gana por los desempates (orden, re-layouts) no merece reordenar la lista ("No se ha encontrado un orden mejor").
4. **Arranque explícito**: el diálogo abre con el tiempo (15 s por defecto) y **Iniciar**; no empieza solo.
5. **Durante la búsqueda**, Esc y el clic fuera no hacen nada (como el diálogo de render, T41): solo Parar. Con el resultado, Esc = Descartar.
6. **Aplicar** es un único `reorderClips` (un paso de deshacer). No aplica nada si los clips o los ajustes cambiaron durante la búsqueda (identidad de los objetos del reducer) y lo avisa. En la práctica, los atajos no funcionan con el diálogo abierto (T51).
7. **No disponible** con orden aleatorio (la lista no es el orden base), ventana 0 o menos de dos clips movibles: el diálogo lo explica y no ofrece Iniciar.
8. **Semilla fija** (1): el mismo proyecto y el mismo tiempo dan el mismo resultado salvo por la velocidad de la máquina; repetir la optimización desde el orden ya optimizado sigue buscando desde ahí.
9. **Relleno en segundos de fotograma completo** en el antes/después (ver Métricas).

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (105 ficheros, 1256 tests, incluidos los de T60 en curso), `yarn build` y `yarn test-e2e` (**28/28**) en verde.
- **e2e 26** (nuevo): proyecto de 10 clips (5 × 1/3 y luego 5 × 2/3, ventana 3) abierto desde un `.vmx`; botón de la vista Montaje; 15 s por defecto; se elige 1 min, se espera a 400 variantes, Esc no cierra, **Parar**; antes/después (13,0 s → 10,0 s; relleno 2,2 → 1,2 s); **Aplicar** reordena la lista respetando la ventana y la estimación "≈ m:ss" pasa a 0:10; `Ctrl+Z` vuelve a la lista y a la estimación originales y `Ctrl+Shift+Z` rehace; desde el menú Proyecto con 5 s y **Descartar** no cambia nada; sin errores de consola. Capturas: `26a-optimize-running.png` (progreso, encima de la previsualización en vivo), `26b-optimize-result.png`, `26c-optimize-applied.png`.
- Durante el trabajo, `yarn lint` falló una vez por un `>>` en `planMix.ts` (trabajo en curso de T60); en la pasada final ya estaba limpio.

### Dudas para el orquestador

1. **Ventana**: ¿basta con que la lista nueva respete la ventana frente a la original (hecho), o el usuario espera que el **orden de reproducción final** no se aleje más de N de su lista original? Con lo hecho, un clip puede acabar reproduciéndose hasta 2N posiciones lejos de su sitio original (N por la lista y N por el planificador). La alternativa es más restrictiva y con ventanas pequeñas mejoraría menos.
2. **Solo mejoras sin contrapartida** (Decisión 3): ¿de acuerdo, o prefiere el criterio de "Priorizar" puro (p. ej. aceptar más letterbox si acorta el vídeo)?
3. Con I1 (T60) la ganancia con ventana ilimitada es pequeña en el caso del usuario; las métricas de la tabla con "T60 en curso" pueden cambiar cuando T60 termine (el test del caso ilimitado solo exige "nunca peor").
4. El tiempo con columnas vacías se muestra pero no se optimiza (no está en `PlanQuality`); en un caso del banco subió de 0 a 7,7 s con menos relleno total. ¿Debería contar como restricción ("no más columnas vacías")?

## Revisión

- **Resultado**: aceptada. Dudas: (1) la ventana se aplica a la posición en la lista respecto a la original (lo que el usuario ve en la lista); (2) "sin empeorar la otra métrica" aceptado; (4) columnas vacías solo informativas.
- **Validación del orquestador** (con T60): tsc, lint, 1256 tests, e2e 28/28.
