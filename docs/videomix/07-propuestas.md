# 07 · Catálogo de propuestas de mejora

Propuestas hechas al usuario tras M7 (overlays), con su estado. El usuario elige cuáles se incorporan; las decisiones de cada una están en [01-requisitos](01-requisitos.md) (§10 v2, §12 v4).

- **Valor / esfuerzo**: S = pequeño, M = medio, L = grande. ⭐ = recomendadas en su día.
- **Estado**: ✅ hecha · 🚧 en curso · — sin elegir.
- **Ojo con los ID**: las mejoras v3 (§11 de requisitos, E1–E9) las propuso el usuario y usan otra numeración; no son las E1–E4 de este catálogo.

## A. Edición y flujo de trabajo

| # | Propuesta | Valor | Esfuerzo | Estado |
|---|---|---|---|---|
| A1 ⭐ | **Previsualización en vivo aproximada** del montaje en la app, sin renderizar. | Muy alto | L | ✅ v2 (T32) |
| A2 ⭐ | **Miniaturas** en la lista de clips y en la vista Mix. | Alto | M | ✅ v2 (T31) |
| A3 | **Zoom y scroll horizontal** en la vista Mix, para proyectos largos. | Medio | S | ✅ v5 (T53) |
| A4 ⭐ | **Ajustes manuales del plan**: fijar un clip a un momento, agrupar clips. | Alto | L | ✅ v2 (T30) |
| A5 | **Aplicar rectángulos a varios clips**: copiar y pegar el máx./mín. | Medio | S | ✅ v4 (T46) |
| A6 | **Crear clips en lote** por detección de escenas o silencios. | Medio | S–M | — |
| A7 | **Sugerencia automática de recorte**: quitar bandas negras (`cropdetect`) o recorte centrado a fracción. | Medio | M | ✅ v4 (T47) |
| A8 | **Velocidad por clip** (cámara lenta o rápida), teniendo en cuenta el audio. | Medio | M | — |
| A9 | **Keyframes o paneo del rectángulo** a lo largo del clip. | Alto | L | ✅ v4 (T48, T49) |

## B. Aspecto del montaje y overlays

| # | Propuesta | Valor | Esfuerzo | Estado |
|---|---|---|---|---|
| B1 ⭐ | **Textos libres** (títulos, rótulos, lower thirds). | Alto | S–M | ✅ v2 (T26) |
| B2 ⭐ | **Estilos reutilizables** (presets) de textos, contadores y barras. | Alto | S | ✅ v2 (T26) |
| B3 | **Estética de columnas**: esquinas redondeadas, sombra, fondo de imagen o color. | Medio | M | — |
| B4 | **Transición por clip**, que sustituye a la global en clips concretos. | Medio | M | — |
| B5 ⭐ | **Otras proporciones de salida**: 9:16 y 1:1. | Muy alto si publicas en redes | L | ✅ v2 (T29) |
| B6 | **Imágenes animadas** (GIF/APNG/WebM con alfa) como overlay. | Medio | M | — |

## C. Audio

| # | Propuesta | Valor | Esfuerzo | Estado |
|---|---|---|---|---|
| C1 ⭐ | **Ducking** de la música cuando suenan los clips. | Alto | M | ✅ v2 (T27) |
| C2 | **Varias pistas de música** en secuencia, con crossfade. | Medio | M | ✅ v2 (T27) |
| C3 | **Curva de volumen por clip**: fades o subidas puntuales dentro de un clip. | Medio | M | — |
| C4 | **Cortes al ritmo de la música**: detectar beats y alinear los cambios de clip. | Alto | L | — |
| C5 | **Solo música**: silenciar todos los clips con un interruptor global. | Bajo | S | — |

## D. Render y salida

| # | Propuesta | Valor | Esfuerzo | Estado |
|---|---|---|---|---|
| D1 ⭐ | **Render incremental** con caché de bloques. | Muy alto | M | ✅ v2 (T28) |
| D2 ⭐ | **Codificación por hardware** y H.265. | Alto | M | ✅ v2 (T25) |
| D3 | **Exportar varias versiones a la vez** (1080p + 720p, 16:9 + 9:16…). | Medio | S–M | — |
| D4 | **Exportar el montaje a FCPXML/EDL** para terminarlo en otro editor. | Medio | M | — |
| D5 | **Proxies** de baja resolución para fuentes 4K o pesadas. | Alto con 4K | M | — |

## E. Proyecto y mantenimiento

| # | Propuesta | Valor | Esfuerzo | Estado |
|---|---|---|---|---|
| E1 | **Reenlazar en lote**: si mueves la carpeta de vídeos, localizar una fuente reenlaza todas. | Medio | S | — |
| E2 | **Borrar el código oculto de LosslessCut** (batch, export lossless, EDL…). | Medio (interno) | M | — |
| E3 ⭐ | **Tests end-to-end de la UI** con Playwright + Electron. | Alto (calidad) | M | ✅ v2 (T33) |
| E4 | **Workflow de CI manual** que genere los instalables de Linux y Windows. | Medio | S | — |

## Propuestas del usuario fuera del catálogo

- v3 (§11 de requisitos): E1–E9, bugs B1 (SAR) y B2 (re-vincular). ✅
- M10: modal de progreso del render y vídeos convertidos en la caché. ✅
- v4 (§12): F1 indicador de encaje en fracciones y F2 imán / "Ajustar a". ✅ (T44, T44b, T45)
- v5 (§13): G1–G5 (correcciones del planificador, la vista Mix, los atajos y "Ajustar a"). ✅ (T51–T54)
- v6 (§14): H1–H8, bloques de overlays y plantillas (incluye las ideas E1–E6 de esa propuesta, distintas de las E del catálogo). ✅ (T56–T59)
