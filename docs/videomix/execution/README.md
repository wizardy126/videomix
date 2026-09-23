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
| T22 | [T22-overlays-ui.md](T22-overlays-ui.md) |
| T23 | [T23-overlays-cierre.md](T23-overlays-cierre.md) |
