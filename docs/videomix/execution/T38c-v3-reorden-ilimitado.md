# T38c · v3: ventana de reorden ilimitada y ampliable (E8)

- **Hito**: M9 · **Modelo**: Opus · **Depende de**: T38b · **Estado**: hecha

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §11 (E8)
- Notas de T10 (ventana de orden y `SUBSET_BUDGET`: la poda conserva los candidatos más antiguos) y de T10b, T30, T38 y T38b
- `MixSettingsDialog` (sección Orden)

## Alcance

1. **Modelo**:
   - `settings.reorderWindow: number | 'unlimited'`;
   - esquema ampliado, aditivo y compatible con v4 (sin cambio de versión, salvo que resulte imprescindible);
   - sin tope superior en el esquema, más allá de enteros ≥ 0; se valida.
2. **Planificador**:
   - con ventana grande o ilimitada, la selección de candidatos no puede limitarse a "los más antiguos";
   - hay que priorizar los que **encajan** en el hueco (intervalo de proporciones compatible con el ancho libre, o que eliminan relleno) y completar con los más antiguos hasta el presupuesto;
   - el orden de la lista sigue pesando como desempate (`ORDER_WEIGHT`);
   - `validatePlan` acepta `'unlimited'`.
   - Tests de propiedades con ventana ilimitada. Un proyecto que antes dejaba relleno porque el clip que encajaba estaba lejos en la lista ahora lo llena.
   - Rendimiento: menos de 1 s con 200 clips, también con la ventana ilimitada; hay que medirlo y documentarlo.
3. **UI**:
   - sustituir la barra por un campo numérico (entero ≥ 0) más la casilla "Ilimitado";
   - i18n en español.
4. **Sin regresiones**: con ventana ≤ 10 y sin la nueva lógica, los snapshots actuales no cambian. Si la priorización por encaje cambia planes existentes, se justifica y se actualizan los snapshots explicando la diferencia.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

### Resumen

- **Modelo** (`types.ts`): `settings.reorderWindow: z.union([z.number().int().nonnegative(), z.literal('unlimited')])`. Sin tope superior; ampliación aditiva, sigue en v4 (un fichero v4 con número se abre igual). Tests de esquema en `project.test.ts` (0, 11, 250, 100 000 y `'unlimited'` se aceptan; −1, 2,5 y `'infinite'` no).
- **Planificador**:
  - `PlannerSettings.reorderWindow: number | 'unlimited'` y `getReorderWindowSize` (`'unlimited'` → `Infinity`), que usan `planMix` y `validatePlan` (regla 5 con N = ∞). `plannerInput` pasa el valor tal cual.
  - **`LARGE_WINDOW` = 10**. Con ventana ≤ 10 el planificador es **exactamente el de antes**. Con ventana > 10 o ilimitada:
    - **Coste de orden** (`orderDistance`): distancia hacia delante con tope en 10 posiciones; un clip que se ha quedado atrás cuesta 0. La misma medida entra en `PlanScore`.
    - **Poda por encaje** (`pruneCandidates`), solo cuando la ventana no cabe en `SUBSET_BUDGET`. Los candidatos, por prioridad:
      1. los que la ventana obliga a tomar (`isUrgent`);
      2. los más antiguos, hasta `OLDEST_SHARE` = 75 % del cupo;
      3. los que mejor encajan (`getFitKey`): primero los que **llenan el espacio libre** (columna liberada + relleno; solos o junto a los candidatos más antiguos, `getFillingWidths`); luego los que caben en una columna liberada o en un reparto a partes iguales; después por cercanía (log del cociente de anchos). Empates por antigüedad.
      - Se devuelven en orden base (determinista).
      - En la fila inicial el espacio es el fotograma, menos los fijados en 0.
      - En un cambio de cadena es lo que deja el clip de la cadena más el relleno.
  - **Rendimiento**, para todas las ventanas y sin cambiar ningún plan:
    - cota inferior exacta antes de construir cada opción de re-layout: orden + relleno mínimo que dejan los máx. de la fila + re-layout + número de columnas. Todos los términos del coste son ≥ 0, así que si no mejora la mejor opción sin violación se descarta. También se descarta la fila cuyos mín. no caben, como en `distributeWidths`;
    - enumeración de subconjuntos sin reservar memoria (`forEachSubset`);
    - `getOrderCost` sin copias;
    - sin la comprobación de "clip dejado atrás" con ventana infinita.
- **UI** (`MixSettingsDialog`, sección Orden):
  - la barra se sustituye por un campo numérico (entero ≥ 0, sin máximo; borrador local mientras se edita) y la casilla **"Unlimited"/"Ilimitado"** (`Checkbox`);
  - al desmarcarla vuelve al último número;
  - el texto de ayuda cambia con la casilla.
  - i18n: 2 claves nuevas (`scan-i18n`) traducidas en `locales/es`.
  - e2e (escenario 5): 25 → Ilimitado (campo desactivado, texto) → desmarcar (vuelve a 25) → 3. Se guarda 3 para no cambiar los escenarios siguientes.
- **Documentación**: 04-diseno §1.2, §3.2 (regla 5), §3.3 (poda) y nueva §3.9; manual de usuario (sección Orden).
- **Tests nuevos** (`planner/reorderWindow.test.ts`, 9):
  - `getReorderWindowSize`;
  - **clip que encaja lejos** (16:9 y 9:16). 40 verticales rígidos: tres dejan 96 px de relleno. Solo `c35` (704 px) llena la fila junto a dos de ellos, y está más allá de los 18 candidatos de la poda. Con ventana 0/3/10/20 la fila inicial tiene 96 px de relleno; con 40, 1000 o ilimitada es `c0 | c1 | c35` sin relleno y los demás siguen en orden de lista;
  - `validatePlan` con ventana 10 detecta el plan ilimitado;
  - clips iguales con ventana ilimitada salen en orden de lista (el plan cumple la ventana 0) con 1, 3 y 6 columnas;
  - un 16:9 que no encaja entre verticales espera sin desordenar a los demás (con ventana 3 se fuerza en la 4.ª posición);
  - propiedades: 240 proyectos de hasta 60 clips en 16:9, 9:16 y 1:1, con ventana ilimitada o 11–80, 1–6 columnas, fijados, grupos, cadenas, secuencia y límite. Se comprueban también cortados con `truncatePlan` y el determinismo;
  - equivalencia filas/columnas traspuestas;
  - rendimiento con 200 clips, ilimitada, 3 y 6 columnas, en los tres formatos, con y sin fijados/grupos/cadenas/secuencia/límite.

### Sin regresiones (ventana ≤ 10)

- Los snapshots y *inline snapshots* no cambian.
- Además, comparé `planMix` nuevo contra el de `HEAD` con 4000 proyectos aleatorios:
  - 1–40 clips, 16:9, 9:16, 1:1 y 640×360, 1–6 columnas, ventana 0–10;
  - con fijados, grupos, cadenas, secuencia y límite en la mitad de ellos.
  - Resultado: **4000 planes idénticos**.
- Una primera versión aplicaba la poda por encaje a cualquier ventana que no cupiera en el presupuesto (p. ej. 10 con 5–6 columnas). Cambiaba 61 de 3000 planes y, de media, no los mejoraba (+2,7 % de puntuación). Por eso la lógica nueva solo se activa por encima de 10.
- Las cotas y la nueva enumeración son exactas:
  - con la poda de antes, se obtenían los 3000 planes idénticos a `HEAD`;
  - 1500 planes con ventanas grandes e ilimitadas son idénticos byte a byte antes y después de `forEachSubset`.

### Calidad (poda por encaje frente a "los más antiguos", ventana grande)

`PlanScore` en proyectos aleatorios, contando solo los planes que cambian:

| Proyectos | Puntuación total | Puntuación de relleno |
|---|---|---|
| 120 de 100–200 clips, ventana ilimitada | −5,8 % | −8,8 % |
| Los mismos, ventana 11–60 | −3,6 % | −11,7 % |
| 3000 de ≤ 40 clips | ±1 % (ruido) | ±3 % (ruido) |

- Son los valores de la versión final (`OLDEST_SHARE` = 0,75).
- Probé `OLDEST_SHARE` entre 0,5 y 0,85. Todos daban entre −2,5 % y −8 % de puntuación total y entre −8 % y −20 % de relleno, sin un ganador claro; elegí 0,75.
- En proyectos de ≤ 40 clips la poda casi nunca actúa.
- En el caso de 200 clips del banco (16:9, 3 columnas), la ventana ilimitada baja los avisos de relleno de 42 (ventana 3) a 5.

### Rendimiento (medido)

- Máquina del contenedor, 200 clips.
- "Frío" es la primera llamada del proceso, con la validación de desarrollo (`validatePlan`). "Caliente" es la segunda.
- "Con todo" = 8 grupos, 20 fijados, 20 cadenas, secuencia de 3 y límite de 400 s.
- 1:1 planifica los dos ejes.

| Caso (ventana ilimitada) | 3 columnas | 6 columnas |
|---|---|---|
| 16:9 | 87 / 82 ms | 99 / 65 ms |
| 16:9 con todo | 222 / 158 ms | 445 / 320 ms |
| 9:16 | 107 / 78 ms | 87 / 69 ms |
| 9:16 con todo | 136 / 101 ms | 284 / 235 ms |
| 1:1 | 204 / 155 ms | 206 / 152 ms |
| 1:1 con todo | 467 / 314 ms | **586 / 424 ms** (peor caso) |

- Sin las optimizaciones, la ventana ilimitada llegaba a 840 ms en frío en 1:1 sin validación (el presupuesto de 1000 subconjuntos se agota en cada evento). Con ellas, todos los casos quedan por debajo de 0,6 s.
- De paso, las ventanas pequeñas también van más rápido. 16:9 con 6 columnas y ventana 10: 249 → 64 ms en caliente, con el mismo plan.
- Referencia con ventana 3 (frío/caliente): 36/20 ms (16:9, 3 columnas) y 218/166 ms (1:1 con todo, 6 columnas).

### Decisiones

- **Umbral 10**: el máximo de la antigua barra. Así "ventana ≤ 10 = mismo planificador" es literal. Hay un salto de comportamiento entre 10 y 11 (métrica de orden y poda); queda documentado en la constante y en 04-diseno §3.9.
- **Coste de orden con tope**: sin tope, un clip a 50 posiciones costaba 50, más que casi cualquier relleno, y la ventana ilimitada no traía nada de lejos salvo por sustitución directa. Con tope 10 (≈ 3 re-layouts, o un 3 % de relleno durante 5 s) un hueco de verdad justifica traer un clip, y los empates siguen yendo por orden de lista.
- **Clip saltado = 0**: con la distancia absoluta, un clip que se queda atrás sería cada vez más caro y acabaría al final aunque volviera a ser igual de bueno. Con coste 0 vuelve en cuanto empata, y como los subconjuntos se recorren en orden base, gana los empates.
- **Sustitución directa con ventana ilimitada**: ya recorría toda la ventana, así que toma el primer clip de la lista que encaja en el hueco, esté donde esté. Es lo que pide E8 (llenar huecos con clips de cualquier punto). Consecuencia visible: un clip que nunca encaja espera hasta que encaje, en vez de forzarse cuando se acaba su ventana (test "fits nowhere").
- **Campo numérico**: aplica cada número válido al escribir (como el de la separación). Un campo vacío es un borrador local hasta perder el foco. Se limita a `Number.MAX_SAFE_INTEGER` para que el esquema (`int`) siempre lo acepte.

### Validación

- `yarn tsc`, `yarn lint`, `yarn test run` (931 tests), `yarn build` y `yarn test-e2e` (14) en verde.
- En la primera pasada de e2e falló una vez el umbral de audio de la previsualización en vivo (8a, `farFromKeyframe` = 0; ya se había visto inestable en T38b). El proyecto de e2e usa ventana 3, así que su plan no cambia. Pasó en las dos repeticiones siguientes.

### Dudas

- Ninguna bloqueante. Si se prefiere que la ventana 10 con 5–6 columnas también use la poda por encaje, basta con quitar la condición `N <= LARGE_WINDOW` de `pruneCandidates`. Cambia algunos planes con ventana 10 y muchas columnas, y en proyectos pequeños no los mejoraba de media.

## Revisión

- **Resultado**: aceptada. Ventanas ≤ 10: planes idénticos en 4000 proyectos. Ilimitada: 200 clips en 87–586 ms. `tsc`, `lint`, tests (931), `build` y `test-e2e` en verde.
- **Seguimiento**: el e2e 8a (nivel de audio de la previsualización en vivo) falla de forma intermitente. Se estabiliza en T40.
