# T30 · v2: fijar clips a un momento y grupos (A4)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T29 · **Estado**: hecha

## Alcance

1. **Planificador**:
   - **`pinTime`**: el clip empieza en ese instante del vídeo final.
     - Hay que liberar una columna en ese momento: si hace falta, un re-layout o relleno.
     - Los clips fijados no cuentan para la ventana de orden.
     - Si dos clips fijados no caben a la vez (más que `maxColumns`), se desplaza el posterior y se avisa.
   - **Grupos**: los clips de un grupo empiezan juntos, con un re-layout que abre sitio para todos (limitado por `maxColumns`; si no caben, se avisa y se divide). El grupo ocupa la posición del primero de sus clips en la lista.
   - Invariantes nuevas en `validatePlan` y tests, incluidos los de propiedades.
2. **UI**:
   - en la lista de clips y en la vista Mix: "Fijar aquí" (en el cursor de Mix), "Quitar fijación", "Agrupar seleccionados" y "Desagrupar";
   - indicadores visuales: chincheta y color de grupo;
   - arrastrar un bloque de clip en la vista Mix fija su `pinTime`.
3. **i18n**: español.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.

## Notas de ejecución

### Resumen de cambios

- **Planificador** (`planner/`):
  - `units.ts` (nuevo, compartido por `planMix` y `validatePlan`):
    - `getPlanUnits`: las unidades en orden base (sueltos y grupos) y las fijadas, ordenadas por momento;
    - `getEffectiveGroups`: grupos de ≥ 2 clips;
    - `getEffectivePins`: el grupo hereda el menor `pinTime` de sus clips.
  - `types.ts`: `PlannerClip.pinTime?` y `groupId?`; avisos `pin-shifted { clipId, pinTime, time }` y `group-split { groupId, clipIds }`. `plannerInput.ts` pasa los dos campos desde `MixClip`.
  - `planMix.ts`:
    - la simulación trabaja con unidades;
    - el momento de un clip fijado es un evento (`startPin`);
    - reserva de sitio antes de cada momento fijado (`Option.violation`, comparado antes que el coste);
    - unidades que no pueden esperar (`getForcedUnit` / `getForcedOptions`: fijado atrasado, resto de un grupo partido, grupo al final de su ventana);
    - quitar columnas para hacer sitio (`getDrainOption`, también varias que terminan a la vez);
    - filas apretadas (`distribute(…, squeeze)`);
    - último recurso: partir la unidad;
    - `placements` se ordena por inicio al final;
    - la puntuación de orden de T29 cuenta sueltos y grupos por separado.
  - `planWarnings.ts`: `pin-shifted` y `group-split`, calculados sobre el plan terminado (`PIN_TOLERANCE`).
  - `validatePlan.ts`: invariantes 12 y 13 de 04-diseno §3.2 y la regla 5 con unidades (ver abajo).
  - `formatPlan.ts`: formato de los avisos nuevos.
- **UI**:
  - `clipGroups.ts` (puro, con tests): colores de grupo en orden de lista, rango de Mayús-clic, y las acciones de fijar y quitar fijación (con grupo). También el momento fijado efectivo de un clip.
  - `hooks/useMixClipPins.ts` (nuevo):
    - selección múltiple encima del clip seleccionado (Ctrl/Cmd-clic añade o quita, Mayús-clic selecciona el rango desde el seleccionado; un clic normal vuelve a la selección simple);
    - entradas del menú de clip: "Fijar aquí (m:ss)" en el cursor de Mix, "Quitar fijación", "Agrupar seleccionados" y "Desagrupar". Desagrupar deshace el grupo entero; quitar la fijación de un clip agrupado la quita a todo el grupo;
    - `openClipMenu`: menú nativo construido al pedirlo, para no reconstruir un menú por bloque cada vez que se mueve el cursor.
    - Cada acción es un paso de deshacer (`useMixClips.dispatchStep`, ahora expuesto).
  - `ClipList.tsx`: clic con modificadores, entradas del menú, chincheta (con el momento en el tooltip) y borde izquierdo con el color del grupo.
  - `MixPlanView.tsx`:
    - en los bloques, chincheta, franja inferior con el color del grupo y menú contextual;
    - clic con modificadores en los carriles;
    - **arrastrar un bloque** lo mueve con el puntero y al soltar lo fija en su nuevo inicio (un paso de deshacer); el clic que termina el arrastre no selecciona;
    - tooltips de los avisos nuevos. `selectedClipId` deja de ser prop: la selección llega en `clipPins`.
  - `App.tsx`: crea `useMixClipPins` y lo pasa a los dos componentes.
  - Avisos antes de renderizar (`getRenderWarnings` / `getRenderWarningText`): clip fijado desplazado (más tarde por falta de sitio, o antes porque se acaban los demás clips) y grupo partido.
  - Texto del aviso de proyecto `pin-time-after-end`: ahora "empezará antes" (el planificador no deja huecos).
- **i18n**: `scan-i18n` y traducciones al español ("Fijar aquí", "Quitar fijación", "Agrupar seleccionados", "Desagrupar"…).
- **Docs**: `04-diseno` §3.1 (avisos, orden de `placements`), §3.2 (invariantes 12 y 13), §3.6 (nuevo) y §9.

### Algoritmo (resumen; detalle en 04-diseno §3.6)

- **Unidades**:
  - un clip suelto, un grupo (en el lugar de su primer clip; si tiene más clips que columnas, trozos consecutivos) o una unidad fijada (fuera del orden);
  - los clips sueltos conservan la ventana de siempre entre ellos;
  - un grupo cuenta como una posición: no puede adelantarse más de N y, al final de su ventana, pasa a ser obligatorio.
- **Clip fijado en `P`**:
  - en `P` entra como columna nueva a la derecha (animación más corta que lo que queda de cualquier clip de la fila);
  - para que haya sitio, antes de `P` cada evento prefiere las opciones que no dejan la fila llena en `P` (reserva), comparando también que los clips quepan a su mín.; en la práctica, quita una columna o le da un clip que termina antes;
  - si aun así no hay sitio, el clip entra en el primer evento siguiente (exacto si esa columna termina dentro de una transición tras `P`) y se avisa.
- **Grupo**: sus clips empiezan en el mismo instante, en la columna liberada y en columnas nuevas a su derecha; si no caben, se van quitando columnas hasta que caben.
- Nunca se corta un clip ni queda un hueco en el vídeo.
- **Sin clips fijados ni grupos, el plan es idéntico al de antes**: ningún snapshot ni test anterior cambia.

### Planes compactos: antes y después

Siete verticales flexibles (9:16 a 1:1; 10, 12, 14, 10, 11, 9 y 10 s), 1920×1080, 3 columnas, ventana 3, transición 0,5 s.

Sin ajustes:

```
plan 1920x1080, 29.00s
layout 0.00: c0=640 | c1=640 | c2=640
c0: v0 0.00-10.00 > v3 9.50-19.50 > v6 19.00-29.00
c1: v1 0.00-12.00 > v4 11.50-22.50 ~fade 0.50
c2: v2 0.00-14.00 > v5 13.50-22.50 ~fade 0.50
```

`v6` fijado en 15 s. Al terminar `v2` se quita su columna (reserva) y `v6` entra en 15,00 como columna nueva:

```
plan 1920x1080, 28.00s
layout 0.00: c0=640 | c1=640 | c2=640
layout 13.50+0.50: c0=960 | c1=960
layout 15.00+0.50: c0=640 | c1=640 | c3=640
c0: v0 0.00-10.00 > v3 9.50-19.50 > v5 19.00-28.00
c1: v1 0.00-12.00 > v4 11.50-22.50 ~fade 0.50
c2: v2 0.00-14.00
c3: v6 15.00-25.00 ~fade 0.50
```

`v4` + `v5` agrupados. Esperan a tener dos columnas y empiezan juntos en 19,00:

```
plan 1920x1080, 30.00s
layout 0.00: c0=640 | c1=640 | c2=640
layout 13.50+0.50: c0=960 | c1=960
layout 19.00+0.50: c0=640 | c3=640 | c1=640
c0: v0 0.00-10.00 > v3 9.50-19.50 > v4 19.00-30.00
c1: v1 0.00-12.00 > v6 11.50-21.50 ~fade 0.50
c2: v2 0.00-14.00
c3: v5 19.00-28.00 ~fade 0.50
```

`v5` y `v6` fijados los dos en 15 s con 2 columnas. `v5` entra en 15,00; `v6` se desplaza al hueco de `v5` (23,50) y se avisa:

```
plan 1920x1080, 44.00s
layout 0.00: c0=960 | c1=960
layout 9.50+0.50: fill=420 | c1=1080 | fill=420
layout 15.00+0.50: c1=960 | c2=960
c0: v0 0.00-10.00
c1: v1 0.00-12.00 > v2 11.50-25.50 > v3 25.00-35.00 ~fade 0.50
c2: v5 15.00-24.00 > v6 23.50-33.50 > v4 33.00-44.00
warning: fill 840px @9.50
warning: pin-shifted v6 15.00 -> 23.50
```

Una sola columna de 16:9 de 10 s:
- `h2` fijado en 12 s entra en el siguiente corte (19,00, aviso);
- fijado en 9,7 s entra exacto, con un xfade de 0,3 s sobre el final de `h0`.

### Tests

- `pinsGroups.test.ts` (nuevo):
  - unidades (posición del grupo, trozos, pin heredado, pins no válidos, orden aleatorio);
  - clips fijados: exacto con reserva, en 0, fuera de la ventana, conflicto (se desplaza el posterior), dos a la vez con sitio, después del final (entra antes), una columna, solo clips fijados;
  - grupos: juntos con re-layout, posición del primer clip con ventana 0, grupo mayor que `maxColumns` (se parte en orden), grupo fijado, rígidos que no caben (apretados).
  - Propiedades:
    - 450 proyectos aleatorios con grupos y clips fijados en 16:9, 9:16 y 1:1 cumplen todas las invariantes y son deterministas;
    - en esa muestra, el 84 % de los clips fijados sueltos con ≥ 2 columnas empieza exacto, incluidos conflictos a propósito (varios en 5 s), momentos después del final y ventanas que obligan; ningún grupo que cabe se parte (umbrales en el test: > 80 % y < 2 %);
    - en 9:16, el plan en filas es el traspuesto también con grupos y clips fijados;
    - 200 clips con 20 fijados y 8 grupos, en < 1 s (≈ 60 ms con 3 columnas y ≈ 240 ms con 6 y ventana 10).
- `validatePlan.test.ts` (mutaciones): clip fijado fuera de su momento sin aviso, aviso con otro momento o sobrante, aviso de un clip no fijado, grupo que no empieza junto sin aviso, aviso de grupo falso o inexistente, clips fijados fuera de la ventana y grupo que se adelanta.
- `plannerInput.test.ts`, `clipGroups.test.ts`, `mixPlanLayout.test.ts` (aviso de grupo en sus bloques) y `renderOutput.test.ts` (avisos antes de renderizar).
- Validación: `yarn tsc`, `yarn lint`, `yarn test run` (742 tests) y `yarn build` en verde.
- La UI no se ha probado en la app real (el contenedor no tiene pantalla); los tests E2E son de T33.

### Decisiones

- **Clip fijado dentro de un grupo**: el grupo hereda el **menor** `pinTime` de sus clips y empieza entero entonces. El aviso de proyecto `group-pin-conflict` (T24) sigue avisando de pins distintos. En la UI, "Fijar aquí" en un clip agrupado mueve el pin a ese clip (quita los de los demás) y "Quitar fijación" lo quita a todo el grupo.
- **Dónde entra un clip fijado**: como columna nueva a la derecha de la fila, que siempre cumple ADR-001. No se prueba a insertarla en otras posiciones.
- **Si no puede empezar en su momento**: nunca se corta un clip, así que se retrasa al primer evento en que hay sitio. Si esa columna termina dentro de una transición después de `P`, el xfade empieza en `P` y es exacto. Los fijados conservan su orden entre ellos.
- **Clip fijado después de que se acaben los demás**: entra antes, sin dejar hueco, y se avisa. El aviso de T24 decía que habría un hueco; se ha cambiado el texto.
- **Grupos**: en la ventana, los sueltos se ordenan entre sí y un grupo cuenta como una posición (la de su primer clip). Puede retrasarse (espera sitio), pero no adelantarse más de N. Así la ventana de los sueltos siempre se puede cumplir y un grupo nunca bloquea el plan. Un grupo cede el sitio a un clip fijado pendiente.
- **Clips que no caben ni a su mín.** (grupo o clips fijados rígidos): se estrecha toda la fila en la misma proporción (letterbox con aviso) en vez de retrasarlos. Se prefiere el momento exacto al aspecto. Solo ocurre en planes con clips fijados o grupos.
- **Arrastrar un bloque**: durante el arrastre solo se mueve el bloque; el plan se recalcula al soltar (un paso de deshacer). Recalcular en cada movimiento sería lento con muchos clips.

### Dudas

- Con **una sola columna**, un clip fijado entra en el primer corte **después** de su momento. Otra opción sería el corte más cercano, antes o después. ¿Cuál prefiere el usuario?
- La **reserva** puede quitar una columna bastante antes del momento fijado, hasta la duración de un clip, y dejar la fila con menos columnas mientras tanto. Es inevitable sin cortar clips, pero se nota con clips largos (p. ej. relleno durante unos segundos). Se podría preferir desplazar el clip fijado a partir de cierto umbral.
- El aviso de proyecto `pin-time-after-end` (T24) sigue comparando con la suma de las duraciones. Con varias columnas el vídeo es más corto, así que un clip fijado puede entrar antes sin ese aviso (el planificador avisa con `pin-shifted`). ¿Basta con el aviso del plan?

## Revisión

- **Resultado**: aceptada. `tsc`, `lint`, tests (742) y `build` en verde. Sin pins ni grupos, el plan es idéntico al de antes.
- **Decisiones del orquestador sobre las dudas** (se informa al usuario para que pueda cambiarlas):
  1. Un pin que no puede ser exacto toma el primer corte **posterior**: "fijar" significa "no antes de".
  2. Se acepta quitar una columna antes del pin para hacerle sitio.
  3. Basta con el aviso `pin-shifted` del plan.
