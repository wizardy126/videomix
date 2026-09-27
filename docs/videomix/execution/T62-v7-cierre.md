# T62 · v7: medición conjunta, manual y cierre

- **Hito**: M14 · **Modelo**: Sonnet · **Depende de**: T60, T61 · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§15 (v7)**, §4, §11 (E2, E4, E5, E7, E8), §13 (G1, G2); [03-convenciones](../03-convenciones.md); [04-diseno](../04-diseno.md) §2–§3 (planificador, §3.10 red de seguridad).
- Notas de ejecución de T10, T10b, T38, T38b, T38c, T44b y **T52** (causa de la ventana ilimitada, clips pendientes, red de seguridad, banco de pruebas).

## Alcance

1. Medir el caso del usuario con T60 + T61 juntos (normal vs optimizado) y anotarlo.
2. Auditoría real del manual (I1, I2) contra la UI; `07-propuestas.md` (I1, I2 → ✅); revisión del español.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

### Resumen

- T60 (I1) y T61 (I2) ya están hechas y fusionadas en un único commit (`ff17dd1`); esta tarea mide el resultado conjunto con el código final, audita el manual y cierra `07-propuestas.md`.
- No hay cambios de código. Cambios: `docs/videomix/manual-usuario.md` (§4 "Optimizar montaje" y §10) y `docs/videomix/07-propuestas.md` (v7 → ✅).

### 1. Medición del caso del usuario (código final: I1 + I2 juntos)

Script fuera del repo (temporal, en `planner/`, borrado tras medir; no se ha guardado en `script/videomix/` porque no aporta nada que no midan ya `complements.test.ts` y `optimizeOrder.test.ts`): construye los 40 clips "Ajustar a" 1/3 (16), 1/2 (6) y 2/3 (18) de 1920×1080, 3 columnas, transición 0,5 s, sin mín. (como en `userCase` de T60/T61, semilla 7, duraciones 4–20 s), en dos órdenes de lista:

- **bloques**: los 16 de 1/3 primero, luego los 6 de 1/2, luego los 18 de 2/3 (el caso real del usuario);
- **mezclado**: los mismos 40 clips barajados (semilla determinista).

Para cada orden, ventana (3, 10, ilimitada) y prioridad (duración, relleno): plan normal (`planMixBest`) y plan tras **Optimizar montaje** con presupuesto de **15 s** (`createOrderOptimizer`, semilla 1, exactamente como hace `MixOptimizeDialog`/`useMixOptimize`, paso a paso hasta agotar el tiempo real, no por nº de pasos). Métricas: duración, `PlanQuality.fill` (relleno, fracción de fotograma × s), 2/3 sin pareja (visto solo más de la mitad de su tiempo) y **tiempo con letterbox/pillarbox** (s de barras, sumadas por columna: para cada aviso `letterbox`/`pillarbox` se cuenta desde su instante hasta el siguiente cambio de layout o el fin del clip).

| Orden | Ventana | Priorizar | | Duración (s) | Relleno | 2/3 sin pareja | Letterbox (s) |
|---|---|---|---|---|---|---|---|
| bloques | 3 | duración | antes | 290,7 | 65,0 | 16 | 10,0 |
| bloques | 3 | duración | después | 262,6 | 53,3 | 10 | 48,5 |
| bloques | 3 | relleno | antes | 290,7 | 65,0 | 16 | 10,0 |
| bloques | 3 | relleno | después | 253,2 | 45,0 | 7 | 46,2 |
| bloques | 10 | duración | antes | 290,4 | 73,3 | 9 | 28,4 |
| bloques | 10 | duración | después | 221,0 | 20,5 | 2 | 75,0 |
| bloques | 10 | relleno | antes | 290,7 | 65,0 | 16 | 10,0 |
| bloques | 10 | relleno | después | 224,8 | 14,9 | 2 | 55,7 |
| bloques | **ilimitada** | duración | antes | 223,5 | 5,6 | 0 | 38,3 |
| bloques | **ilimitada** | duración | después | 222,6 | 4,5 | 0 | 39,7 |
| bloques | **ilimitada** | relleno | antes | 223,5 | 5,6 | 0 | 38,3 |
| bloques | **ilimitada** | relleno | después | 223,0 | 3,8 | 0 | 19,5 |
| mezclado | 3 | duración | antes | 251,6 | 31,0 | 2 | 19,6 |
| mezclado | 3 | duración | después | 219,1 | 11,6 | 0 | 57,1 |
| mezclado | 3 | relleno | antes | 251,6 | 31,0 | 2 | 19,6 |
| mezclado | 3 | relleno | después | 223,0 | 5,4 | 0 | 36,6 |
| mezclado | 10 | duración | antes | 230,1 | 10,8 | 1 | 36,8 |
| mezclado | 10 | duración | después | 219,2 | 10,5 | 0 | 73,0 |
| mezclado | 10 | relleno | antes | 230,1 | 10,8 | 1 | 36,8 |
| mezclado | 10 | relleno | después | 222,9 | 4,4 | 0 | 33,8 |
| mezclado | ilimitada | duración | antes | 223,1 | 5,3 | 0 | 27,7 |
| mezclado | ilimitada | duración | después | 222,6 | 3,4 | 0 | 20,2 |
| mezclado | ilimitada | relleno | antes | 223,1 | 5,3 | 0 | 27,7 |
| mezclado | ilimitada | relleno | después | 222,6 | 3,4 | 0 | 20,2 |

(15 s de búsqueda dan entre ~2200 y ~9400 variantes evaluadas según la ventana y la prioridad, coherente con T61.)

- **Lectura**:
  - **Ventana ilimitada** (lo que recomienda este manual para el caso del usuario, ver más abajo): el plan **normal** ya está bien resuelto por I1 (223,5 s, relleno 5,6, 0 clips 2/3 solos; frente a los 239,2 s / 53,2 sin I1 de las notas de T61). "Optimizar montaje" (I2) apenas puede mejorar la duración (223,5 → 222,6 s), pero con "Menos relleno" reduce el relleno casi a la mitad (5,6 → 3,8) a costa de más segundos de letterbox (38,3 → 19,5, es decir, menos: en esta fila el letterbox también baja). Confirma la nota de T61: con I1 ya no queda mucho margen en ilimitada.
  - **Ventanas 3 y 10** (lo que usa el proyecto si no se pone ilimitada): aquí es donde más se nota "Optimizar montaje": con ventana 10 y "duración", 290,4 → 221,0 s (−24 %) y relleno 73,3 → 20,5; los 2/3 sin pareja bajan de 9 a 2. Con ventana 3 la ganancia es menor (290,7 → 262,6 s) porque el bloque de 16 clips de 1/3 sigue obligando a los primeros 2/3 a esperar más de 3 posiciones (igual que en T60, "con ventana 3 casi nada").
  - **Orden mezclado**: el plan normal ya sale razonable (I1 ayuda incluso sin bloques), y el optimizador afina algo más en todas las ventanas.
  - **Letterbox**: tras optimizar, el tiempo con franjas casi siempre **sube** (p. ej. bloques/3/duración: 10,0 → 48,5 s), sobre todo con la prioridad "Duración más corta": el criterio acepta pillarbox/letterbox si eso acorta el vídeo (lo dice el propio manual, §4), y el optimizador lo explota más que el planificador normal. Con "Menos relleno" sube menos o incluso baja (bloques/ilimitada: 38,3 → 19,5): ese criterio penaliza el relleno total, que incluye el área de las franjas, así que no las regala tan fácilmente. **Consejo directo para el usuario**: si le importa evitar franjas negras/laterales, usar "Menos relleno" al optimizar, no "Duración más corta".
  - Nº de evaluaciones en 15 s: de ~2200 (ilimitada) a ~9400 (ventana 3), igual de orden de magnitud que T61 (~250–950 eval/s en Node con la validación de desarrollo activa).

### 2. Auditoría del manual (I1, I2) contra la UI real

Revisadas línea a línea: `docs/videomix/manual-usuario.md` §4 (todo el texto sobre orden, ventana, "Priorizar" y "Optimizar montaje") y §10 (atajos), contra `MixOptimizeDialog.tsx`, `useMixOptimize.ts`, `MixSettingsDialog.tsx`, `MixPlanView.tsx`, `KeyboardShortcuts.tsx`, `menu.ts`, `common/types.ts` y las cadenas de `locales/es/translation.json` (todas las usadas por el diálogo, el botón y los bloqueos existen, incluidas las pluralizadas `_one`/`_other`; ninguna falta).

- **I2 ("Optimizar montaje")**: el manual ya lo documentaba (T61 lo añadió al cerrar esa tarea) y, comprobado contra el código, es **exacto**: el botón está "junto al zoom" en la barra de la vista Montaje (`MixPlanView.tsx`, justo antes de los botones de zoom) y también en el menú Proyecto (`menu.ts`, entre "Renderizar el montaje..." y "Vaciar caché de render"); los tres tiempos (5/15/60 s, 15 por defecto), la barra con variantes probadas y mejor resultado, Parar, el antes/después (duración, relleno en s de fotograma completo, columnas vacías), Aplicar/Descartar, el respeto de la ventana y de fijados/grupos/cadenas/secuencia/duración máxima, "solo mejora sin empeorar la otra medida" y los tres motivos de bloqueo (aleatorio, ventana 0, pocos clips movibles) coinciden con `MixOptimizeDialog.tsx` y `useMixOptimize.ts` cadena por cadena.
- **Fallo encontrado (corregido)**: el manual describía el problema que I1 vino a arreglar ("El planificador decide hueco a hueco, sin mirar muy lejos... puede emparejar los de 1/3 entre sí y dejar los de 2/3 solos") como si el planificador **normal** siguiera sin verlo, cuando desde T60 el plan normal ya tiene en cuenta los complementos escasos (§3.11 de 04-diseno) y, con ventana ilimitada, ya resuelve bien el caso del usuario sin pasar por "Optimizar montaje" (ver medición, arriba: 223,5 s frente a los ~290 s de una ventana pequeña). El texto se corrige para explicar que el planificador normal ya evita el problema **dentro de su ventana**, y que "Optimizar montaje" sigue haciendo falta sobre todo con ventanas pequeñas (donde la mejora de I1 no puede alcanzar a un 2/3 lejano) o listas muy agrupadas.
- **I1 (planificador consciente de los complementos)**: es un cambio interno sin UI propia (no hay ajuste ni texto para activarlo o desactivarlo); no le corresponde una sección nueva del manual, pero su efecto se explica ahora en la primera frase de "Optimizar montaje" (arriba) en vez de dejar una descripción obsoleta del bug que ya no existe en el planificador normal.
- **§10 (atajos)**: "Optimizar montaje" no tiene atajo por defecto (`KeyboardShortcuts.tsx`, acción `optimizeMix`) pero no estaba en la lista de "acciones más nuevas... no tienen atajo de teclado por defecto"; añadida.
- **Sin más huecos**: repasado también §5 (Ajustes de montaje → Orden: ventana, "Ilimitado", "Priorizar") contra `MixSettingsDialog.tsx` — el texto de detalle de cada ajuste coincide literalmente (traducido) con el `t(...)` del componente.
- **Consejos prácticos añadidos** (pedidos en el alcance): en la subsección "Optimizar montaje" se añade un párrafo "En la práctica" con la ventana ilimitada como primera opción para listas agrupadas por tamaño, "Optimizar montaje" para ventanas pequeñas (donde el planificador normal no puede alcanzar tan lejos) y la prioridad "Menos relleno" para evitar que la optimización acepte franjas negras/laterales a cambio de acortar el vídeo (visto en la medición de arriba).

### 3. `07-propuestas.md`

Fila v7 (I1, I2) pasada a ✅ (T60, T61). Revisada la redacción en español de todo el catálogo: sin cambios adicionales (ya estaba en español correcto).

### Validación

- En verde: `yarn tsc`, `yarn lint`, `yarn test run` (105 ficheros, 1256 tests), `yarn build` y `yarn test-e2e` (**28/28**, incluidos el 26 "Optimize mix" de T61 y el 24 de bloques). Sin cambios de código (solo `docs/videomix/manual-usuario.md`, `07-propuestas.md` y este task-doc), así que era esperable que siguieran en verde; se ha ejecutado la suite completa igualmente, como pide el criterio de aceptación.

### Dudas para el orquestador

- Ninguna: las dudas de T60 y T61 ya se resolvieron en sus revisiones respectivas.

## Revisión

- **Resultado**: aceptada. M14 cerrado. Validación del agente: tsc, lint, 1256 tests, e2e 28/28 (solo documentación).
