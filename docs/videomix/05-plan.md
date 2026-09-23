# 05 · Plan: hitos y tareas

El estado vivo de cada tarea está en su task-doc (`execution/`). Esta tabla es el mapa general.

## Leyenda

- **Modelo**: agente recomendado.
  - **Opus**: diseño o algoritmia compleja, o integración delicada.
  - **Sonnet**: tareas bien acotadas.
- **Estados**: `pendiente` · `en curso` · `en revisión` · `hecha` · `bloqueada`.

## Hitos

| Hito | Objetivo | Tareas |
|---|---|---|
| **M0 · Fundaciones** | App renombrada, CI ajustado, entorno de desarrollo y medios de prueba | T01, T02 |
| **M1 · Modelo y proyecto** | Tipos, esquema `.vmx`, geometría, store del proyecto con undo/redo y persistencia | T03, T04 |
| **M2 · Edición** | Multi-fuente, overlay de rectángulos, clips y lista de clips | T05, T06, T07 |
| **M3 · Motor de montaje** | Spike de render, planificador, grafo de vídeo, audio | T09, T10, T10b, T11, T12 |
| **M4 · Render** | Orquestación del render y la preview, ajustes de montaje | T13, T14 |
| **M5 · Previsualización y pulido** | Timeline del montaje, limpieza de la UI heredada, i18n y manual | T15, T16, T17 |
| **M6 · Empaquetado** | Builds de VideoMix | T18 |
| **M7 · Overlays** | Imágenes PNG, contadores, barras de progreso y efectos de sonido sobre el vídeo final | T19–T23 |
| **M8 · Mejoras v2** | A1, A2, A4, B1, B2, B5, C1, C2, D1, D2, E3 | T24–T34 |

## Tareas

| ID | Título | Hito | Modelo | Depende de | Estado |
|---|---|---|---|---|---|
| T01 | Rebranding e identidad de la app, CI | M0 | Sonnet | — | hecha |
| T02 | Entorno de desarrollo: ffmpeg y medios de prueba | M0 | Sonnet | — | hecha |
| T03 | Tipos, esquema `.vmx` y geometría | M1 | Opus | T01 | hecha |
| T04 | Store del proyecto y persistencia | M1 | Opus | T03 | hecha |
| T05 | Integración multi-fuente en la app | M2 | Opus | T04 | hecha |
| T06 | Overlay de rectángulos máx./mín. | M2 | Opus | T03 | hecha |
| T07 | Clips: creación, sincronización y lista | M2 | Opus | T05, T06 | hecha |
| T09 | Spike: estrategia de render ffmpeg (ADR-001) | M3 | Opus | T02 | hecha |
| T10 | Planificador de montaje | M3 | Opus | T03 | hecha |
| T10b | Ajuste del planificador (decisiones del usuario) | M3 | Opus | T10, T09 | hecha |
| T11 | Generador del grafo de vídeo | M3 | Opus | T09, T10 | hecha |
| T12 | Audio: análisis de sonoridad y grafo de audio | M3 | Opus | T03, T09 | hecha |
| T12b | Normalización de la pista de música | M3 | Sonnet | T12 | hecha |
| T13 | Orquestación del render y la previsualización | M4 | Opus | T07, T11, T12 | hecha |
| T14 | Diálogo de ajustes de montaje | M4 | Sonnet | T04 | hecha |
| T15 | Timeline del montaje (vista del plan) | M5 | Sonnet | T10, T13 | hecha |
| T16 | Limpieza de la UI heredada de LosslessCut | M5 | Sonnet | T13 | hecha |
| T17 | i18n (es), atajos y manual de usuario | M5 | Sonnet | T16 | hecha |
| T18 | Empaquetado de VideoMix | M6 | Sonnet | T17 | hecha |
| T19 | Overlays: modelo, migración v2 y anclajes | M7 | Opus | — | hecha |
| T20 | Overlays: render de vídeo (PNG, contador, barra) | M7 | Opus | T19 | hecha |
| T21 | Overlays: efectos de sonido en la mezcla | M7 | Sonnet | T19 | hecha |
| T21b | Overlays: sonoridad de efectos muy cortos | M7 | Sonnet | T21, T23 | hecha |
| T22 | Overlays: pistas en la vista Mix y panel de propiedades | M7 | Opus | T19 | hecha |
| T23 | Overlays: i18n, manual y revisión final | M7 | Sonnet | T20, T21, T22 | hecha |
| T24 | v2: modelo v3 y migración (todas las mejoras) | M8 | Opus | — | hecha |
| T25 | v2: encoders por hardware y H.265 (D2) | M8 | Sonnet | T24 | hecha |
| T26 | v2: textos libres y presets globales (B1, B2) | M8 | Opus | T24 | hecha |
| T27 | v2: lista de música y ducking (C1, C2) | M8 | Opus | T24 | hecha |
| T28 | v2: render incremental con caché (D1) | M8 | Opus | T25 | hecha |
| T29 | v2: salida vertical 9:16 y 1:1 (B5) | M8 | Opus | T24 | hecha |
| T30 | v2: fijar clips a un momento y grupos (A4) | M8 | Opus | T29 | pendiente |
| T31 | v2: miniaturas (A2) | M8 | Sonnet | T29 | hecha |
| T32 | v2: previsualización en vivo (A1) | M8 | Opus | T26, T27, T29 | pendiente |
| T33 | v2: tests end-to-end de la UI (E3) | M8 | Opus | T32 | pendiente |
| T34 | v2: i18n, manual y cierre | M8 | Sonnet | T24–T33 | pendiente |

La numeración T08 queda libre: la limpieza de UI se movió a T16, cuando ya existe el flujo nuevo completo.

## Orden de ejecución y paralelismo

```
T01 ─┬─ T03 ─┬─ T04 ─── T05 ─┐
T02 ─┤       ├─ T06 ─────────┴─ T07 ─┐
     │       ├─ T10 ─┐               │
     └─ T09 ─┴───────┼─ T11 ─────────┼─ T13 ─┬─ T15
                     └─ T12 ─────────┘       ├─ T16 ─ T17 ─ T18
                        T14 (tras T04) ──────┘
```

- Se lanzan en paralelo solo tareas que **no tocan los mismos ficheros**. Si hay riesgo, se usa un worktree aislado y el orquestador integra.
- Tareas paralelizables claras: T01 ∥ T02, T09 ∥ T03/T04, T06 ∥ T04/T05, T10 ∥ T05/T06, T14 ∥ M3.

## Riesgos principales

| Riesgo | Mitigación |
|---|---|
| El re-layout animado no es viable o es muy lento en ffmpeg | Spike T09 temprano, con fallback documentado (transición de fotograma completo) y consulta al usuario |
| Rendimiento del grafo con muchas entradas | Render por bloques (T09/T11) |
| La sincronización clips ↔ segmentos es frágil | Alternativa de segmentos derivados (04-diseno §6.3), decidida en T07 con ADR |
| `App.tsx` es enorme y está acoplado | Cambios mínimos, hooks o componentes nuevos, flag VideoMix localizado |
| Fuentes con rotación, VFR o códecs no soportados por Chromium | Coordenadas en el espacio orientado, `fps` en el grafo, reutilizar html5ify y el reproductor compat |

## Oleadas de M8

1. T24 (modelo).
2. T25 ∥ T26 ∥ T27.
3. T28 ∥ T29.
4. T30 ∥ T31.
5. T32.
6. T33.
7. T34.

## Pendientes al integrar en la rama por defecto

- `userManualUrl` en `src/common/constants.ts` apunta a la rama `claude/videomix-analysis-planning-97c8lp`; hay que cambiarla a la rama por defecto.

## Backlog (fuera de v1)

- Keyframes o paneo del rectángulo.
- Ajustes manuales del plan de montaje.
- Ducking de la música.
- Varias pistas de música.
- Notas en los clips.
- H.265 y encoders por hardware.
- Resolución libre.
- Miniaturas en la lista de clips y en la vista del plan; zoom horizontal del plan.
- Selector manual de filas o columnas en salida 1:1.
- Tope de 500 repeticiones de una pista muy corta en bucle.
- Borrar el código de LosslessCut que ahora está oculto (batch, export lossless, EDL, `reporting.tsx`…).
