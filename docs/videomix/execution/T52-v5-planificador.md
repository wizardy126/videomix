# T52 · v5: ventana de reorden ilimitada y criterio configurable (G1, G2)

- **Hito**: M12 · **Modelo**: Opus · **Depende de**: — · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§13 (v5)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- `planner/` (`planMix.ts`, `units.ts`, `validatePlan.ts`, `extendPlan.ts`, `truncatePlan.ts`), notas de T10, T10b, T38, T38b, T38c (ventana ilimitada, poda por encaje) y T44b (tolerancia). `MixSettingsDialog.tsx`, `types.ts`, `project.ts` (migraciones).

## Alcance

1. **Diagnóstico**: el usuario obtiene con ventana ilimitada vídeos **más largos y con peor encaje** que con 3 o 10. Construye un banco de proyectos de prueba realistas (clips 16:9 y 9:16 con y sin mín., duraciones variadas, 10–60 clips, con cadenas y secuencia), compara ventanas 0/3/10/ilimitada con métricas (duración, relleno × tiempo, desviación del orden, re-layouts) y encuentra la causa. Corrígela.
2. **Red de seguridad**: el planificador calcula varios planes (la ventana elegida y otras menores, p. ej. 0, 3, 10 y la del usuario) y se queda con el mejor según el criterio de G2. Mide el tiempo en proyectos grandes; si hace falta, acota (p. ej. presupuesto de tiempo, o cancelar candidatos que ya son peores). Determinista.
3. **Criterio configurable (G2)**: ajuste del proyecto `planPriority`: `'duration'` (por defecto: duración → relleno → orden → re-layouts) o `'fill'` (relleno → duración → orden → re-layouts). Modelo (versión y migración si toca, con la convención de las anteriores), UI en Ajustes → Orden, i18n (en + es). El criterio se usa en la red de seguridad y, si tiene sentido, dentro del propio algoritmo.
4. Tests: banco de regresión que garantice "ilimitado nunca peor que 3 o 10" según el criterio, y los casos que revelen la causa.
5. Documentar en [04-diseno](../04-diseno.md) la causa, el arreglo y la red.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde. Tabla de métricas antes/después en las notas.

## Notas de ejecución

### Resumen

- **Causa** (G1): con ventana grande el planificador sigue siendo voraz evento a evento.
  - En cada hueco toma el clip que mejor encaja, venga de donde venga. La sustitución directa gana sin puntuar, y un clip saltado cuesta 0 (T38c).
  - Los clips que encajan mal con los demás (a menudo largos) se aplazan una y otra vez y se acumulan al final. Allí ya no queda con quién acompañarlos: suenan solos o en pocas columnas, y el resto de la fila es relleno.
  - Ni la puntuación de cada evento ni `PlanScore` lo veían: no miden la duración y no cuentan como relleno las columnas vacías del final.
  - Con ventana 3 o 10 era la propia ventana la que obligaba a colocarlos antes.
  - Medido en el banco: la "cola" (tiempo desde el último instante con 2+ clips a la vez hasta el final) pasa de 2419 s (ventana 3) a 3286 s (ilimitada), +36 %, en 200 proyectos 16:9.
  - En media la ventana ilimitada ya era mejor (−3,6 % de duración y −29 % de relleno frente a 3), pero en **1 de cada 4 proyectos** salía más larga que con 3 o con 10. Eso es lo que vio el usuario.
  - Ejemplo real del banco (test "the cause"): 11 clips, ventana 3 → 54,5 s. Ilimitada → 58,3 s: el clip rígido `c4` (23,9 s) se salta en cada hueco por clips que encajan mejor y acaba solo 20 s al final. Con el arreglo, 49,4 s.
- **Arreglo: clips debidos** (`getDueUnit`, `DUE_CONTENT_FACTOR` = 1). Solo con ventana > 10; hasta 10 el planificador es idéntico.
  - En cada evento normal, un clip suelto es debido si su contenido `c` (con su cadena) cumple `c · (maxColumns − 1) ≥ resto`. `resto` = todo lo pendiente sin él, más lo que le queda a la fila.
  - Se toma el primero de la lista que lo cumple y que la ventana deja empezar. Ese evento solo admite opciones que lo empiecen (`getOrderCost` rechaza las demás); si no hay ninguna, se resuelve como antes.
  - No toca la fila inicial, los cambios de cadena ni los forzados.
- **Red de seguridad** (`planMixBest`, `getSafetyNetWindows`, `comparePlanQuality`):
  - se planifica con la ventana del proyecto y con las menores de 10, 3 y 0, y gana la mejor según la prioridad (empate: la ventana mayor);
  - `PlanQuality` = duración, relleno (fracción del fotograma × s: relleno de fila, barras de pillarbox/letterbox y columnas vacías del final), desplazamiento del orden sin tope y re-layouts;
  - comparación lexicográfica con duraciones en pasos de 0,05 s y rellenos en pasos de 0,01 (redondeo, no tolerancia: orden total). Así el mejor de un conjunto nunca es peor que el mejor de un subconjunto, y una ventana mayor nunca sale peor;
  - en 1:1 cada ventana elige su eje por `PlanScore`, como en T29;
  - con prioridad `duration` se abandona un candidato en cuanto seguro que dura más que el mejor (`getDurationBound`, exacta);
  - `PlannerSettings.bestOfWindows: false` la desactiva;
  - la previsualización renderizada (`planRender`) usa la ventana y el eje que eligió el render final, para mostrar el mismo orden.
- **Criterio** (G2):
  - modelo: `settings.planPriority: 'duration' | 'fill'`, por defecto `'duration'`. **v6**, migración v5 → v6 aditiva, como T44 con v5;
  - planificador: `PlannerSettings.priority`, que pasa `toPlannerSettings`;
  - UI: Ajustes → Orden → "Priorizar" ("Duración más corta" / "Menos relleno"), con un texto de ayuda para cada opción;
  - i18n: 5 claves en `en` (en su sitio alfabético) y `es`.
  - Dentro del algoritmo, el criterio solo se usa en la red. Los clips debidos mejoran las dos métricas con el factor 1 (ver "Descartado").
- **Docs**: 04-diseno §1.2 (modelo v6), §3 (entrada/salida), §3.9 y nueva §3.10.
- **Tests**:
  - `planner/safetyNet.test.ts` (nuevo):
    - orden de `comparePlanQuality` con las dos prioridades;
    - ventanas de la red;
    - el caso real de la causa (y que con ventana 10 no cambia);
    - banco de regresión: 25 proyectos realistas × 3 formatos × 2 prioridades. La ilimitada nunca es peor que 10 ni que 3 según la prioridad; plan válido y determinista;
    - el plan es el mejor de sus candidatos y es el de la ventana que declara;
    - la prioridad cambia la elección;
    - `bestOfWindows: false` y ventana 0 son el plan de una sola ventana.
  - `renderOutput.test.ts`: la previsualización tiene el mismo orden que el render final.
  - `project.test.ts`: migración v5 → v6 e ida y vuelta con `'fill'`.
  - Tests existentes:
    - los helpers `settings()` de los tests del planificador llevan `bestOfWindows: false` (prueban el planificador con una ventana; la red tiene su fichero). Las propiedades con ajustes propios sí pasan por la red;
    - 3 tests de `reorderWindow.test.ts` se ajustan al nuevo comportamiento de la ilimitada al final del vídeo (abajo);
    - timeouts más largos en las propiedades que ahora hacen varios planes;
    - el de rendimiento mide la ilimitada sola (< 1 s, como antes) y con la red (< 2 s);
    - versión 5 → 6 en `project.test.ts` y `projectFile.test.ts`.

### Banco de pruebas

Script fuera del repo (scratchpad), con el planificador de `HEAD` (`git archive`) y el nuevo lado a lado.

- **Proyectos**:
  - fuentes 16:9 (1920×1080) y 9:16 (1080×1920) en proporción aleatoria;
  - máx.: fotograma entero, recorte libre (30 %) o "Ajustar a" 1/3, 1/2, 2/3 (15 %); mín. en el 40 %;
  - duraciones de 1,5 a 25 s; 10–60 clips;
  - cadenas de 2–3 clips en la mitad y secuencia en el 30 %;
  - separación 0 o 4; 3 columnas; transición 0,5 s.
- **Variantes** probadas aparte: grupos y fijados, límite de duración, orden aleatorio, 2 y 4 columnas, 120 clips, solo fuentes de un tipo, sin recortes, salida 9:16 y 1:1. En todas se repite el patrón.
- **Métricas** (del script, sobre el plan final):
  - duración;
  - relleno × tiempo (fracción del fotograma × s, con barras y columnas vacías);
  - desplazamiento del orden (Σ |posición − índice|);
  - re-layouts;
  - cola.

### Métricas antes/después (sumas de 200 proyectos por formato)

"Más largos / más relleno" = proyectos en los que el plan es peor que el de `HEAD` con ventana 3 / con ventana 10 (> 0,05 s, > 0,01).

**16:9**

| Plan | Duración (s) | Relleno | Desplaz. | Re-layouts | Cola (s) | Más largos que 3 / 10 | Más relleno que 3 / 10 |
|---|---|---|---|---|---|---|---|
| Antes, ventana 0 | 58 276 | 8357 | 4792 | 3962 | 2251 | 164 / 170 | 169 / 177 |
| Antes, ventana 3 | 53 637 | 5023 | 14 722 | 3203 | 2419 | — | — |
| Antes, ventana 10 | 53 125 | 4165 | 35 562 | 2643 | 2897 | 71 / — | 74 / — |
| **Antes, ilimitada** | 51 525 | 3543 | 65 998 | 2021 | 3286 | **51 / 48** | **50 / 60** |
| Solo clips debidos, ilimitada | 49 700 | 3411 | 66 006 | 1804 | 1436 | 22 / 25 | 47 / 69 |
| **Después, ilimitada (duración)** | **49 093** | 3487 | 55 544 | 1959 | 1613 | **0 / 0** | 36 / 53 |
| **Después, ilimitada (relleno)** | 50 771 | **2915** | 51 196 | 2216 | 1877 | 18 / 17 | **1 / 0** |
| Después, ventana 10 (duración) | 51 824 | 4013 | 26 008 | 2821 | 2464 | 0 / 0 | 26 / 27 |
| Después, ventana 3 (duración) | 53 345 | 5046 | 13 304 | 3239 | 2253 | 0 / 112 | 14 / 121 |

**9:16** (filas)

| Plan | Duración (s) | Relleno | Cola (s) | Más largos que 3 / 10 | Más relleno que 3 / 10 |
|---|---|---|---|---|---|
| Antes, ventana 3 | 59 421 | 6151 | 2608 | — | — |
| Antes, ventana 10 | 58 500 | 5338 | 2962 | 65 / — | 61 / — |
| Antes, ilimitada | 56 580 | 4519 | 3348 | 43 / 43 | 39 / 53 |
| Solo clips debidos, ilimitada | 55 577 | 4501 | 1638 | 25 / 29 | 44 / 62 |
| Después, ilimitada (duración) | **54 742** | 4848 | 1804 | **0 / 0** | 41 / 53 |
| Después, ilimitada (relleno) | 56 745 | **4053** | 2180 | 25 / 19 | **0 / 2** |

**1:1** (los dos ejes)

| Plan | Duración (s) | Relleno | Cola (s) | Más largos que 3 / 10 | Más relleno que 3 / 10 |
|---|---|---|---|---|---|
| Antes, ventana 3 | 66 416 | 14 360 | 2829 | — | — |
| Antes, ventana 10 | 64 506 | 13 247 | 3421 | 66 / — | 64 / — |
| Antes, ilimitada | 63 707 | 13 237 | 3959 | 59 / 67 | 72 / 74 |
| Solo clips debidos, ilimitada | 62 992 | 13 048 | 2640 | 51 / 65 | 70 / 84 |
| Después, ilimitada (duración) | **61 054** | 11 766 | 2831 | **0 / 0** | 17 / 25 |
| Después, ilimitada (relleno) | 61 675 | **11 579** | 2953 | 11 / 17 | **1 / 0** |

- **Lectura**:
  - El arreglo solo ya quita la mayor parte de la cola (−56 % en 16:9) y resuelve 38 de las 71 regresiones frente a la ventana 3 en otros 300 proyectos 16:9. La red se encarga del resto: con la prioridad del proyecto, la ilimitada **nunca** sale más larga (duración) o con más relleno (relleno) que 3 o 10.
  - En total, con prioridad `duration`: −8,5 % de duración frente a la ventana 3 de antes y −4,7 % frente a la ilimitada de antes (16:9).
  - Los "1 / 0" y "0 / 2" de relleno con la prioridad `relleno` son diferencias de medida. El script mide el plan final (con la ampliación de E7 y su propia fórmula de barras); el planificador compara el plan antes de E7 (ver Decisiones). Con la medida del planificador, el test garantiza 0.
- **Ventanas ≤ 10**: sin la red son **idénticas a `HEAD`**. Lo comprobé con 2500 planes: 500 proyectos del banco con grupos, fijados y límite, en los tres formatos, de 1 a 6 columnas, con ventanas 0, 1, 3, 5 y 10. Los snapshots no cambian.
- **Abandono de candidatos**: da exactamente la misma elección que calcular todos. Lo comprobé con 800 elecciones: 400 proyectos con fijados, grupos y límite, las dos prioridades, transición 0, 0,5 y 2 s.
- **Frecuencia de cada ventana ganadora** (300 proyectos, ilimitada):
  - prioridad `duration`: ilimitada 185, 10 57, 3 40, 0 18;
  - prioridad `fill`: ilimitada 145, 10 91, 3 49, 0 15.
  - Todas ganan alguna vez, así que no se quita ninguna.

### Coste de la red (medido, caliente, sin la validación de desarrollo; máquina compartida y ruidosa)

| Caso (200 clips, ilimitada) | Antes | Después (duración) | Después (relleno) |
|---|---|---|---|
| Banco realista 16:9 (media / máx.) | 20 ms | 27–31 / 36–54 ms | 34 ms |
| Banco realista 1:1 (media / máx.) | 108 ms | 165 / 180 ms | 161 ms |
| Sintético 16:9, 3 columnas, con todo | 144–217 ms | 132–144 ms | 124–159 ms |
| Sintético 16:9, 6 columnas, con todo | 255–288 ms | 438–591 ms | 437–549 ms |
| Sintético 1:1, 6 columnas, con todo (peor caso) | 355–431 ms | 673–733 ms | 677–730 ms |

- "Con todo" = 8 grupos, 20 fijados, 20 cadenas, secuencia y límite, como en T38c.
- El coste extra es el de las ventanas 10, 3 y 0, más baratas que la ilimitada. El abandono por duración ayuda poco con 6 columnas: la cota divide lo pendiente entre `maxColumns`.
- No acoté más: el peor caso sintético sigue por debajo de 1 s en caliente y los proyectos realistas tardan < 0,2 s. Sí lo haría si el orquestador lo prefiere, por ejemplo quitando la ventana 0 con ventanas grandes o limitando la red por tamaño de proyecto (determinista).
- El test de rendimiento pide < 2 s con la red (antes < 1 s); en la suite completa en paralelo la red llegó a medir 1,07 s.

### Descartado (medido en el banco, 200 proyectos 16:9, ilimitada)

| Variante | Duración | Relleno | Cola |
|---|---|---|---|
| Antes | 51 525 | 3543 | 3286 |
| Sustitución directa solo hasta 10 posiciones por delante | 51 470 | 3485 | 3187 |
| Coste por dejar atrás clips (más de 10 posiciones, 1 por posición y elección) | 52 133 | 3507 | 3210 |
| Sustitución directa hasta 10 + coste por dejar atrás | 53 167 | 3634 | 2884 |
| Clips debidos, factor 0,5 | 51 023 | 3530 | 2220 |
| **Clips debidos, factor 1 (elegido)** | **49 690** | **3421** | **1287** |
| Clips debidos, factor 1,5 | 48 671 | 3505 | 971 |
| Clips debidos, factor 2 | 46 986 | 3805 | 700 |

- Limitar la sustitución directa apenas cambia nada.
- El coste por dejar atrás reduce la cola, pero baja la densidad de columnas y alarga el vídeo.
- Con factor 1 bajan duración y relleno en todos los bancos. Con 1,5–2 baja más la duración pero sube el relleno; la red ya permite elegir.
- **Debido "el más largo" en vez de "el primero de la lista"**: misma calidad (49 690 frente a 49 700), pero desordena más al final. Me quedo con el primero de la lista (E8: el orden de la lista desempata).
- **Aplicarlo también a ventanas ≤ 10** mejora esas ventanas (3: 53 637 → 52 020; 10: 53 125 → 51 388), pero cambia sus planes y snapshots. No lo hago (ver Dudas).

### Decisiones

1. **Clips debidos solo con ventana > 10**: lo conservador. El problema reportado es de la ilimitada, y así las ventanas ≤ 10 siguen dando exactamente los planes de antes.
2. **Ventanas de la red**: la del proyecto más 10, 3 y 0 por debajo de ella (el ejemplo del task-doc). Con una ventana de 5: 5, 3 y 0.
3. **Empates**: gana la ventana mayor, la más cercana a lo que eligió el usuario.
4. **Pasos de comparación**: 0,05 s (menos de 2 fotogramas a 30 fps) y 0,01 de relleno (1 % del fotograma durante 1 s). Son un orden total, así que la garantía "mayor nunca peor" es exacta. En la práctica casi nunca empatan dos duraciones: el relleno desempata sobre todo planes que terminan igual.
5. **Calidad antes de E7**: como `PlanScore` y la elección del eje (T38b: la ampliación es el último recurso y no cambia las decisiones). El test de E7 "mismas decisiones con y sin ampliación" sigue valiendo con la red.
6. **Eje en 1:1**: cada ventana elige su eje por `PlanScore`, como hasta ahora. Elegir el eje una sola vez (con la ventana del proyecto) sería más barato, pero rompería la garantía en 1:1.
7. **Versión v6**: el único cambio de modelo de M12. Sigo la convención de T36 y T44 (una versión por hito con cambios de modelo, migración aditiva). Una versión anterior de la app rechaza el fichero en vez de perder el ajuste al guardar.
8. **Previsualización renderizada**: usa la ventana y el eje del render final. Un orden distinto en la previsualización despistaría, como el cambio de eje que ya evitaba T29. Cuesta un plan a tamaño final más al previsualizar.
9. **Vista Mix, estimación "≈ m:ss" y overlays**: usan `planRender` y por tanto la red, sin cambios en esos ficheros.

### Efecto en proyectos existentes

- La red se aplica a cualquier ventana, también a la 3 por defecto, que ahora compara 3 y 0. Algunos planes cambian cuando otra ventana da un plan mejor según la prioridad.
- Ejemplo: el proyecto de e2e (3 clips, 2 columnas, 1280×720) pasa de 6,5 s a 5,0 s. Con ventana 0, los clips van en el orden de la lista y el segundo 16:9 queda con letterbox junto al vertical. Antes, el 16:9 iba primero a pantalla completa y el vertical sonaba solo al final.
  - Con prioridad "relleno" también gana ese plan: 2,19 de relleno frente a 2,43, contando las columnas vacías del final.
- Las cachés de render se invalidan solas donde cambia el plan (la clave es el grafo, T28).

### Validación

- En verde, en la pasada final: `yarn tsc`, `yarn lint`, `yarn test run` (96 ficheros, 1175 tests), `yarn build` y `yarn test-e2e` (24/24).
- **e2e 8a** (única línea cambiada en `e2e/videomix.e2e.ts`): con la red, el plan de este proyecto dura 5,0 s (ver arriba) y el vertical suena solo en los últimos 1,5 s. La medida de audio "lejos del keyframe" (`seekTo(0.7)`) puede terminar con el vídeo, que se pausa solo, y entonces el clic en "Pausa" fallaba 30 s después. Fallaba siempre, en dos pasadas.
  - Ahora pausa si sigue reproduciendo y comprueba que queda en pausa. La medida (el audio suena tras una búsqueda larga) no cambia y pasa: `farFromKeyframe` = 0,038.
- En una pasada falló una vez el e2e 14 al arrastrar un clip a la secuencia (arrastre bajo carga: la máquina estaba a carga ~30 con los otros agentes). No tiene que ver con el plan y pasó en las otras tres pasadas.
- El test de rendimiento de `reorderWindow.test.ts` falló una vez en la suite completa bajo esa carga: 1,015 s con la ilimitada sin red, frente a < 1 s. Solo pasa. Mis cambios no afectan a ese tiempo: "solo clips debidos" mide lo mismo que `HEAD` en `perf.ts`.

### Dudas para el orquestador

1. ¿Aplicar los clips debidos también a ventanas ≤ 10? Mejora de media 3 y 10 (−3 % de duración, relleno parecido), pero cambia sus planes y snapshots.
2. Pasos de comparación (0,05 s y 0,01): ¿le vale al usuario "más corto" con esa resolución, o prefiere un margen mayor (p. ej. 1 s) para que el relleno decida más a menudo?
3. Coste: peor caso sintético ~0,7 s (antes ~0,4 s). ¿Acotar más?
4. El manual de usuario (Ajustes → Orden → Priorizar) queda para T55.
5. La prioridad "duración" acepta un letterbox si acorta el vídeo (proyecto de e2e: −1,5 s con un 16:9 en letterbox durante 2 s). Es lo que pide el criterio (la duración va antes que el relleno), pero conviene confirmarlo con el usuario, porque cambia planes de proyectos existentes con la ventana 3 por defecto.

## Revisión

## Revisión

- **Resultado**: aceptada. Dudas: (1) los clips pendientes no se aplican a ventanas ≤ 10 (se mantienen idénticas); (2)–(3) pasos de comparación y coste aceptados; (4) el manual va en T55; (5) se informa al usuario de que "duración" puede aceptar un letterbox breve para acortar el vídeo (tiene "menos relleno" como alternativa).
- **Corrección del orquestador**: el e2e 8a vuelve a buscar y reproducir si la previsualización llega al final antes de oírse (el nuevo plan deja solo 1,5 s tras la búsqueda).
- **Validación del orquestador**: tsc, lint, 1175 tests, e2e 24/24 dos veces.
