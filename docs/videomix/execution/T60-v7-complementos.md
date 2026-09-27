# T60 · v7: planificador consciente de los complementos (I1)

- **Hito**: M14 · **Modelo**: Opus · **Depende de**: — · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§15 (v7)**, §4, §11 (E2, E4, E5, E7, E8), §13 (G1, G2); [03-convenciones](../03-convenciones.md); [04-diseno](../04-diseno.md) §2–§3 (planificador, §3.10 red de seguridad).
- Notas de ejecución de T10, T10b, T38, T38b, T38c, T44b y **T52** (causa de la ventana ilimitada, clips pendientes, red de seguridad, banco de pruebas).

## Alcance

1. **Reproducir** el caso del usuario en un test y en el banco de T52: 40 clips (16 de 1/3, 6 de 1/2, 18 de 2/3, con duraciones variadas y realistas), en órdenes de lista que agrupen los de cada tipo (p. ej. bloques de 1/3 seguidos) y en órdenes mezclados; ventana 3, 10 e ilimitada; ambas prioridades. Métricas: duración, relleno × tiempo, tiempo con columnas vacías, nº de 2/3 que salen sin pareja. Calcula también una cota de referencia (emparejamiento ideal ignorando duraciones) para saber cuánto margen hay.
2. **Mejora**: que el coste de cada decisión tenga en cuenta la demanda futura de complementos (qué clips pendientes solo encajan con qué otros, y cuántos quedan de cada tipo) para no gastar compañeros escasos en combinaciones que no los necesitan, y para favorecer emparejar primero a los que tienen menos opciones. Debe respetar las restricciones existentes (fijaciones, grupos, cadenas, secuencia, duración máxima, clips pendientes de T52) y seguir siendo determinista y rápido (medir; mismo orden de magnitud que hoy).
3. Banco de regresión: el caso del usuario mejora claramente; el banco general de T52 no empeora (tabla antes/después); la garantía "ilimitado nunca peor que 3/10" se mantiene.
4. Documentar en [04-diseno](../04-diseno.md).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde; tablas de métricas en las notas.

## Notas de ejecución

### Resumen

- **Causa** (reproducida): el planificador es voraz evento a evento.
  - En la fila inicial, un trío de 1/3 y un 2/3 + 1/3 llenan igual la fila (coste 0) y gana el orden de la lista. Con los 1/3 al principio de la lista, gana el trío.
  - Formado el trío, cada 1/3 que termina se sustituye **directamente** por el siguiente 1/3 (prioridad absoluta, 04-diseno §3.3). La fila solo cambia cuando se acaban los 1/3.
  - Después, los 2/3 ya no tienen con quién ir: suenan solos con 1/3 de relleno, uno detrás de otro.
  - Nada en el coste miraba el futuro: ni la puntuación de cada opción ni la red de seguridad (que solo elige entre ventanas) veían que los 1/3 son los **únicos** compañeros de los 2/3. Por eso "duración más corta" y "menos relleno" daban casi lo mismo.
- **Arreglo** (`planMix.ts`, 04-diseno §3.11): un término nuevo en el coste de cada decisión, `complementCost`.
  - **Dependiente**: clip pendiente que no llena la fila solo ni con 2 o más clips pendientes; necesita un **compañero** con el que llenar una fila de dos. A 16:9 con 3 columnas: el 2/3 (solo lo completa un 1/3) y el 1/2 (solo otro 1/2). El 1/3 no es dependiente (tres 1/3 llenan la fila).
  - **Compañero escaso**: cada dependiente reparte su duración entre sus compañeros en proporción a la de ellos; un compañero es escaso si la demanda que recibe, `Σ duración(dependiente) / Σ duración(sus compañeros)`, llega a 1.
  - **Coste**: un compañero escaso que entra en una columna que llena, **sin ningún dependiente suyo en la fila**, cuesta `COMPLEMENT_WEIGHT` (0,5) × `FILL_WEIGHT` × (ancho que ocuparía junto a sus dependientes / W) × su duración. Es el relleno con el que probablemente sonará un dependiente.
  - **Sustitución directa**: si el clip que encaja tiene ese coste, pierde la prioridad absoluta y compite con las demás opciones. Si no, todo sigue igual.
  - "Emparejar primero a los que tienen menos opciones" sale solo: el 1/3 junto a un 2/3 no cuesta nada; en un trío, sí.
  - **Alcance con ventana finita**: solo cuentan como compañeros los clips a ≤ `2N + maxColumns − 1` posiciones en el orden base. Con ventana ilimitada, todos (agrupados por anchos para que sea rápido).
- **API**: sin cambios. `planMix`, `planMixBest`, `planMixAxis`, `comparePlanQuality`, `getSafetyNetWindows` y los tipos son los mismos. Solo cambian las decisiones internas.
- **Restricciones**: el término solo cambia la puntuación entre opciones válidas. No se suma en las opciones forzadas (grupos obligatorios, fijados atrasados, drenado). Fijaciones, grupos, cadenas, secuencia, duración máxima, clips debidos (T52) y ventana se respetan igual. La garantía "ilimitada nunca peor que 10 o 3" es de la red de seguridad y se mantiene (tests de `safetyNet.test.ts` y `complements.test.ts`).
- **Determinista**: no hay aleatoriedad; los mapas se recorren en orden de inserción (orden base).
- **Docs**: 04-diseno §3.3 (excepción de la sustitución directa), §3.4 (fila de la tabla y nota en el criterio equilibrado) y nueva §3.11. La §3.12 es de T61.
- **Tests**:
  - `planner/complements.test.ts` (nuevo, 9 tests):
    - un 2/3 recibe un 1/3 en vez de formarse un trío (antes: trío);
    - con compañeros de sobra, manda el orden de la lista (igual que antes);
    - los 1/2 se emparejan entre sí;
    - un 16:9 flexible que es el único compañero de un 1:1 comparte la fila (antes: pantalla completa y luego el 1:1 solo, 19,5 s → 10 s);
    - con ventana 3, un bloque de 1/3 que la ventana obliga a empezar forma el trío como antes (alcance);
    - el caso del usuario, 1/3 en bloque, ilimitada: < 215 s, relleno < 10 y como mucho un 2/3 solo (antes: 236,1 s, 39,8 y 7); con ventana 10, < 240 s (antes 248,9);
    - el caso del usuario en dos órdenes × 3 semillas × 2 prioridades: plan válido, determinista, e ilimitada nunca peor que 10 ni que 3;
    - propiedades: 150 proyectos de fracciones con fijados, grupos, cadenas, secuencia, límite, 2–4 columnas y ventanas 0 a ilimitada, con y sin red: invariantes y determinismo.
  - `planMix.test.ts`, "balanced columns: full screen…": se añade un segundo 16:9 (`h2`) para que el 1:1 tenga compañeros de sobra; así sigue probando el criterio equilibrado de T10b. El caso con un único compañero pasa a `complements.test.ts` (ver Decisiones, 4).
  - `reorderWindow.test.ts`, rendimiento: el límite de la ventana ilimitada sin red pasa de 1 s a 1,5 s (ver Coste). Con la red sigue en 2 s.
  - Los *snapshots* no cambian.

### Reproducción: el caso del usuario

Script fuera del repo (scratchpad): el planificador de `HEAD` (`git archive`) y el nuevo lado a lado, empaquetados con esbuild. El test `complements.test.ts` usa el mismo generador.

- **Proyecto**: 40 clips "Ajustar a" 1/3 (16), 1/2 (6) y 2/3 (18) de la salida 1920×1080, sin mín., de fuentes 16:9 y 9:16 al 50 %. Duraciones: 85 % entre 4 y 20 s, 15 % entre 2 y 5 s. 3 columnas, sin separación, transición 0,5 s, red de seguridad activa.
- **Órdenes de la lista**:
  - `bloques`: 16 × 1/3, 6 × 1/2, 18 × 2/3 (el caso del usuario: los 1/3 juntos);
  - `bloques inv.`: el orden inverso (2/3 primero);
  - `tandas`: tandas de 2–5 clips del mismo tipo (clips grabados seguidos);
  - `mezclado`: barajado.
- **Métricas** (medias de 20 semillas de duraciones):
  - duración (s);
  - relleno × tiempo: fracción del fotograma × s sin clip (`PlanQuality.fill`: relleno de fila, barras y columnas vacías del final);
  - columnas vacías: segundos en que alguna columna del layout no muestra clip (final del vídeo);
  - 2/3 sin pareja: clips 2/3 que se ven solos más de la mitad de su tiempo.
- **Referencia** ("emparejamiento ideal ignorando duraciones"): todos los 1/3 acompañan a un 2/3, los 1/2 van por parejas y los 2/3 no se solapan entre sí. Duración ≈ Σ 2/3 + Σ 1/2 / 2 + (Σ 1/3 − Σ 2/3)⁺ / 3, menos un fundido por cambio. Relleno ≈ (Σ 2/3 − Σ 1/3)⁺ / 3. 2/3 sin pareja = 18 − 16 = 2. No es una cota estricta: el planificador puede poner un 1/2 o un 2/3 con letterbox junto a otro clip, y una columna de 1/3 va cambiando de clip mientras dura un 2/3 largo. Por eso a veces sale por debajo.

Antes → después (prioridad "duración"; con "relleno" los números son casi iguales, ver abajo):

| Orden | Ventana | Duración (s) | Relleno | Col. vacías (s) | 2/3 sin pareja | Referencia: duración / relleno / sin pareja |
|---|---|---|---|---|---|---|
| **bloques** | 3 | 266,6 → 264,9 | 63,3 → 62,5 | 0,0 → 0,0 | 16,9 → 16,4 | 218,7 / 12,5 / 2 |
| **bloques** | 10 | 257,0 → 249,9 | 57,6 → 51,1 | 0,0 → 0,0 | 13,8 → 10,3 | 218,7 / 12,5 / 2 |
| **bloques** | **ilimitada** | **252,3 → 206,9** | **55,8 → 9,7** | 0,0 → 3,8 | **12,3 → 0,9** | 218,7 / 12,5 / 2 |
| bloques inv. | 3 | 262,8 → 262,7 | 62,8 → 62,7 | 10,5 → 10,5 | 16,4 → 16,3 | 208,9 / 6,8 / 2 |
| bloques inv. | 10 | 245,5 → 244,7 | 47,2 → 46,4 | 10,7 → 10,9 | 11,4 → 11,2 | 208,9 / 6,8 / 2 |
| bloques inv. | ilimitada | 206,0 → 205,9 | 7,8 → 7,7 | 5,2 → 5,1 | 0,6 → 0,6 | 208,9 / 6,8 / 2 |
| tandas | 3 | 229,1 → 227,9 | 35,7 → 31,2 | 2,8 → 2,7 | 6,8 → 5,8 | 213,7 / 8,3 / 2 |
| tandas | 10 | 216,2 → 215,3 | 19,5 → 16,1 | 3,1 → 2,5 | 3,2 → 2,6 | 213,7 / 8,3 / 2 |
| tandas | ilimitada | 211,5 → 206,2 | 15,8 → 7,7 | 3,1 → 3,6 | 2,3 → 0,7 | 213,7 / 8,3 / 2 |
| mezclado | 3 | 219,6 → 219,4 | 20,5 → 19,1 | 4,0 → 2,9 | 2,2 → 2,0 | 216,9 / 9,1 / 2 |
| mezclado | 10 | 213,7 → 212,7 | 13,2 → 11,0 | 2,0 → 2,6 | 1,1 → 0,8 | 216,9 / 9,1 / 2 |
| mezclado | ilimitada | 208,7 → 209,1 | 8,7 → 8,2 | 4,9 → 4,7 | 0,6 → 0,6 | 216,9 / 9,1 / 2 |

- Prioridad "relleno", bloques con ilimitada: 252,4 → 206,9 s, 55,8 → 9,7, 12,3 → 0,9 sin pareja. En el resto de filas la diferencia con "duración" es < 2 s y < 1,5 de relleno.
- **Lectura**:
  - El caso del usuario (bloques, ilimitada) pasa de −15 % sobre la referencia a estar en ella: −45 s (−18 %), relleno −83 %, de 12 a menos de un 2/3 sin pareja. Sube un poco el tiempo con columnas vacías al final (0 → 3,8 s): antes el final era un 2/3 solo con relleno en la fila, que no cuenta como columna vacía; ahora la última pareja termina a destiempo.
  - Con ventana 10 también mejora (−7 s). Con ventana 3 casi nada: los 1/3 en bloque son obligatorios antes de que la ventana llegue a los 2/3. Eso lo resuelve "Optimizar montaje" (T61), que puede reordenar la lista.
  - Con los 2/3 primero (bloques inv.), la ventana 3/10 obliga a empezar los 2/3 solos: el término no puede hacer nada (no hay compañeros a su alcance). Con ilimitada ya se emparejaban antes.
  - "Mezclado, ilimitada" es la única fila con la duración media algo peor (+0,4 s, +0,2 %), con menos relleno. Es ruido del voraz: en semillas sueltas va ±3 s en los dos sentidos.
- **Ejemplo** (semilla 1, bloques, ilimitada; test "1/3 clips in a block"): 236,1 s, relleno 39,8 y 7 clips 2/3 solos → **209,6 s, 6,1 y 0**. Referencia: 213,2 s.

### Banco de regresión de T52 (antes → después, sumas de 200 proyectos por formato)

El generador de T52 (`realisticInput` de `safetyNet.test.ts` con 10–60 clips, semillas 1–200), red de seguridad activa. "Peor / mejor": proyectos en que el plan nuevo es más largo / más corto que el de antes (> 0,05 s) o tiene más / menos relleno (> 0,01).

| Formato | Ventana | Prioridad | Duración (s) | Relleno | Más largos / más cortos | Más relleno / menos |
|---|---|---|---|---|---|---|
| 16:9 | 3 | duración | 53 134 → 53 123 | 4838 → 4811 | 11 / 17 | 12 / 21 |
| 16:9 | 3 | relleno | 53 848 → 53 779 | 4699 → 4687 | 11 / 18 | 13 / 21 |
| 16:9 | 10 | duración | 51 775 → 51 655 | 3993 → 3891 | 18 / 29 | 13 / 40 |
| 16:9 | 10 | relleno | 52 971 → 52 761 | 3569 → 3481 | 16 / 35 | 19 / 40 |
| 16:9 | ilimitada | duración | 49 164 → 48 783 | 3658 → 3511 | 29 / 40 | 29 / 46 |
| 16:9 | ilimitada | relleno | 51 469 → 50 987 | 2872 → 2748 | 27 / 47 | 25 / 55 |
| 9:16 | 3 | duración | 58 833 → 58 567 | 5958 → 5865 | 11 / 35 | 16 / 32 |
| 9:16 | 3 | relleno | 59 482 → 59 270 | 5720 → 5627 | 13 / 34 | 16 / 33 |
| 9:16 | 10 | duración | 56 924 → 56 740 | 5186 → 5084 | 13 / 50 | 22 / 44 |
| 9:16 | 10 | relleno | 58 432 → 58 252 | 4611 → 4445 | 19 / 50 | 24 / 48 |
| 9:16 | ilimitada | duración | 54 725 → 54 488 | 4642 → 4567 | 26 / 59 | 34 / 54 |
| 9:16 | ilimitada | relleno | 57 134 → 56 778 | 3804 → 3660 | 26 / 62 | 35 / 61 |
| 1:1 | 3 | duración | 66 199 → 65 454 | 14 356 → 13 905 | 24 / 55 | 24 / 68 |
| 1:1 | 3 | relleno | 66 378 → 65 581 | 14 240 → 13 804 | 22 / 56 | 21 / 71 |
| 1:1 | 10 | duración | 63 751 → 62 683 | 12 737 → 12 002 | 23 / 94 | 25 / 100 |
| 1:1 | 10 | relleno | 64 058 → 62 811 | 12 579 → 11 915 | 23 / 91 | 25 / 99 |
| 1:1 | ilimitada | duración | 61 780 → 60 925 | 11 982 → 11 169 | 40 / 83 | 30 / 96 |
| 1:1 | ilimitada | relleno | 62 264 → 61 253 | 11 727 → 11 028 | 38 / 82 | 29 / 96 |

- **No empeora**: la duración total y el relleno total bajan en las 18 combinaciones. En cada proyecto el voraz puede salir mejor o peor, pero en todas las combinaciones mejoran más proyectos de los que empeoran (entre 1,4 y 4 veces más).
- **"Ilimitado nunca peor que 3/10"**: lo garantiza la red de seguridad por construcción (T52) y lo comprueban `safetyNet.test.ts` (75 proyectos × 2 prioridades) y `complements.test.ts` (caso del usuario), en verde.

### Variantes medidas (descartadas)

Caso del usuario (20 semillas, 4 órdenes, ilimitada) y banco de T52 (100–200 proyectos, ilimitada). Todas mejoran mucho el caso del usuario en bloques; la diferencia está en el resto.

| Variante | Resultado |
|---|---|
| Escasez proporcional (`min(1, demanda)`), en cualquier columna (pesos 0,5 y 1) | Bloques bien (258,8 → 209,7 s con 5 semillas), pero bloques inv. peor (211,0 → 215,4) y 16:9 del banco algo peor en duración (+46 s en 100 proyectos). Castigaba poner un 1/2 con letterbox junto a un 2/3 que, si no, suena solo. |
| Solo si el compañero **llena su columna** (elegida) | Arregla lo anterior: bloques inv. 211,0 → 210,2. |
| Escasez proporcional frente a binaria (demanda ≥ 1, **elegida**) | La proporcional cambia más proyectos para menos ganancia: 9:16 ilimitada, duración 25 802 → 25 887 (peor) frente a → 25 728 (mejor) con 100 proyectos. Una escasez suavizada `2·demanda − 1` queda entre las dos. |
| Peso 0,25 / **0,5** / 1 / 2 | Muy parecidos; 0,5 algo mejor en 16:9 (49 164 → 48 757 frente a 48 769 con 1, 200 proyectos, ilimitada). |
| Ancho del compañero = su ancho preferido | Igual en el caso del usuario (anchos rígidos). Con compañeros flexibles exageraba el coste (un 16:9 flexible contaba 1920 px en vez de los 840 que ocuparía junto al 1:1). Se usa el ancho junto a sus dependientes. |
| Sin alcance con ventana finita | Muy peor: bloques con ventana 3, 266,6 → 302,0 s y relleno 63 → 99. Guardaba los 1/3 para 2/3 que la ventana no deja alcanzar. |
| Solo con ventana > 10 (como los clips debidos de T52) | Ventanas 3 y 10 idénticas a antes. Descartada porque, con el alcance, 3 y 10 también mejoran en los dos bancos (ver Decisiones, 1). |
| Sustitución directa: saltar al primer clip que encaja **sin** coste de complementos | Misma calidad (±0,1 %) y no abarata el peor caso. Se queda la versión simple: el clip penalizado compite con las demás opciones. |

### Coste (medido, caliente, sin la validación de desarrollo; máquina compartida con el otro agente, ±20 %)

200 clips, mejor de 5 llamadas a `planMixBest`. "Con todo" = 8 grupos, 20 fijados, 20 cadenas, secuencia y límite (como en T38c/T52).

| Caso (200 clips) | Ventana | Sin red: antes → después (ms) | Con red: antes → después (ms) |
|---|---|---|---|
| Realista 16:9 (banco de T52) | 3 | 6 → 9 | 9 → 19 |
| Realista 16:9 (banco de T52) | ilimitada | 17 → 32 | 26 → 57 |
| Realista 1:1 (banco de T52) | 3 | 9 → 15 | 14 → 27 |
| Realista 1:1 (banco de T52) | ilimitada | 91 → 126 | 134 → 203 |
| Sintético 16:9, 3 col. | ilimitada | 42 → 60 | 74 → 95 |
| Sintético 16:9, 3 col., con todo | ilimitada | 98 → 112 | 99 → 166 |
| Sintético 16:9, 6 col. | ilimitada | 26 → 72 | 64 → 143 |
| Sintético 16:9, 6 col., con todo | ilimitada | 184 → 227 | 322 → 387 |
| Sintético 1:1, 3 col., con todo | ilimitada | 218 → 206 | 257 → 335 |
| Sintético 1:1, 6 col. | ilimitada | 55 → 127 | 165 → 263 |
| Sintético 1:1, 6 col., con todo (peor caso) | 3 | 76 → 104 | 111 → 132 |
| **Sintético 1:1, 6 col., con todo (peor caso)** | ilimitada | **293 → 345** | **543 → 888** |
| Caso del usuario (40 clips, bloques) | ilimitada | 4 → 3 | 4 → 6 |

- En proyectos realistas de 200 clips sigue en unos 0,2 s o menos con la red, y el caso del usuario tarda unos ms.
- El cálculo de los complementos en sí es barato (unos 5–10 % del tiempo en el peor caso): se recalcula solo cuando empieza algún clip, de forma perezosa (solo para los clips por los que preguntan las opciones), con alcance en las ventanas finitas y por tipos de anchos en las ilimitadas.
- Lo que cuesta es que la sustitución directa deja de ser segura cuando el clip es un compañero escaso: entonces se evalúan todas las opciones y las cotas de §3.9 podan menos (la mejor opción lleva el coste de complementos). En "en su sitio" ahora se comprueba la cota antes de calcular la reserva de los fijados (exacto, no cambia el plan).
- Mismo orden de magnitud: el peor caso sintético pasa de ~0,3 s a ~0,35 s sin la red y de ~0,55 s a ~0,9 s con ella (entre 1,2 y 2,5 veces en los casos sintéticos, que tienen muchos rígidos de proporciones distintas). El test de rendimiento de `reorderWindow.test.ts` (con la validación de desarrollo) falló dos veces en la suite completa con la máquina a carga 8–14 (1,17 y 1,48 s frente a < 1 s); solo pasa en 0,4 s. T52 ya lo vio fallar una vez a 1,015 s. Subo su margen a 1,5 s.

### Decisiones

1. **Todas las ventanas**, no solo las grandes. I1 pide el planificador consciente en modo normal, sin distinguir ventanas, y el caso del usuario también mejora con 10. Con el alcance (`2N + maxColumns − 1`), las ventanas 3 y 10 mejoran de media en los dos bancos. Cambia algunos planes de proyectos existentes con la ventana 3 por defecto (siempre respetando la ventana). Si se prefiere que las ventanas ≤ 10 sigan idénticas (como en T52), basta una condición en `complementCost` (medido arriba).
2. **Escasez binaria** (demanda ≥ 1): es lo que diría un reparto óptimo (el precio de un compañero solo es positivo si no sobran). Por debajo de 1 hay compañeros de sobra y castigarlos cambiaba más planes para menos ganancia.
3. **Solo compañeros que llenan su columna**: uno con pillarbox/letterbox ya paga su relleno, y a menudo es buena idea (un 1/2 con letterbox junto a un 2/3 que, si no, sonaría solo).
4. **Criterio equilibrado (T10b)**: con un 16:9 flexible que es el **único compañero** de un 1:1 rígido, ahora comparten la fila (el 16:9 pierde el 56 % de su máx.) en vez de ir a pantalla completa y dejar luego el 1:1 solo con 840 px de relleno: 10 s en vez de 19,5 s. Es lo que pide I1 ("penaliza gastar clips que harán falta más adelante como compañeros"), pero matiza una decisión del usuario de T10b; con compañeros de sobra el criterio sigue igual. Ver Dudas, 1.
5. **Opciones forzadas sin el término** (grupos al final de su ventana, fijados atrasados, drenado): son obligatorias y ya se comparan por la reserva de los fijados; así su comportamiento no cambia.
6. **Pool de pendientes**: clips por empezar (sueltos, grupos, primeros de cadena) y fijados. Los clips siguientes de una cadena no cuentan como pendientes (no se eligen: siguen a su cadena). Los clips que ya suenan no generan demanda (ya están en su fila), pero sí cuentan como dependientes vecinos al decidir si un compañero "acompaña".
7. **Aproximación en las sumas** (dependiente = no llena la fila con 2 o más clips): la suma de intervalos puede contar dos veces el mismo clip. Solo importa con los últimos de un tipo (p. ej. un único 1/3 restante se sigue viendo "capaz" de formar trío), cuando ya no hay nada que emparejar.

### Validación

- En verde, en la pasada final (árbol compartido con T61 en curso): `yarn tsc`, `yarn lint`, `yarn test run` (105 ficheros, 1256 tests), `yarn build` y `yarn test-e2e` (28/28, incluido el 26 de T61).
- En una pasada intermedia fallaron 2 tests de `optimizeOrder.test.ts` (T61, entonces a medias): "the user's case: clearly better than the normal plan" esperaba que el optimizador mejorase el plan normal, y con este arreglo el plan normal ya es mucho mejor. En las pasadas siguientes, con la versión actual de T61, pasan. Conviene que T61 no dependa de que el plan normal del caso del usuario sea malo.
- El test de rendimiento de `reorderWindow.test.ts` falló dos veces en la suite completa con la máquina cargada (ver Coste); con el margen de 1,5 s pasa.

### Dudas para el orquestador

1. **Criterio equilibrado frente a I1** (Decisiones, 4): ¿se confirma con el usuario que un clip que es el único compañero de otro prefiera compartir la fila recortándose más del ~40 % antes que ir a pantalla completa y dejar al otro solo? Es coherente con I1 y acorta el vídeo, pero cambia un ejemplo de T10b (el test se ha adaptado).
2. **Ventanas ≤ 10** (Decisiones, 1): cambian algunos planes con la ventana 3 por defecto (a mejor de media). ¿Se mantiene o se limita a ventanas grandes como T52?
3. **Coste**: el peor caso sintético sube ~30 % y el test de rendimiento pasa a 1,5 s de margen. ¿Aceptable?

## Revisión

- **Resultado**: aceptada. Dudas: (1) se acepta que I1 prevalezca sobre el ejemplo de T10b (vídeo más corto); (2) se aplica a todas las ventanas (mejoran en los dos bancos); (3) coste y límite de 1,5 s aceptados.
- **Validación del orquestador** (con T61): tsc, lint, 1256 tests, e2e 28/28.
