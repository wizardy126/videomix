# T59 · v6: manual, i18n y cierre

- **Hito**: M13 · **Modelo**: Sonnet · **Depende de**: T56–T58 · **Estado**: pendiente

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§9 (overlays) y §14 (v6)**, [03-convenciones](../03-convenciones.md), [04-diseno](../04-diseno.md) (overlays, §1.2 modelo).

## Alcance

1. **Auditoría real del manual** contra §14 y la UI (textos de `locales/es`, atajos de `configStore.ts`): bloques, repetir, estirar, ocultar/bloquear, variables, exportar/importar, biblioteca, adaptar proporción; y una **guía del formato `.vmxblock`** para editarlo a mano (ejemplo comentado, referencia al JSON Schema).
2. Ejemplos: una o dos plantillas `.vmxblock` de muestra en `docs/videomix/ejemplos/` (p. ej. "rótulo de ejercicio" con variables y "descanso" con contador + barra).
3. `07-propuestas.md` (H1–H8 → ✅), revisión del español.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

## Revisión
