# T38 · v3: planificador — cadenas, secuencia y duración máxima (E2, E4, E5)

- **Hito**: M9 · **Modelo**: Opus · **Depende de**: T36 · **Estado**: hecha

## Alcance

1. **Cadenas (E2)**:
   - Cada cadena de `getClipChains` se planifica como **una unidad que ocupa un mismo hueco**: sus clips van seguidos en la misma columna o fila, sin nada entre medias y sin cortar clips.
   - Entre clips de una cadena: `transitionIn = 0` (corte directo, concat en el render) si `links.transition === 'cut'`; si no, la transición global.
   - Si la proporción del siguiente clip no encaja en el ancho del hueco, hay un re-layout animado que empieza en el cambio.
   - La cadena ocupa la posición de lista de su primer clip. Respeta fijaciones y grupos según la regla de T36.
2. **Secuencia siempre visible (E5)**:
   - Un **hueco dedicado** presente en todo momento mientras quedan clips de la secuencia. Sus clips van uno tras otro en ese hueco (transición según `links.transition`, o global; documéntalo).
   - La **posición la decide el algoritmo** y puede cambiar en re-layouts. El resto de huecos se reparte con normalidad (el máximo de columnas incluye el de la secuencia).
   - Duración del vídeo = lo más largo de las dos cosas:
     - si la secuencia termina antes, su hueco se libera;
     - si termina después, sigue sola o con los huecos que queden (relleno o expansión según las reglas actuales del final).
3. **Duración máxima (E4)**: con `maxDuration` definida, la puntuación favorece **más columnas** mientras el contenido previsto supere el límite (documenta los pesos).
   - Nueva función pura `truncatePlan(plan, maxDuration)`: corta *placements* y *layouts* en el límite, marca un aviso `truncated` (segundos y clips perdidos) y deja `plan.duration = maxDuration`, para que el *fade* global quede en el corte.
   - Si hay efectos de sonido u overlays después del límite, se recortan.
4. **Invariantes** nuevas en `validatePlan`:
   - las cadenas son contiguas en el mismo hueco;
   - la secuencia siempre está visible mientras le quedan clips;
   - un plan truncado no pasa del límite.

   Tests de mutación y de propiedades en los 3 aspectos. Rendimiento < 1 s con 200 clips.
5. Actualiza 04-diseno §3.

## Criterios de aceptación

- Sin cadenas, sin secuencia y sin límite, el plan es idéntico al actual: los snapshots no cambian.
- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

### Resumen de cambios

- `planner/types.ts`:
  - `PlanMixInput` gana `chains?: string[][]` y `sequence?: string[]`;
  - `PlannerSettings` gana `linkTransition?: 'cut' | 'global'` (por defecto `'cut'`) y `maxDuration?`;
  - `PlanWarning` gana `{ type: 'truncated', time, seconds, clipIds, cutClipIds }`.
- `planner/units.ts`:
  - `getPlanLinks(clips, { chains, sequence })` limpia las cadenas y la secuencia (ver "Decisiones");
  - `getPlanUnits(clips, settings, links?)` saca de la ventana los clips de la secuencia y convierte cada cadena en una unidad suelta con `continuation`.
  - Sin enlaces el resultado es idéntico al de antes.
- `planner/planMix.ts`:
  - cadenas (`Clip.next`/`tail`, `resolveChainEvent`);
  - secuencia (cadena fijada en 0 en la fila inicial);
  - presión de la duración máxima (`LIMIT_*`).
  - Ajustes para que una columna a mitad de cadena nunca se quite ni se fusione (detalle en 04-diseno §3.7).
- `planner/truncatePlan.ts` (nuevo): `truncatePlan(plan, maxDuration)`, puro.
- `planner/validatePlan.ts`: invariantes 14–16 de 04-diseno §3.2 (cadenas, secuencia, plan truncado). Las reglas existentes usan las duraciones sin cortar y la regla "columna vacía con clips pendientes" solo mira los inicios de unidades.
- `planner/planWarnings.ts`: no avisa de `transition-shortened` en los cortes directos de una cadena. `formatPlan` escribe el aviso `truncated`.
- `planner/plannerInput.ts`:
  - pasa `chains` (`getClipChains` sobre los clips válidos, solo las de ≥ 2) y `sequence` (ids válidos), solo si hay alguno;
  - pasa `linkTransition` (`settings.links.transition`) y `maxDuration`.
  - `renderOutput.planRender` no cambia: no trunca, así T37 muestra la duración completa y "se corta en m:ss". El corte lo aplica T39 con `truncatePlan`.
- `mixPlanLayout.ts#getPlacementWarnings`: una línea para el nuevo tipo de aviso (un `truncated` afecta a los clips de `cutClipIds`), necesaria para que compile la unión de avisos. No es un fichero de T37.
- Tests nuevos en `planner/linksLimit.test.ts`:
  - unidades y limpieza;
  - cadenas, secuencia, límite y `truncatePlan`, incluidos overlays y sonidos recortados;
  - mutaciones de `validatePlan`;
  - propiedades en 16:9, 9:16 y 1:1 con cadenas, secuencia, fijados, grupos y límites aleatorios (450 proyectos, también truncados; probado aparte con 6000);
  - equivalencia filas/columnas traspuestas;
  - rendimiento con 200 clips.
- También hay un test nuevo de `getPlannerInput`.
- Los snapshots existentes no cambian.

### Antes / después (1920×1080, 3 columnas, ventana 3, D = 0,5 s)

Clips: `a1` 16:9 flexible hasta 4:5 (10 s), `b` 9:16 que puede ensancharse a 1:1 (12 s), `a2` 9:16 rígido (8 s), `c` 9:16 flexible (14 s), `d` 16:9 flexible (9 s), `e` 9:16 flexible (9 s).

**Cadena `a1 → a2`** (corte directo). Antes, `a2` acababa en otra columna. Después va justo detrás de `a1`, en la misma columna, y en el cambio hay un re-layout animado (10,00 + 0,50) que estrecha la columna y abre otra para `c`:

```
antes                                              después (chains: [['a1','a2']])
layout 0.00: c0=1312 | c1=608                      layout 0.00: c0=1312 | c1=608
layout 18.00+0.50: c0=656 | c2=656 | c1=608        layout 10.00+0.50: c0=608 | c2=656 | c1=656
c0: a1 0-10 > d 9.5-18.5 > c 18-32                 layout 17.50+0.50: c2=960 | c1=960
c1: b 0-12 > a2 11.5-19.5 ~fade                    c0: a1 0-10 > a2 10-18
c2: e 18-27 ~fade                    (32 s)        c1: b 0-12 > e 11.5-20.5 > d 20-29
                                                   c2: c 10-24 ~fade                    (29 s)
```

Con `linkTransition: 'global'`, `a2` empieza en 9,5 con `transitionIn` = 0,5.

**Secuencia `a1, a2`**. Tiene un hueco propio desde 0 (a la derecha en la fila inicial). Se mueve con los re-layouts y, cuando se acaba (18 s), su columna se quita y las demás se reparten la fila:

```
layout 0.00: c0=608 | c1=1312
layout 10.00+0.50: c0=656 | c1=608 | c2=656
layout 17.50+0.50: c0=960 | c2=960
c0: b 0-12 > e 11.5-20.5 > d 20-29
c1: a1 0-10 > a2 10-18            ← secuencia
c2: c 10-24 ~fade
```

Con una secuencia más larga que el resto (`s0`, `s1` de 40 s), el vídeo dura 80 s: las demás columnas pasan a relleno al acabar y la secuencia sigue sola, sin re-layouts después de 40 s.

**Duración máxima 30 s** con 8 clips 16:9 flexibles hasta 4:5 (8–12 s). Sin límite van a pantalla completa y el corte pierde la mitad de los clips. Con límite, la presión favorece 2 columnas a 960 px y el corte solo recorta el final de dos clips:

```
sin límite + truncatePlan(30)                        maxDuration: 30 + truncatePlan(30)
layout 0.00: c0=1920                                 layout 0.00: c0=960 | c1=960
c0: h0 0-8 > h1 7.5-16.5 > h2 16-26 > h3 25.5-30     c0: h0 0-8 > h2 7.5-17.5 > h4 17-29 > h7 28.5-30
warning: truncated @30 -43.5s                        c1: h1 0-9 > h3 8.5-19.5 > h5 19-27 > h6 26.5-30
  lost (h4, h5, h6, h7) cut (h3)                     warning: truncated @30 -8.5s lost () cut (h6, h7)
```

### Decisiones

- **Posición de una cadena en la lista**: la de su clip **más temprano en el orden base** (lista o barajado), igual que los grupos (§3.6). Suele coincidir con "su primer clip". Si el usuario coloca en la lista un clip posterior de la cadena antes que el primero, la cadena toma esa posición antes, que es la más conservadora con la ventana. La cadena siempre suena en orden de fuente (el orden de `getClipChains`).
- **La secuencia manda sobre fijaciones y grupos**: T36 lo dejaba como aviso (`clip-in-sequence-and-group`) y proponía que prevaleciera la secuencia. En el planificador, un clip de la secuencia pierde `pinTime`/`groupId`: no hay avisos `pin-shifted`/`group-split` por él y su grupo puede quedar en un solo clip, que se ignora.
- **Transición dentro de la secuencia**: la misma que en las cadenas (`settings.links.transition`: corte por defecto, o la global). Es un único ajuste para "clips que van seguidos en un hueco".
- **Posición de la secuencia**: en la fila inicial va a la derecha de los clips elegidos (como los fijados en 0). El coste no depende del orden de la fila, así que no hay nada que optimizar. Luego se mueve con los re-layouts (las columnas nuevas entran junto a la que se libera, ADR-001).
- **Re-layout en un cambio de cadena**:
  - empieza en el cambio y dura la transición de la cadena (`D` si es un corte);
  - termina antes de que acabe cualquier otro clip de la fila (como los fijados), así nunca coincide con otra animación;
  - puede abrir columnas nuevas para clips de la ventana, pero no quita columnas (no se corta ningún clip).
  - Si no hay margen (otra animación en curso, un clip que acaba ya, o una columna ya vacía al final del vídeo), el clip se queda en su sitio con pillarbox/letterbox y aviso.
- **Presión de la duración máxima**:
  - se mide con una densidad fija de 2 columnas, no con las de la fila actual; si no, la presión se apagaría al tener 3 columnas y volvería a quitarlas en el siguiente evento (probado: el plan oscilaba);
  - pesos en 04-diseno §3.4: `LIMIT_COLUMN_WEIGHT` = 4 por columna por debajo del máximo, `LIMIT_MAX_CROP_LOSS` = 0,55 y sin prioridad absoluta de la sustitución directa si cabe otra columna.
  - Con los pesos normales la presión no cambiaba nada con clips 16:9: el recorte del 50 % costaba más que la columna ganada.
  - La puntuación global de 1:1 no depende del límite.
- **`truncatePlan` y overlays**: `resolveOverlayTimes` ya recorta a `plan.duration`. Pero con el plan cortado, un overlay anclado a un clip perdido caería al "ancla perdida" (inicio absoluto en `max(0, offset)`). Por eso se documenta resolverlos con `{ duration: cortado.duration, placements: completo.placements }` (test). Queda para T39 al integrarlo en el render y la previsualización.
- **Una animación en curso en el límite** se mantiene. Recortarla cambiaría su velocidad y el vídeo acaba igualmente durante ella. Por eso la invariante del plan truncado exige que los keyframes *empiecen* antes del límite.
- **Qué comprueba `validatePlan` en un plan truncado**: reconoce el plan por su aviso `truncated` y aplica las reglas de siempre con las duraciones sin cortar. Relaja dos:
  - "no hay re-layouts tras el último inicio" (los clips perdidos empezaban después);
  - un aviso `group-split` de un grupo que ha perdido clips.

### Para T39

- Aplicar `truncatePlan(plan, settings.maxDuration)` en el render, la previsualización y la vista previa en vivo, y resolver overlays y sonidos con los *placements* completos (ver arriba). `getRenderWarnings` puede mostrar el aviso `truncated` (segundos y clips perdidos).
- Los cortes directos de cadena llegan como `transitionIn = 0` en la misma columna. `getPlacementFades` (audio) los trata como un corte con *declick*. Si se quiere un empalme sin caída de volumen entre clips contiguos de la misma fuente, es cosa del render.

### Validación

- `yarn tsc`, `yarn test run` (884 tests) y `yarn build` en verde.
- `yarn lint`: sin errores en los ficheros de esta tarea. Los 2 errores restantes (`BottomBar.tsx`: `NewClipFromCursorButton`, `newClipFromCursor` sin usar) son del trabajo en curso de T37.
- Comparación con el planificador de `HEAD` (copiado aparte): 450 proyectos aleatorios con fijados y grupos dan planes idénticos y el mismo tiempo de cálculo.
- Con la máquina muy cargada (carga ≈ 27 en 4 núcleos, por los tests con ffmpeg del agente en paralelo), las pruebas de propiedades de `pinsGroups.test.ts` y de este fichero pasaron del límite de 5 s. Por eso la nueva tiene 30 s. Sin esa carga pasan en 2–5 s.

## Revisión

- **Resultado**: aceptada. Sin las funciones nuevas, los planes son idénticos a los de antes. `tsc`, `lint`, tests (884) y `build` en verde.
- **Pasa a T39**:
  - aplicar `truncatePlan` y resolver los overlays con el plan completo;
  - en las uniones de cadenas con corte directo, el audio debe unirse sin bajada: sin microfade o con un crossfade mínimo.
