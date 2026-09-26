# VideoMix

VideoMix es un fork de [LosslessCut](https://github.com/mifi/lossless-cut) (GPL-2.0) orientado a **componer un vídeo final a partir de fragmentos (clips) de varios vídeos**, recortados en tiempo y en espacio, que se montan automáticamente en un fotograma 16:9 formado por columnas.

## Índice

| Documento | Contenido |
|---|---|
| [01-requisitos.md](01-requisitos.md) | Requisitos funcionales y decisiones tomadas con el usuario |
| [02-as-built.md](02-as-built.md) | Cómo está construido el proyecto base (arquitectura, ficheros clave, flujos) |
| [03-convenciones.md](03-convenciones.md) | Convenciones de código, comentarios, i18n, tests y commits a respetar |
| [04-diseno.md](04-diseno.md) | Diseño técnico de VideoMix (modelo de datos, UI, algoritmo de montaje, render ffmpeg, audio) |
| [05-plan.md](05-plan.md) | Hitos y tareas |
| [06-entorno-desarrollo.md](06-entorno-desarrollo.md) | Puesta en marcha, comandos, ffmpeg y vídeos de prueba |
| [07-propuestas.md](07-propuestas.md) | Catálogo de propuestas de mejora y su estado |
| [manual-usuario.md](manual-usuario.md) | Manual de usuario de VideoMix |
| [guia-vmxblock.md](guia-vmxblock.md) | Guía del formato `.vmxblock` (plantillas de bloques de overlays) para editarlo a mano |
| [vmxblock.schema.json](vmxblock.schema.json) | JSON Schema de `.vmxblock`, para autocompletar y validar en editores |
| [ejemplos/](ejemplos) | Plantillas `.vmxblock` de ejemplo, comentadas |
| [execution/](execution/README.md) | Proceso de ejecución y task-docs de cada tarea |

## Glosario

- **Fuente (source)**: fichero de vídeo añadido al proyecto.
- **Clip**: definición (no un fichero) de un fragmento de una fuente: intervalo de tiempo + rectángulo máximo + rectángulo mínimo opcional + ajustes (nombre, color, audio).
- **Rectángulo máx.**: zona máxima de la fuente que puede mostrarse del clip.
- **Rectángulo mín.**: zona de la fuente que siempre debe verse; está contenida en el máx.
- **Columna / slot**: franja vertical del fotograma final, de altura completa, en la que se reproduce un clip. Los anchos de las columnas visibles suman el ancho del fotograma.
- **Plan de montaje (MixPlan)**: resultado del algoritmo de montaje: qué clip va en qué columna, cuándo, con qué recorte y con qué transiciones.
- **Re-layout**: cambio de anchos de las columnas mientras hay clips en curso, animado de forma suave.
- **Proyecto (`.vmx`)**: fichero que guarda fuentes, clips y ajustes de salida.
- **Bloque**: grupo de overlays (v6, 01-requisitos §14) que se mueve como una sola pieza, con su propia ancla; sus miembros guardan tiempos relativos al inicio del bloque.
- **Plantilla (`.vmxblock`)**: fichero con el contenido de un bloque, exportado desde un proyecto para importarlo en otro (o editado a mano); ver [guia-vmxblock.md](guia-vmxblock.md).
