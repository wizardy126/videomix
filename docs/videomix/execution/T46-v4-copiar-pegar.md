# T46 · v4: copiar y pegar el encuadre (A5)

- **Hito**: M11 · **Modelo**: Sonnet · **Depende de**: T44 · **Estado**: pendiente

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- Lógica de pegado de T44 y sus notas. Selección múltiple de la lista de clips (A4, `useMixClipPins.ts`), menú del clip (`getClipMenu`), atajos (`src/main/configStore.ts`, `KeyboardShortcuts.tsx`).

## Alcance

1. "Copiar encuadre" y "Pegar encuadre" en el menú del clip y con atajos (propuesta: Ctrl+Mayús+C / Ctrl+Mayús+V; comprobar que no chocan con atajos existentes).
2. Pegar se aplica al clip activo o a **todos los seleccionados**, en **un solo paso de historial**. Portapapeles interno de la app (no el del sistema).
3. Aviso (toast) cuando alguna fuente de destino tiene otra proporción y el encuadre se ha ajustado.
4. i18n (en + es), manual.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde; e2e: copiar de un clip y pegar en dos seleccionados de otra fuente.

## Notas de ejecución

## Revisión
