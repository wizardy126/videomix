# T52 · v5: ventana de reorden ilimitada y criterio configurable (G1, G2)

- **Hito**: M12 · **Modelo**: Opus · **Depende de**: — · **Estado**: en curso

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

## Revisión
