# Ejecución

## Proceso

1. **El orquestador** (sesión principal) mantiene el plan ([../05-plan.md](../05-plan.md)) y los task-docs. Lanza un agente por tarea con el modelo indicado.
2. **El agente**:
   - lee el task-doc y los documentos que enlaza (siempre [01-requisitos](../01-requisitos.md), [03-convenciones](../03-convenciones.md) y lo relevante de [02-as-built](../02-as-built.md) y [04-diseno](../04-diseno.md));
   - implementa la tarea;
   - pasa `yarn tsc && yarn lint && yarn test run`;
   - rellena la sección **Notas de ejecución** del task-doc.
   - **No hace commits** ni usa `git stash`, `git checkout` o `git reset`: el árbol de trabajo se comparte con otros agentes.
3. **Revisión del orquestador**:
   - revisa el diff contra el task-doc y las convenciones;
   - repite la validación;
   - pide correcciones al mismo agente si hace falta;
   - rellena **Revisión**, actualiza el estado en el task-doc y en el plan, y hace el commit (Conventional Commits, sin atribuciones) y el push.
4. **Decisiones de diseño**: si una tarea toma una decisión que afecta a otras, se registra en `../decisiones/ADR-XXX-titulo.md` y se enlaza desde [04-diseno](../04-diseno.md).
5. **Dudas de requisitos**: el agente **no asume**. Documenta la duda en "Notas de ejecución", elige la opción más conservadora si puede avanzar y el orquestador la consulta con el usuario.

## Plantilla de task-doc

```markdown
# TXX · Título

- **Hito**: MX · **Modelo**: Opus|Sonnet · **Depende de**: TYY · **Estado**: pendiente

## Objetivo
## Contexto (leer antes de empezar)
## Alcance
## Fuera de alcance
## Especificación
## Ficheros previstos
## Criterios de aceptación
## Validación

## Notas de ejecución
(Las rellena el agente: resumen de cambios, decisiones, desviaciones, dudas.)

## Revisión
(La rellena el orquestador: resultado, commit(s).)
```

## Tareas

| ID | Task-doc |
|---|---|
| T01 | [T01-rebranding.md](T01-rebranding.md) |
| T02 | [T02-entorno-medios-prueba.md](T02-entorno-medios-prueba.md) |
| T03 | [T03-modelo-geometria.md](T03-modelo-geometria.md) |
| T04 | [T04-store-proyecto.md](T04-store-proyecto.md) |
| T05 | [T05-multi-fuente.md](T05-multi-fuente.md) |
| T06 | [T06-overlay-rectangulos.md](T06-overlay-rectangulos.md) |
| T07 | [T07-clips.md](T07-clips.md) |
| T09 | [T09-spike-render.md](T09-spike-render.md) |
| T10 | [T10-planificador.md](T10-planificador.md) |
| T10b | [T10b-ajuste-planificador.md](T10b-ajuste-planificador.md) |
| T11 | [T11-grafo-video.md](T11-grafo-video.md) |
| T12 | [T12-audio.md](T12-audio.md) |
| T12b | [T12b-normalizar-musica.md](T12b-normalizar-musica.md) |
| T13 | [T13-render.md](T13-render.md) |
| T14 | [T14-ajustes-montaje.md](T14-ajustes-montaje.md) |
| T15 | [T15-timeline-montaje.md](T15-timeline-montaje.md) |
| T16 | [T16-limpieza-ui.md](T16-limpieza-ui.md) |
| T17 | [T17-i18n-manual.md](T17-i18n-manual.md) |
| T18 | [T18-empaquetado.md](T18-empaquetado.md) |
| T19 | [T19-overlays-modelo.md](T19-overlays-modelo.md) |
| T20 | [T20-overlays-render.md](T20-overlays-render.md) |
| T21 | [T21-overlays-sonido.md](T21-overlays-sonido.md) |
| T21b | [T21b-sonidos-cortos.md](T21b-sonidos-cortos.md) |
| T22 | [T22-overlays-ui.md](T22-overlays-ui.md) |
| T23 | [T23-overlays-cierre.md](T23-overlays-cierre.md) |
| T24 | [T24-v2-modelo.md](T24-v2-modelo.md) |
| T25 | [T25-v2-encoders.md](T25-v2-encoders.md) |
| T26 | [T26-v2-textos-presets.md](T26-v2-textos-presets.md) |
| T27 | [T27-v2-musica-ducking.md](T27-v2-musica-ducking.md) |
| T28 | [T28-v2-render-incremental.md](T28-v2-render-incremental.md) |
| T29 | [T29-v2-salida-vertical.md](T29-v2-salida-vertical.md) |
| T30 | [T30-v2-plan-manual.md](T30-v2-plan-manual.md) |
| T31 | [T31-v2-miniaturas.md](T31-v2-miniaturas.md) |
| T32 | [T32-v2-preview-vivo.md](T32-v2-preview-vivo.md) |
| T33 | [T33-v2-tests-e2e.md](T33-v2-tests-e2e.md) |
| T34 | [T34-v2-cierre.md](T34-v2-cierre.md) |
| T35 | [T35-v3-bug-sar.md](T35-v3-bug-sar.md) |
| T35b | [T35b-refresco-metadatos.md](T35b-refresco-metadatos.md) |
| T36 | [T36-v3-modelo.md](T36-v3-modelo.md) |
| T37 | [T37-v3-ui-edicion.md](T37-v3-ui-edicion.md) |
| T38 | [T38-v3-planificador.md](T38-v3-planificador.md) |
| T38b | [T38b-v3-ampliar-max.md](T38b-v3-ampliar-max.md) |
| T38c | [T38c-v3-reorden-ilimitado.md](T38c-v3-reorden-ilimitado.md) |
| T38d | [T38d-v3-girar-clip.md](T38d-v3-girar-clip.md) |
| T39 | [T39-v3-ui-cadenas-render.md](T39-v3-ui-cadenas-render.md) |
| T40 | [T40-v3-cierre.md](T40-v3-cierre.md) |
| T41 | [T41-modal-render.md](T41-modal-render.md) |
| T42 | [T42-html5ify-cache.md](T42-html5ify-cache.md) |
| T43 | [T43-capas-preview.md](T43-capas-preview.md) |
| T44 | [T44-v4-modelo.md](T44-v4-modelo.md) |
| T44b | [T44b-v4-tolerancia.md](T44b-v4-tolerancia.md) |
| T45 | [T45-v4-encaje-ui.md](T45-v4-encaje-ui.md) |
| T46 | [T46-v4-copiar-pegar.md](T46-v4-copiar-pegar.md) |
| T47 | [T47-v4-bandas-negras.md](T47-v4-bandas-negras.md) |
| T48 | [T48-v4-keyframes-render.md](T48-v4-keyframes-render.md) |
| T49 | [T49-v4-keyframes-ui.md](T49-v4-keyframes-ui.md) |
| T50 | [T50-v4-cierre.md](T50-v4-cierre.md) |
| T51 | [T51-v5-atajos-deshacer.md](T51-v5-atajos-deshacer.md) |
| T52 | [T52-v5-planificador.md](T52-v5-planificador.md) |
| T53 | [T53-v5-vista-mix.md](T53-v5-vista-mix.md) |
| T54 | [T54-v5-ajustar-min.md](T54-v5-ajustar-min.md) |
| T55 | [T55-v5-cierre.md](T55-v5-cierre.md) |
