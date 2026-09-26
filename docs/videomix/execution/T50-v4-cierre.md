# T50 · v4: i18n, manual, e2e y cierre

- **Hito**: M11 · **Modelo**: Sonnet · **Depende de**: T44–T49 · **Estado**: en curso

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).

## Alcance

1. `scan-i18n` y revisión del español de todo lo nuevo.
2. **Manual**: indicador de encaje, imán y "Ajustar a"; copiar/pegar encuadre; bandas negras (botón y automático, ajuste); keyframes (Animar, auto-key, interpolaciones, atajos). Tabla de atajos.
3. Actualizar el estado en [07-propuestas](../07-propuestas.md) (A5, A7, A9, F1, F2 → ✅).
4. Revisar que los e2e de T45–T49 cubren lo acordado; proyecto de ejemplo con un clip animado renderizado y revisado (script en `script/videomix/`).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

## Revisión
