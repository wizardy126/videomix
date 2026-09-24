# T38c · v3: ventana de reorden ilimitada y ampliable (E8)

- **Hito**: M9 · **Modelo**: Opus · **Depende de**: T38b · **Estado**: pendiente

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

## Revisión
