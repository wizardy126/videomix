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
| **M9 · Mejoras v3 y correcciones** | E1–E9, B1, B2 | T35–T40 |
| **M10 · Render y conversiones** | Modal de progreso del render, vídeos convertidos en la caché del proyecto | T41–T43 |
| **M11 · Mejoras v4** | F1, F2, A5, A7, A9 | T44, T44b, T45–T50 |

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
| T30 | v2: fijar clips a un momento y grupos (A4) | M8 | Opus | T29 | hecha |
| T31 | v2: miniaturas (A2) | M8 | Sonnet | T29 | hecha |
| T32 | v2: previsualización en vivo (A1) | M8 | Opus | T26, T27, T29 | hecha |
| T33 | v2: tests end-to-end de la UI (E3) | M8 | Opus | T32 | hecha |
| T34 | v2: i18n, manual y cierre | M8 | Sonnet | T24–T33 | hecha |
| T35 | v3: bug SAR y re-vincular con otra resolución (B1, B2) | M9 | Opus | — | hecha |
| T35b | v3: refrescar metadatos (tamaño + SAR) al abrir y antes de renderizar | M9 | Sonnet | T35 | hecha |
| T36 | v3: modelo v4 (enlaces, secuencia, duración máxima) | M9 | Sonnet | — | hecha |
| T37 | v3: contador, "Nuevo clip desde aquí", duración estimada y máxima en UI (E1, E3, E4, E6) | M9 | Sonnet | T36 | hecha |
| T38 | v3: planificador — cadenas, secuencia y duración máxima (E2, E4, E5) | M9 | Opus | T36 | hecha |
| T38b | v3: ampliar más allá del máx. (E7) | M9 | Opus | T37, T38 | hecha |
| T38c | v3: ventana de reorden ilimitada y ampliable (E8) | M9 | Opus | T38b | hecha |
| T38d | v3: girar un clip (E9) | M9 | Opus | T38c, T35b | hecha |
| T39 | v3: UI de cadenas y secuencia, y render cortado al límite (E2, E4, E5) | M9 | Opus | T37, T38 | hecha |
| T40 | v3: i18n, manual, e2e y cierre | M9 | Sonnet | T35–T39 | hecha |
| T41 | Modal de progreso del render | M10 | Opus | — | hecha |
| T42 | Vídeos convertidos en la carpeta de caché del proyecto | M10 | Opus | — | hecha |
| T43 | Diálogos tapados por la previsualización en vivo; conservar conversiones al borrar caché | M10 | Opus | T41, T42 | hecha |
| T44 | v4: modelo v5 y lógica pura (encaje, keyframes, bandas negras) | M11 | Opus | — | hecha |
| T44b | v4: tolerancia de encaje del 1% sin deformar | M11 | Opus | T44 | hecha |
| T45 | v4: indicador de encaje, imán y "Ajustar a" (F1, F2) | M11 | Opus | T44 | hecha |
| T46 | v4: copiar y pegar el encuadre (A5) | M11 | Sonnet | T44 | pendiente |
| T47 | v4: bandas negras (A7) | M11 | Sonnet | T44 | pendiente |
| T48 | v4: keyframes en render, previsualización y miniaturas (A9) | M11 | Opus | T44 | en curso |
| T49 | v4: edición de keyframes (A9) | M11 | Opus | T44, T45, T48 | pendiente |
| T50 | v4: i18n, manual, e2e y cierre | M11 | Sonnet | T44–T49 | pendiente |

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

## Oleadas de M9

1. T35 ∥ T36.
1b. T35b.
2. T37 ∥ T38.
3. T38b.
4. T38c.
5. T38d.
6. T39.
7. T40.

## Oleadas de M10

1. T41 ∥ T42.
2. T43.

## Oleadas de M11

1. T44.
1b. T44b.
2. T45 ∥ T48.
3. T46 ∥ T47.
4. T49.
5. T50.

## Pendientes al integrar en la rama por defecto

- `userManualUrl` en `src/common/constants.ts` apunta a la rama `claude/videomix-analysis-planning-97c8lp`; hay que cambiarla a la rama por defecto.

## Backlog

- Notas en los clips.
- Resolución libre.
- Tope de 500 repeticiones de una pista muy corta en bucle.
- Borrar el código de LosslessCut que ahora está oculto (batch, export lossless, EDL, `reporting.tsx`…), propuesta E2.
- Las propuestas sin elegir de [07-propuestas](07-propuestas.md).
