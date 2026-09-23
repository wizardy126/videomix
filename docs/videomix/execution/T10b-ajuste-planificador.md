# T10b · Ajuste del planificador según las decisiones del usuario

- **Hito**: M3 · **Modelo**: Opus · **Depende de**: T10, T09 · **Estado**: pendiente

## Objetivo

Ajustar la puntuación y las reglas del planificador (T10) a las decisiones del usuario tomadas tras revisar su comportamiento, y a las invariantes de render de ADR-001.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.3: las cuatro decisiones nuevas "decidido tras T10"
- [T10-planificador](T10-planificador.md): notas de ejecución y dudas abiertas
- [ADR-001](../decisiones/ADR-001-render.md), sección "Consecuencias": invariantes para el planificador
- [04-diseno](../04-diseno.md) §3

## Alcance

1. **Relleno antes que sustitución directa**:
   - Si la fila tiene relleno estructural y existe una opción de re-layout (dentro de la ventana) que lo elimina o lo reduce claramente, gana a la sustitución directa.
   - Si la fila no tiene relleno, la sustitución directa sigue teniendo prioridad (evita animaciones innecesarias).
2. **Criterio equilibrado de columnas**:
   - Se prefieren 2–3 columnas, recortando los horizontales flexibles hacia su mín.
   - Se acepta un clip a pantalla completa cuando meter más columnas obligaría a perder mucho del máx. (p. ej. más de ~40 % de su área; umbral como constante documentada).
   - Ajusta `COLUMN_COUNT_WEIGHT` / `PREF_WEIGHT` o la forma de la penalización. Documenta el razonamiento con ejemplos en las notas y en los snapshots.
3. **Columna nueva**: crece desde ancho 0 y su clip entra sin `xfade`; es el comportamiento actual, así que solo hay que verificarlo.
4. **Final del vídeo**:
   - El plan debe expresar que un clip que termina sin sucesor hace un fundido al relleno con la transición global (p. ej. `transitionOut` en `ColumnPlacement`, o un marcador equivalente).
   - Documenta el campo para T11.
5. **Invariantes de ADR-001**:
   - el orden izquierda→derecha de las columnas es estable durante una animación;
   - las columnas que aparecen o desaparecen lo hacen con ancho 0 junto a su vecina derecha. T10 las crea a la derecha de la columna liberada; verifica que sea compatible con ADR-001 o ajusta una de las dos cosas de forma coherente y documéntalo en ambos sitios.

   Añade las dos a `validatePlan` con tests de mutación.
6. Actualiza 04-diseno §3 y los snapshots.

## Criterios de aceptación

- Tests nuevos para cada decisión, con casos que antes daban el comportamiento anterior.
- Sigue cumpliéndose todo `validatePlan` con 200 proyectos aleatorios. El rendimiento sigue por debajo de 1 s con 200 clips.
- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

## Revisión
