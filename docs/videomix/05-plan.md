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
| T15 | Timeline del montaje (vista del plan) | M5 | Sonnet | T10, T13 | pendiente |
| T16 | Limpieza de la UI heredada de LosslessCut | M5 | Sonnet | T13 | pendiente |
| T17 | i18n (es), atajos y manual de usuario | M5 | Sonnet | T16 | pendiente |
| T18 | Empaquetado de VideoMix | M6 | Sonnet | T17 | pendiente |

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
