# T15 · Timeline del montaje (vista del plan)

- **Hito**: M5 · **Modelo**: Sonnet · **Depende de**: T10, T13 · **Estado**: pendiente

## Objetivo

Visualizar el `MixPlan` para que el usuario entienda qué va a salir antes de renderizar.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4.6
- [04-diseno](../04-diseno.md) §3.1, §6.1, §6.6
- [02-as-built](../02-as-built.md) §7 (`Timeline.tsx`, como referencia de estilo y zoom)

## Alcance

1. **`videomix/components/MixPlanView.tsx`**:
   - Vista alternativa al timeline de la fuente activa (pestañas "Source" / "Mix").
   - Eje de tiempo del vídeo final y **carriles por columna**: bloques con el color y el nombre del clip, solapes de transición marcados, zonas de re-layout y de relleno sombreadas.
   - Encima, una **mini vista del fotograma** en el instante bajo el cursor: rectángulos con el color de cada clip y su ancho real (sin vídeo).
   - Clic en un bloque: selecciona el clip, lo que activa su fuente (reutiliza T07).
   - Los avisos del plan se muestran como iconos sobre los bloques.
2. El plan se recalcula con debounce cuando cambian los clips o los ajustes (el planificador es rápido).

## Criterios de aceptación

- Se ve el plan de un proyecto de ejemplo y coincide con el render de T13.
- `yarn tsc && yarn lint && yarn test run` en verde.
- Instrucciones de prueba manual en las notas.

## Notas de ejecución

## Revisión
