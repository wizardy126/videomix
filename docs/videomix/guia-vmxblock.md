# Guía del formato `.vmxblock`

Un fichero `.vmxblock` es una **plantilla de bloque de overlays** (01-requisitos §14, H1/H2): un grupo de elementos superpuestos (imágenes, textos, cuentas atrás, barras de progreso y sonidos) con sus tiempos relativos entre sí, listo para importarse en cualquier proyecto de VideoMix. Se genera con **Proyecto → Plantillas de bloque → Exportar bloque...** (o "Exportar selección..." desde el panel de selección múltiple de la vista Montaje), pero también se puede **escribir o editar a mano** con cualquier editor de texto: es la razón de que se lea con JSON5 (admite comentarios `//` y comas finales) aunque VideoMix siempre lo vuelva a escribir como JSON estricto al exportar.

Referencia formal: **[`vmxblock.schema.json`](vmxblock.schema.json)** (JSON Schema draft-07, generado desde el esquema zod de `videomix/blocks/vmxBlockFile.ts` y comprobado por un test). Un editor como VS Code lo usa para autocompletar y validar si el fichero empieza con:

```json5
{ "$schema": "./vmxblock.schema.json", ... }
```

(ajusta la ruta relativa a dónde tengas el `.vmxblock`; VideoMix ignora esta clave). Modelo y decisiones completas en [04-diseno §11](04-diseno.md#11-bloques-de-overlays-y-plantillas-v6-t56) y [ADR-004](decisiones/ADR-004-bloques-overlays.md).

## 1. Estructura general

```jsonc
{
  "format": "videomix-block",   // fijo
  "version": 1,                 // fijo (VideoMix rechaza una versión mayor con un mensaje claro)
  "name": "Nombre del bloque",
  "color": 3,                   // opcional; índice en la paleta de colores de clips/bloques (0 por defecto)
  "aspect": "16:9",              // "16:9" | "9:16" | "1:1": proporción de salida para la que se hizo
  "originalStart": 12.5,         // opcional en la práctica (falta en un fichero a mano ⇒ 0 s con "Tiempos originales")
  "clipAnchor": {                // opcional; informativo, lo escribe la app al exportar un bloque anclado a un clip
    "clipName": "Kick-off", "edge": "start", "offset": 1
  },
  "variables": { "rival": "Red" },  // opcional; valores por defecto de las {{variables}} de los textos
  "members": [ /* al menos uno; ver §2 */ ]
}
```

Todos los campos menos `format`, `version`, `name`, `aspect` y `members` son opcionales. Un fichero no reconocible (`format` distinto) o de una versión futura da un error específico en vez de una lista de discrepancias.

## 2. Miembros (`members`)

Cada miembro es un overlay normal (mismos campos que en el proyecto, tabla completa en 01-requisitos §9 y en el esquema), con dos diferencias:

- **Sin `absolutePath`**: los ficheros (`path` de una imagen o un sonido, `font.path` de un texto o cuenta atrás) son **relativos al propio `.vmxblock`** (con `/` como separador, incluso en Windows) o **absolutos**. VideoMix los resuelve al importar; si no encuentra alguno, el diálogo de importación pide localizarlo antes de poder continuar.
- **Ancla relativa al bloque**: `anchor.kind` solo puede ser `"absolute"` (segundos **desde el inicio del bloque**, no del vídeo) o `"element"` (referencia a otro miembro del bloque por su `id`, con `edge: "start" | "end"` y un `offset` en segundos, puede ser negativo). **No hay anclas a un clip** dentro del fichero: si en el proyecto el bloque estaba anclado a un clip, esa información queda solo en `clipAnchor` (nombre del clip, informativo) y el ancla real la elige quien importa (ver §4).

Cada tipo de miembro tiene sus propios campos obligatorios (además de `id`, `name`, `anchor`, `type` que llevan todos):

| `type` | Campos propios obligatorios | Opcionales |
|---|---|---|
| `image` | `path`, `duration`, `box`, `fadeIn`, `fadeOut` | — |
| `text` | `text`, `duration`, `box`, `align`, `color`, `border`, `lineSpacing`, `fadeIn`, `fadeOut`, `entry` | `fontSize`, `font` |
| `countdown` | `duration`, `box`, `align`, `decimals`, `leadingZeros`, `color`, `border`, `fadeOut` | `font` |
| `progressBar` | `duration`, `box`, `fillColor`, `backgroundColor`, `border`, `direction`, `mode` | `linkedCountdownId` (id de una cuenta atrás del mismo fichero) |
| `sound` | `path`, `gainDb` | — |

`box` es siempre `{ x, y, width, height }` en **fracción del fotograma** (0–1; en los textos no hay `height`, sale de las líneas). `border`/`shadow` llevan color `#rrggbb` o `#rrggbbaa`. `id` solo tiene que ser único **dentro del fichero** (no colisiona con nada del proyecto: al importar se generan ids nuevos siempre, así se puede importar el mismo fichero varias veces).

**Variables de texto** (H4, 01-requisitos §14): en el campo `text` de un miembro `text`, `{{nombre}}` se sustituye por su valor al importar/insertar; `{{nombre|valor}}` lleva un valor por defecto si no se rellena. El formulario de importación junta todos los marcadores de todos los textos del bloque; `variables` a nivel de fichero (arriba) da valores iniciales que pesan más que el `|valor` de cada texto. Una variable sin valor ni defecto se deja visible como `{{nombre}}` en el vídeo, con aviso.

## 3. Ejemplos comentados

Dos plantillas de ejemplo, verificadas con un test (`videomix/blocks/vmxBlockExamples.test.ts`, que las carga con `parseVmxBlockFile` y las instancia con `instantiateVmxBlock`, así que si algo deja de encajar con el analizador real, el test falla):

- **[`ejemplos/rotulo-ejercicio.vmxblock`](ejemplos/rotulo-ejercicio.vmxblock)**: dos textos (nombre del ejercicio y repeticiones) con variables, uno anclado al otro (`element`).
- **[`ejemplos/descanso.vmxblock`](ejemplos/descanso.vmxblock)**: un texto, una cuenta atrás, una barra de progreso **vinculada** a ella (`linkedCountdownId`) y un pitido anclado a su **fin** (mismo patrón que el ejemplo de la sección 7 del [manual de usuario](manual-usuario.md)).

Fragmento comentado (recortado de `descanso.vmxblock`) para ver la forma de una ancla a otro miembro y de una barra vinculada:

```jsonc
{
  "id": "cd", "name": "Cuenta atrás", "type": "countdown",
  "anchor": { "kind": "absolute", "time": 0 },   // 0 s desde el INICIO DEL BLOQUE, no del vídeo
  "duration": 15,
  "box": { "x": 0.4, "y": 0.2, "width": 0.2, "height": 0.14 },
  "align": "center", "decimals": 0, "leadingZeros": false,
  "color": "#ffffff", "border": { "width": 4, "color": "#000000" }, "fadeOut": 0.5,
  // sin "font": usa la fuente por defecto de VideoMix
},
{
  "id": "bar", "name": "Barra", "type": "progressBar",
  "anchor": { "kind": "absolute", "time": 0 },
  "duration": 15,               // obligatorio en el fichero, pero se ignora: "linkedCountdownId" manda
  "linkedCountdownId": "cd",    // toma el inicio y la duración de "cd"
  "box": { "x": 0.03, "y": 0.94, "width": 0.94, "height": 0.03 },
  "fillColor": "#7CFC98", "backgroundColor": "#00000080",
  "border": { "width": 2, "color": "#000000" }, "direction": "ltr", "mode": "fill",
},
{
  "id": "beep", "name": "Pitido", "type": "sound",
  "anchor": { "kind": "element", "elementId": "cd", "edge": "end", "offset": 0 },  // al llegar la cuenta atrás a 0
  "path": "sounds/beep.wav",   // relativo a este fichero (con "/"), o absoluto
  "gainDb": 0,
}
```

## 4. Qué decide quién importa (no está en el fichero)

- **Colocación** (dónde empieza el bloque en el vídeo de destino): tiempos originales (`originalStart`), desplazado ± s, en el cursor de la vista Montaje, o anclado a un clip del proyecto de destino (inicio/fin + desfase). El diálogo de importar preselecciona, sin marcarla, la opción "Anclado a un clip" con el clip del mismo nombre que `clipAnchor.clipName` si existe uno.
- **Variables**: el formulario parte de `variables` del fichero (y los `|valor` de los textos) pero el valor final es el que se escriba al importar.
- **Adaptar a otra proporción** (H7): si `aspect` no coincide con la del proyecto, "Adaptar" (marcada por defecto) reajusta las cajas conservando el tamaño relativo a la altura y el centro, sin deformar; los tiempos no cambian.
- **Agrupado o desagrupado**: por defecto se importa como un bloque nuevo (un `id` nuevo distinto en cada importación, así se puede repetir); "Importar desagrupado" lo deja como overlays sueltos.

## 5. Errores al leer un fichero roto

Nada se importa a medias: un error, aunque sea de un solo miembro, cancela toda la importación. Cada problema se muestra con el campo exacto y el motivo, por ejemplo:

```
members[2].box.width: Invalid input: expected number, received string
members[1].linkedCountdownId: No countdown member with id "img"
```

Un error de sintaxis JSON5 (una coma, una llave sin cerrar) da la línea y la columna. Las referencias entre miembros (`elementId`, `linkedCountdownId`, ids duplicados) solo se comprueban si la forma del fichero ya es válida, así que un fichero con varios problemas puede mostrar primero solo los de forma.
