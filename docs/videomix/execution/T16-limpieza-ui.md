# T16 · Limpieza de la UI heredada de LosslessCut

- **Hito**: M5 · **Modelo**: Sonnet · **Depende de**: T13 · **Estado**: pendiente

## Objetivo

Ocultar o retirar la UI de LosslessCut que no tiene sentido en VideoMix, **sin romper** la infraestructura reutilizada.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §3 (P1, P2)
- [02-as-built](../02-as-built.md) §2 (menú), §4 (layout)

## Alcance

1. **Inventario** (en las notas de ejecución) de cada elemento de menú, botón de TopMenu y BottomBar y diálogo, con la decisión para cada uno: **mantener**, **ocultar** o **eliminar**.
   - Criterio: se mantiene lo que sirve para marcar tiempos y reproducir (seek, zoom, keyframes, forma de onda, miniaturas, captura de frame, ajustes generales, atajos).
   - Se oculta o elimina lo que sirve para exportar segmentos lossless, concat, EDL import/export, detección de escenas o silencio, tracks/streams, etiquetas o expresiones de segmentos, batch, etc.
   - **Presenta el inventario antes de borrar** si hay casos dudosos: el orquestador lo revisa.
2. Se prefiere **ocultar desde el layout o el menú** a borrar código profundo (menos riesgo). El código muerto evidente y aislado (componentes que ya nadie monta) se puede eliminar.
3. Revisa los atajos de teclado por defecto: quita los que apunten a acciones retiradas.

## Criterios de aceptación

- No quedan botones ni menús que lleven a flujos de LosslessCut incompatibles con el proyecto VideoMix.
- `yarn tsc && yarn lint && yarn test run` en verde. Los tests de las partes eliminadas se eliminan con ellas.

## Notas de ejecución

## Revisión
