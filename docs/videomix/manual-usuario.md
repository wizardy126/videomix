# Manual de usuario de VideoMix

VideoMix crea un vídeo final combinando fragmentos ("clips") de varios vídeos, mostrados uno junto a otro en columnas (o en filas, en salida vertical). Este manual cubre el flujo completo: crear un proyecto, añadir fuentes, definir clips, ajustar el montaje (incluida la salida vertical o cuadrada y los codificadores por hardware), añadir elementos superpuestos (imágenes, textos, cuentas atrás, barras y sonidos) con miniaturas y estilos guardados, la música de fondo con lista de reproducción y *ducking*, fijar y agrupar clips, previsualizar en vivo, previsualizar por render y renderizar.

## 1. Crear un proyecto

Al abrir VideoMix se crea automáticamente un proyecto sin título ("Proyecto sin título"). Un proyecto se guarda en un fichero `.vmx` (JSON5, es decir JSON algo más permisivo: admite claves sin comillas) que contiene las fuentes, los clips y los ajustes de montaje.

Menú **Proyecto**:

- **Nuevo proyecto**: cierra el proyecto actual (pide confirmación si hay cambios sin guardar) y empieza uno vacío.
- **Abrir proyecto...**: abre un `.vmx` existente. También puedes arrastrarlo a la ventana o abrirlo con `Ctrl/Cmd+O`.
- **Guardar proyecto** (`Ctrl/Cmd+S`) / **Guardar proyecto como...** (`Ctrl/Cmd+Shift+S`).

El título de la ventana muestra el nombre del proyecto y un asterisco (`*`) mientras haya cambios sin guardar. Al cerrar la aplicación con cambios pendientes se pide confirmación.

Si la aplicación se cerró de forma inesperada (se colgó, se cortó la luz...), al volver a abrirla te ofrecerá **restaurar** el proyecto recuperado automáticamente, descartarlo o decidirlo más tarde.

## 2. Añadir fuentes

Las fuentes son los vídeos de los que saldrán los clips. Aparecen en el panel de la izquierda ("Fuentes").

Para añadir vídeos:

- arrastra uno o varios ficheros de vídeo a la ventana o al panel de fuentes;
- pulsa el botón **+** del panel de fuentes;
- o usa **Proyecto → Añadir vídeos...**.

Un vídeo ya añadido no se duplica: si lo vuelves a soltar, simplemente se activa.

Al pulsar una fuente de la lista se activa: se carga en el reproductor central junto con su línea de tiempo, y muestra su duración y el número de clips que tiene. Cambiar de fuente no afecta a las demás: los clips de todas las fuentes se conservan y quedan siempre listados en el panel de clips (a la derecha).

Para quitar una fuente pulsa la **✕** de su fila. Si tiene clips, se pide confirmación (se eliminan también sus clips).

Si al abrir un proyecto falta un fichero de fuente, la fila lo indica con un aviso "Fichero no encontrado" y un enlace **Localizar...** para indicar su nueva ubicación.

**Abrir carpeta** (menú Archivo) añade como fuentes todos los vídeos de una carpeta (y sus subcarpetas); los ficheros de imagen se ignoran.

Si el reproductor no puede mostrar una fuente (por ejemplo, un códec que Chromium no soporta, como MPEG-4 Part 2 o ProRes), VideoMix crea automáticamente una versión convertida solo para verla en el reproductor; el render usa siempre el fichero original. Con el proyecto guardado, esa conversión se guarda en la carpeta de caché del proyecto (`.<nombre>.vmx.cache/converted/`, ver la sección 8.1) y se reutiliza al volver a activar la fuente o al reabrir el proyecto. Mientras el proyecto no se ha guardado, se guarda junto al vídeo original (como en LosslessCut); esas conversiones antiguas se siguen reutilizando después de guardar el proyecto.

Las fuentes con **píxeles no cuadrados** (relación de aspecto de muestra o SAR distinta de 1:1, algo habitual en vídeo anamórfico o grabado con ciertas cámaras) se gestionan de forma automática: no hace falta hacer nada especial. El reproductor, los rectángulos, las miniaturas y el render usan siempre los píxeles "de visualización" (los que se ven, con la fuente ya estirada a su proporción real), igual que la rotación del vídeo.

Al añadir o activar una fuente, VideoMix analiza en segundo plano si tiene **bandas negras** (superiores/inferiores o laterales, típico de vídeo con otra proporción incrustado). Con el ajuste **Quitar bandas negras automáticamente** activado (por defecto, ver §5), los clips **nuevos** que se creen de esa fuente a partir de entonces nacen ya recortados a la zona con imagen; si la detección todavía no ha terminado, el clip nace con el fotograma completo, como antes.

### Música de fondo

Si sueltas o añades un fichero de audio (mp3, m4a, aac, wav, flac, ogg, opus...), se te preguntará si quieres usarlo como música del proyecto (o sustituir la música actual). El volumen y el bucle de la música se ajustan en **Ajustes de montaje** (ver §5).

## 3. Crear clips

Un **clip** es un recorte en tiempo (inicio/fin) y en espacio (un rectángulo dentro del fotograma) de una fuente. Los clips se guardan como definición, no como vídeo exportado: el montaje final se genera al renderizar.

Con una fuente activa, la línea de tiempo inferior funciona como en cualquier editor de vídeo:

| Acción | Atajo |
|---|---|
| Marcar inicio | `I` |
| Marcar fin (crea el clip) | `O` |
| Añadir clip desde el cabezal | `N` o botón **+** de la lista de clips |
| Dividir el clip actual en dos | `B` |
| Quitar el punto de corte actual (elimina el clip) | `Retroceso` |
| Duplicar el clip seleccionado | `Ctrl/Cmd+D` |
| Eliminar el clip seleccionado | `Supr` / `Cmd+Retroceso` |

Al crear un clip se le asigna un nombre por defecto (`<fuente> #n`) y un color de una paleta; su rectángulo máximo ocupa inicialmente el fotograma completo.

**Contador de duración**: con un inicio marcado y sin fin (tras `I`), junto al cabezal de la línea de tiempo y en la barra inferior se muestra la duración desde ese inicio hasta el cursor, que se actualiza mientras te mueves. Con un clip ya creado seleccionado se muestra en su lugar la duración real del clip y, a su lado (con una flecha `→`), la duración que tendría si su fin se moviera al cursor actual; así puedes ver el efecto de un recorte antes de aplicarlo.

### Clips solapados y "Nuevo clip desde aquí"

Normalmente un clip nuevo empieza donde termina la línea de tiempo libre. Para encuadrar el **mismo metraje de otra forma** (otro rectángulo, otro tiempo) puedes crear un clip que se solape con otro ya existente:

- **Duplicar** (`Ctrl/Cmd+D`) el clip y luego cambiar sus tiempos y/o su rectángulo.
- **Nuevo clip desde aquí** (`Mayús+I`, o el botón dedicado de la barra inferior junto a "Marcar inicio"): pone un inicio nuevo en el cursor aunque caiga dentro de otro clip (a diferencia de `I`, que si el cursor cae dentro de un clip lo selecciona en vez de marcar). Con el inicio marcado, **Marcar fin** (`O`) cierra ese tramo como un clip nuevo e independiente, solapado con el que ya hubiera ahí.

Los clips solapados de una misma fuente **no se enlazan automáticamente** (ver más abajo): al crearse a propósito para volver a encuadrar el mismo metraje, encadenarlos repetiría contenido en el vídeo final.

### Recortar en espacio: rectángulos máximo y mínimo

Con un clip seleccionado, sobre el vídeo aparece un overlay con su rectángulo:

- **Máx.**: la zona máxima de la fuente que puede llegar a mostrarse.
- **Mín.** (opcional): la zona que siempre debe verse, contenida en el máx. Si no se define, el montaje solo puede recortar hasta el máx. (mín. = máx.).

Arrastra los tiradores de las esquinas y los lados para redimensionar, o el interior para mover. Con el rectángulo seleccionado (haz clic sobre él), las flechas del teclado lo desplazan 2 px (10 px con Mayús).

La barra de herramientas, en una franja encima del vídeo (así nunca tapa los tiradores ni las etiquetas), permite:

- fijar una **proporción** para el máx. (Libre, 9:16, 3:4, 1:1, 4:3, 16:9);
- **Mín. = Máx.** (quita el mínimo) / **Añadir mín.**;
- **Rellenar fotograma** (el máx. vuelve a ocupar todo el vídeo);
- **Quitar bandas negras**: analiza el tramo de este clip y ajusta el máx. a la zona con imagen encontrada (el mín. se recorta para seguir dentro, sin llegar a quedar más pequeño que el mínimo permitido); si no encuentra bandas, avisa y no cambia nada. Funciona siempre, esté o no activado el ajuste automático de §5;
- **girar el clip** −90°, +90° o 180° (ver abajo); si está girado, muestra el giro (p. ej. `90°`);
- **Animar** (cronómetro): paneo y zoom del encuadre con keyframes (ver abajo).

**Encaje en fracciones, imán y "Ajustar a"**: sobre el recorte se ven unas etiquetas (chips) que dicen en qué fracción del ancho de salida encaja el clip (1/3, 1/2, 2/3 o completo, o el alto en salida vertical): ✓ si encaja, ↔ si solo ampliando más allá del máx. (con "Ampliar más allá del máx." activo y material en la fuente), ✗ si no, con cuántos px de la fuente faltan o sobran. La lista de clips muestra lo mismo de forma compacta. El **imán** (icono a la izquierda de "Ajustar a", desactivado por defecto) engancha el borde que arrastras del máx. o del mín. al tamaño exacto de una fracción si te acercas lo suficiente; mantener **Alt** mientras arrastras invierte su estado para ese arrastre. Los botones **Ajustar a 1/3 / 1/2 / 2/3** dejan el clip encajado exactamente en esa fracción (un paso de deshacer): si el clip tiene mín., se ajusta **el mín.** (crece o encoge, centrado en sí mismo); si el máx. no es lo bastante ancho para contenerlo, se ensancha lo justo, centrado en sí mismo, dentro del fotograma. Sin mín., se ajusta el máx. como antes, centrado en sí mismo. Si no cabe ni ensanchando todo lo posible dentro del fotograma, un aviso explica el motivo y no cambia nada.

**Tolerancia de encaje del 1 %**: un desajuste de hasta un 1 % entre la proporción del clip y la de su columna (por ejemplo, tres clips verticales "Ajustados a 1/3" cuya fracción exacta no cae en un número entero de píxeles) se absorbe siempre **sin deformar la imagen**, y por eso cuenta como ✓ en los chips de encaje: primero se recorta un poco dentro del máx. (repartido en los dos lados, escalando esa pequeña diferencia de forma uniforme); si eso no es posible (el mín. ya llega hasta ese borde), se amplía unos píxeles más allá del máx. cuando el clip lo permite ("Ampliar más allá del máx.", más arriba) y hay material en la fuente; solo si ninguna de las dos cabe, la imagen se estira como mucho un 1 % (sin apreciarse). Los chips ✓ ya tienen en cuenta esta tolerancia; ↔ significa que haría falta ampliar más de lo que cubre la tolerancia.

**Girar un clip**: cada clip puede girarse +90°, −90° o 180° (por ejemplo, un vídeo grabado de lado) con los botones de giro de esta barra, con su menú contextual (lista de clips y pestaña **Montaje**) o con `R` (+90°), `Mayús+R` (−90°) y `Alt+R` (180°). Con el clip seleccionado, el reproductor muestra la imagen ya girada y los rectángulos se editan sobre ella; al girar, los rectángulos giran con la imagen, así que el encuadre se conserva. Todo lo demás usa la imagen girada: la orientación del clip (un vídeo horizontal girado 90° es vertical), el montaje, la previsualización en vivo, las miniaturas y el render. El giro se suma a la rotación que ya indique el propio fichero. Su fila de la lista muestra el giro junto a la orientación.

**Animar el encuadre (paneo y zoom)**: el botón **Animar** crea el primer keyframe del clip en el cursor con el encuadre actual y, desde entonces, el overlay muestra el encuadre que tiene el clip en el instante del cursor (interpolado entre keyframes). Mover o escalar el máx. en un instante crea el keyframe de ese instante o actualiza el que ya haya (auto-key; un paso de deshacer por gesto). Mientras está animado, el máx. conserva siempre su proporción (los tiradores escalan sin deformar y el imán no actúa sobre él), así que el encaje en fracciones y el montaje no cambian; el mín. se mueve y escala con el máx., y editarlo cambia su posición dentro del máx. en todos los keyframes. Los keyframes se ven como rombos en la línea de tiempo; en la barra están **keyframe anterior / siguiente** (`Mayús+,` / `Mayús+.`), **añadir** un keyframe con el encuadre que se ve (útil para que se quede quieto hasta ahí) o **borrar** el del cursor (`Mayús+Retroceso`) y, con el cursor sobre un keyframe, su **interpolación** hasta el siguiente: **Suave** (por defecto, acelera y frena), **Lineal** o **Mantener** (salto seco al llegar al siguiente). Las acciones de la barra que cambian la proporción o el mín. (proporción, **Ajustar a**, **Rellenar fotograma**, **Añadir mín.**) se aplican al clip entero: cada keyframe conserva su centro y su tamaño relativo; **Quitar bandas negras** recorta igual y además mantiene todos los keyframes dentro de la imagen. Desactivar **Animar** (pide confirmación) borra los keyframes y el clip se queda con el encuadre que se ve en el cursor; lo mismo al borrar el último. El render, la previsualización en vivo y las miniaturas usan el encuadre animado.

**Copiar y pegar el encuadre**: el menú contextual de un clip (lista de clips o pestaña **Montaje**) tiene **Copiar encuadre** (máx., mín., giro y, si el clip está animado, sus keyframes) y **Pegar encuadre**, también con `Ctrl/Cmd+Mayús+C` y `Ctrl/Cmd+Mayús+V`. Pegar se aplica al clip activo o, si hay varios seleccionados, a todos ellos, en un solo paso de deshacer. Si la fuente del clip de destino tiene otro tamaño se escala proporcionalmente (como al volver a vincular una fuente, §2); si además tiene otra proporción, el encuadre se ajusta al fotograma y aparece un aviso. **Ampliar más allá del máx. si hace falta** y el audio del clip no se copian.

El montaje elige, para cada clip y cada columna, un recorte que respeta el mínimo, cabe dentro del máximo y tiene la proporción de esa columna; si hace falta ampliar mucho la imagen (más de ×2), el clip lo indica en su fila de la lista.

**Ampliar más allá del máx. si hace falta** (activado por defecto en cada clip): si, respetando los máximos, una disposición dejaría relleno (o franjas a los lados o arriba y abajo de un clip), el montaje muestra como último recurso más material de la fuente de los clips que lo permiten, a lo ancho en columnas y a lo alto en filas, centrado en el máximo (si a un lado no hay más imagen, se amplía por el otro). No se aplica al final del vídeo. Se desactiva por clip con el icono de ampliar de su fila o con su menú contextual, y los clips ampliados se marcan en la pestaña **Montaje** (con el tramo y los píxeles ampliados) y en la confirmación previa al render.

### La lista de clips

El panel derecho lista **todos** los clips del proyecto, de cualquier fuente, en el orden en que se montarán (reordenable arrastrando el asa `⋮⋮`), con una **miniatura** del fotograma de inicio ya recortado a su rectángulo máximo. Por cada clip se puede:

- cambiar su **nombre** (clic sobre el nombre, escribe y pulsa Intro);
- cambiar su **color** (clic en el número de la fila);
- **silenciar** su audio o ajustar su **ganancia** (−20…+20 dB);
- activar o desactivar **Ampliar más allá del máx. si hace falta** (ver arriba);
- ver su **duración** y avisos (clip muy corto, sin mínimo definido, etc.);
- con el menú contextual (clic derecho): duplicar, eliminar, ir a su fuente, **fijar** o **agrupar** (ver más abajo).

Al hacer clic en un clip de otra fuente, esa fuente se activa automáticamente y el reproductor salta a su inicio.

Deshacer/rehacer (`Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`) cubre todas las ediciones del proyecto: fuentes, clips, rectángulos y ajustes.

### Fijar y agrupar clips

Con el menú contextual de un clip (clic derecho, en la lista o en la pestaña **Montaje**):

- **Fijar aquí (m:ss)**: el clip empieza obligatoriamente en el instante del cursor de la vista Montaje en el vídeo final; el planificador puede desplazarlo un poco si no hay sitio (se avisa antes de renderizar) pero nunca lo adelanta. **Quitar fijación** lo libera.
- Con **varios clips seleccionados** (Ctrl/Cmd-clic para añadir uno a la selección, Mayús-clic para seleccionar un rango): **Agrupar seleccionados** los une para que empiecen siempre juntos (con el menor instante fijado de sus miembros, si alguno está fijado); **Desagrupar** deshace el grupo. Un grupo se pinta con una franja de color propia en la lista y en la vista Montaje.

Un clip fijado o agrupado se distingue por el icono de chincheta (con el instante en el *tooltip*) y, si está agrupado, por el borde/franja del color del grupo. Arrastrar un bloque en la vista **Montaje** (§6) lo fija en su nuevo instante al soltarlo.

### Clips enlazados

Dos clips de la **misma fuente** se enlazan automáticamente si el inicio del segundo está, como mucho, un número de segundos configurable después del fin del primero (el ajuste **Enlazar clips de una fuente separados hasta (s)** de §5, 10 s por defecto; `0` lo desactiva). Los clips enlazados forman una **cadena** que ocupa **el mismo hueco** del montaje (la misma columna o fila): se muestran uno detrás de otro, con **corte directo** o con la transición global del proyecto, según el ajuste **Entre clips enlazados** (§5). Si la proporción del hueco no coincide con la del clip siguiente de la cadena, el hueco se reajusta con la animación normal de recolocación.

Los clips que **se solapan no se enlazan nunca automáticamente** (ver "Clips solapados" en §3): están pensados para volver a encuadrar el mismo metraje, y encadenarlos repetiría contenido.

En la lista de clips, un icono de eslabón 🔗 con la posición y el tamaño de la cadena (p. ej. `2/3`) indica que un clip está enlazado con el anterior de su fuente; un clic sobre el icono **rompe** el enlace. Un clip cuyo enlace automático se rompió a mano se marca con un icono de eslabón roto; un clic sobre él **restablece** el enlace. También se puede **forzar** un enlace entre dos clips que no cumplirían la regla automática (por ejemplo, si están más separados que el margen configurado, o incluso si se solapan) desde el menú contextual del clip (**Forzar enlace con el clip anterior** / **Romper enlace con el clip anterior**).

### Secuencia siempre visible

El proyecto puede tener **una** secuencia: una lista ordenada de clips que se sacan del reparto normal de columnas o filas. En todo momento hay uno de sus clips en pantalla, en un **hueco propio** cuya posición decide el algoritmo de montaje (puede cambiar de sitio en los re-layouts); el resto de clips se reparte con normalidad en los demás huecos. Si la secuencia termina antes que el resto del montaje, su hueco pasa a usarse con normalidad; si termina después, el vídeo sigue hasta que termine ella. En conjunto, **el vídeo dura lo que dure lo más largo** entre la secuencia y el resto del montaje.

La secuencia aparece como una sección propia ("Siempre visible") encima de la lista de clips, en el panel derecho:

- **Añadir** un clip arrastrándolo desde la lista hasta la sección, o con **Añadir a la secuencia siempre visible** de su menú contextual (también con varios clips seleccionados a la vez).
- **Reordenar** arrastrando sus filas (tienen su propia asa `⋮⋮`) y **quitar** con la **✕** de su fila o **Quitar de la secuencia siempre visible** del menú contextual.

En la lista de clips normal, un clip que está en la secuencia muestra su posición (número) en un indicador propio.

## 4. Orden de los clips

El orden de la lista de clips es la base del montaje, pero el algoritmo puede reordenar para encajar los tamaños de columna, dentro de una "ventana de reordenación" configurable: un número de posiciones (sin tope práctico; 3 por defecto) o **Ilimitado**, que permite traer clips de cualquier punto del proyecto para rellenar los huecos. Aun así, entre opciones igual de buenas se sigue prefiriendo el orden de la lista. También existe un **orden aleatorio** reproducible (con una semilla guardada en el proyecto y un botón para "barajar de nuevo"); se elige en Ajustes de montaje.

Para decidir entre varios montajes posibles con esa ventana, VideoMix calcula también el plan con ventanas menores (0, 3 y 10, según cuál sea mayor) y se queda con el mejor de todos según el criterio de **Priorizar** (más abajo): así, elegir **Ilimitado** (o cualquier número grande) **nunca da un resultado peor** que elegir 3 o 10, aunque tarde un poco más en calcularlo.

**Priorizar** (Ajustes de montaje → Orden) decide qué se entiende por "mejor montaje" cuando hay varias formas de encajar los clips:

- **Duración más corta** (por defecto): gana el plan que dura menos; en caso de empate, el que tenga menos relleno, después el más cercano al orden de la lista y por último el que cambie menos veces de disposición. Con este criterio, el montaje puede aceptar unas franjas negras (pillarbox/letterbox) breves en algún clip si eso hace que el vídeo final sea más corto.
- **Menos relleno**: gana el plan con menos huecos de relleno; en caso de empate, el más corto, luego el más cercano al orden de la lista y por último el que cambie menos veces de disposición.

## 5. Ajustes de montaje

Se abren con **Proyecto → Ajustes de montaje...** (`Ctrl/Cmd+Shift+M`) o el botón **Ajustes** de la barra inferior:

| Sección | Ajustes |
|---|---|
| **Salida** | **proporción** (16:9 horizontal con clips lado a lado, 9:16 vertical con clips apilados, 1:1 cuadrado — el montaje elige lado a lado o apilados, lo que mejor encaje), resolución (lado corto: 720p / 1080p / 4K), fotogramas por segundo, calidad (CRF), preset de velocidad, **códec de vídeo** (H.264 / H.265-HEVC), **codificador** (Automático, Solo software, o uno de hardware — NVIDIA NVENC, Intel Quick Sync, Apple VideoToolbox, VAAPI — marcado como detectado o no según el equipo) y **límite de duración del vídeo** (desactivado por defecto; ver más abajo) |
| **Composición** | máximo de columnas o filas visibles (1–6, según la proporción), separación entre columnas o filas en px (y su color), relleno del hueco (desenfoque o color sólido), **quitar bandas negras automáticamente** (activado por defecto; ver §2 y §3) |
| **Orden** | orden de la lista o aleatorio (con semilla y "barajar de nuevo"), ventana de reordenación (número de posiciones o casilla "Ilimitado"), **Priorizar** (duración más corta o menos relleno; ver §4) |
| **Enlaces** | margen para enlazar automáticamente clips de una misma fuente (segundos; 10 por defecto, `0` lo desactiva) y transición entre clips enlazados (corte directo o la transición global) — ver "Clips enlazados" en §3 |
| **Transición** | tipo (fundido, disolución, barridos, deslizamientos...) y duración; fundido de entrada/salida al principio y final del vídeo |
| **Música** | **lista de reproducción** de varias pistas (añadir, reordenar, quitar, volumen por pista), fundido cruzado entre pistas, repetir la lista si es más corta que el vídeo y **ducking** (bajar automáticamente la música mientras se oye algún clip) — ver §5.1 |

Cada cambio se guarda en el historial (se puede deshacer) y marca el proyecto como modificado. Cambiar la **proporción** de salida reajusta además, para conservar su forma sin deformarla, la caja de cualquier imagen superpuesta cuyo fichero se pueda volver a leer en ese momento (véase §7).

En 1:1 el montaje decide, proyecto a proyecto, si sale mejor en columnas o en filas (según el tipo de clips); no hay un selector manual de eje.

### Duración estimada y duración máxima

Junto a los botones **Ajustes**, **Vista previa** y **Renderizar** de la barra inferior (en ambas pestañas, **Fuente** y **Montaje**) se muestra siempre la **duración estimada** del montaje actual ("≈ m:ss"), calculada con el planificador real (con un pequeño retardo tras cada cambio) para tener en cuenta clips, cadenas, secuencia y ajustes.

El interruptor **Limitar la duración del vídeo** de la sección **Salida** (desactivado por defecto) fija una **duración máxima**. Si el montaje calculado dura más, el vídeo final se **corta en ese límite** aplicando el *fade* de salida global (vídeo y audio) en el corte; el indicador de duración estimada se resalta en ese caso y muestra a qué instante se recorta (`→ cortado en m:ss`). El aviso también aparece en la confirmación previa a previsualizar o renderizar (§8). Con un límite activo, el planificador **favorece disposiciones con más columnas o filas** para que quepa más contenido antes del corte.

### 5.1 Música: lista de reproducción y *ducking*

Al soltar o añadir un fichero de audio se pregunta si se usa como música del proyecto (o se añade al final de la lista si ya había alguna). En la sección **Música** de los ajustes:

- **Lista de pistas**: arrastra el asa para reordenarlas, edita el volumen de cada una (−30…+6 dB) y quítalas con su botón; **Añadir ficheros de música…** admite selección múltiple.
- **Fundido cruzado entre pistas**: 0–10 s; cada pista empieza ese tiempo antes de que termine la anterior.
- **Repetir la lista si es más corta que el vídeo**: si no, la música termina y el resto del vídeo queda sin música.
- ***Ducking***: interruptor y cantidad (−30…−3 dB); mientras se oye algún clip, la música baja ese número de decibelios (con una subida y bajada progresivas, no un corte brusco) y vuelve a su volumen normal en los huecos sin clips.

Si el fichero de una pista ya no se encuentra (proyecto movido o pista borrada), la fila lo indica con "Fichero no encontrado" y un enlace **Localizar...**.

## 6. Previsualizar el plan del montaje

La pestaña **Montaje** (junto a **Fuente**, sobre la línea de tiempo) muestra una vista del plan de montaje calculado a partir de los clips y los ajustes actuales: los bloques de cada clip (con su color, nombre y miniatura de fondo si el bloque es lo bastante ancho), las transiciones y las zonas de relleno, repartidos en **carriles horizontales** (o verticales, en salida vertical). Los carriles son **compactos**: en vez de uno por columna del montaje, dos columnas que nunca coinciden en el tiempo comparten el mismo carril, así que solo hay tantos carriles como columnas simultáneas como máximo (normalmente 2–3), y el orden de arriba a abajo sigue en lo posible al de izquierda a derecha (o de arriba abajo, en filas). Sirve para entender qué se va a ver antes de renderizar, sin necesidad de esperar al render. Al hacer clic en un bloque se selecciona su clip (igual que en la lista); arrastrar un bloque lo mueve y lo **fija** en su nuevo instante al soltarlo (§3).

Sobre el plan, donde antes solo había una miniatura del fotograma bajo el cursor, ahora hay una **previsualización en vivo** que se reproduce de verdad (ver §6.1).

### Zoom y desplazamiento horizontal

Por defecto, la vista de la pestaña **Montaje** muestra todo el vídeo ajustado al ancho disponible, como siempre. Para proyectos largos:

- **Ctrl (o Cmd) + rueda del ratón**: acerca o aleja el zoom, centrado en el punto donde está el ratón.
- **Rueda del ratón** o **Mayús + rueda**: desplaza la vista horizontalmente (solo tiene efecto con zoom).
- Botones **−** / **+** / **Ajustar** en la cabecera de la vista: alejar, acercar (centrado en el medio de la vista) y volver a ajustar todo el vídeo al ancho.
- Puedes hacer clic en el eje de tiempo (encima de los carriles) para mover el cursor, igual que en los carriles.
- Con zoom activo, si reproduces (previsualización en vivo) y el cursor de reproducción se sale de la parte visible, la vista se desplaza sola para mantenerlo a la vista.

El nivel de zoom **no se guarda** en el proyecto: siempre se empieza ajustado al ancho al reabrir el proyecto.

### 6.1 Previsualización en vivo

El área donde normalmente se ve el vídeo de la fuente activa se sustituye, en la pestaña **Montaje**, por una previsualización en vivo: reproduce el montaje completo (columnas, transiciones, overlays, música y efectos, con su volumen aproximado) directamente en la ventana, sin generar ningún fichero. Tiene sus propios controles (reproducir/pausar, tiempo, barra de búsqueda) y muestra los fotogramas por segundo que consigue dibujar en este equipo.

Es una **aproximación**: algunas transiciones con geometría (barridos, deslizamientos, círculo...) se ven como un fundido simple, y los volúmenes no están normalizados hasta que una previsualización o un render calculan la sonoridad real de los clips y la música (se avisa mientras tanto). El aviso "Previsualización en vivo aproximada: el render es la referencia" recuerda que el resultado final puede variar ligeramente. Para un resultado exacto (incluidas las transiciones con geometría), usa **Previsualizar el montaje** (§8), que genera un render rápido de verdad.

## 7. Elementos superpuestos: imágenes, cuentas atrás, barras y sonidos

Los **elementos superpuestos** ("overlays") se dibujan o suenan por encima del vídeo final, después del montaje de columnas. Hay cinco tipos:

- **Imagen**: un PNG (con transparencia), con posición y tamaño libres y fundidos de entrada/salida. Al añadirla conserva la proporción real del fichero; si luego cambias la proporción de salida del proyecto (§5), su caja se reajusta para seguir sin deformarse, centrada donde estaba.
- **Texto**: una o varias líneas, con tamaño, interlineado, color, fuente, borde, sombra, alineación, fundidos de entrada/salida y una **animación de entrada** opcional (deslizar desde un lado o efecto máquina de escribir, con su duración).
- **Cuenta atrás**: un número que cuenta hacia 0 y desaparece al llegar; tamaño, color, fuente, borde y sombra configurables.
- **Barra de progreso**: un rectángulo que se rellena o se vacía en una de las cuatro direcciones; puede ir sola o **vinculada** a una cuenta atrás (toma su mismo inicio y duración).
- **Sonido**: un efecto de audio (wav, mp3, m4a, ogg o flac), normalizado igual que los clips.

Se crean, se colocan y se editan desde la pestaña **Montaje**.

### Carriles y añadir un elemento

Debajo de los carriles de columnas de la pestaña **Montaje** hay tres carriles más: **Imágenes**, **Textos, cuentas atrás y barras** y **Sonidos**, con un bloque por elemento en su tiempo. Un clic en cualquier punto de los carriles mueve el **cursor** de la vista (línea roja); los elementos nuevos se añaden ahí.

Los botones **Añadir imagen…**, **Añadir texto**, **Añadir cuenta atrás**, **Añadir barra de progreso** y **Añadir sonido…** crean un elemento con valores por defecto en el cursor. Al añadir una imagen o un sonido se abre un diálogo de fichero filtrado por tipo (PNG para las imágenes; wav/mp3/m4a/ogg/flac para los sonidos).

Al crear un elemento se selecciona automáticamente y se abre su **panel de propiedades** en la barra derecha (en el sitio de la lista de clips; se cierra con la ✕ del panel, haciendo clic en un carril vacío o volviendo a la pestaña **Fuente**).

### Mover, redimensionar y colocar

- **En los carriles**: arrastra un bloque para mover su inicio; arrastra su borde derecho para cambiar su duración (no se puede en los sonidos, que duran lo que dura su fichero). Un bloque no puede empezar antes de 0 s.
- **En la miniatura del fotograma**: los elementos visuales (imagen, cuenta atrás, barra) se ven y se colocan directamente arrastrando su caja y sus tiradores de esquina/lado, igual que el rectángulo de un clip (véase §3). Las imágenes mantienen su proporción al redimensionar (Mayús para liberarla); el resto, al revés.
- Cada arrastre es un solo paso de deshacer.

### Panel de propiedades

Con un elemento seleccionado, el panel de la derecha muestra:

- **Nombre**: editable, como el de los clips.
- **Inicio**: uno de tres modos:
  - **En un instante**: tiempo absoluto del vídeo final.
  - **Anclado a un clip**: elige el clip, el **borde** (inicio o fin) y un **desplazamiento** en segundos (puede ser negativo). El elemento se mueve solo si el montaje recoloca ese clip.
  - **Anclado a un elemento**: igual, pero referido a otro elemento (por ejemplo, un sonido que empieza al **fin** de una cuenta atrás con desplazamiento 0). No se ofrecen anclajes que formarían un ciclo.
- **Posición y tamaño** (imágenes, textos, cuentas atrás y barras): coordenadas y tamaño en % del fotograma, con **presets** de posición (esquinas, centro, pantalla completa); en los textos no se ve "Alto" (sale de las líneas) y "pantalla completa" solo pone el ancho a todo el fotograma, centrado.
- Según el tipo: fundidos de entrada/salida (imágenes y textos); texto multilínea, tamaño, interlineado, alineación, color, fuente, borde, sombra y animación de entrada (ninguna, deslizar + lado, o máquina de escribir, con su duración) para los textos; decimales, ceros a la izquierda, alineación, color, fuente (con botón para elegir un TTF/OTF; una ✕ vuelve a la fuente por defecto), borde y sombra (cuentas atrás); color de relleno y de fondo (con opacidad), borde y dirección/modo (barras; **Vincular a cuenta atrás** sustituye el inicio y la duración propios por los de la cuenta atrás elegida); volumen en dB (sonidos).
- **Estilo** (textos, cuentas atrás y barras): **Aplicar estilo…** aplica un estilo guardado (tamaño, color, fuente, borde, sombra... según el tipo) al elemento; **Guardar estilo…** guarda el estilo actual con un nombre para reutilizarlo en otros elementos o proyectos; **Gestionar estilos…** abre un diálogo para renombrar, borrar, exportar e importar estilos (agrupados por tipo). Los estilos se guardan en los ajustes de la aplicación, no en el proyecto: aplicar uno es un paso de deshacer del proyecto, pero los estilos en sí no se deshacen.
- **Capas**: subir, bajar, traer al frente y enviar al fondo (el último elemento de la lista se ve encima; los sonidos no tienen capa visual, se ordenan aparte).
- **Duplicar** y **eliminar**.

### Ejemplo típico: cuenta atrás con barra y un pitido final

1. **Añadir cuenta atrás**: crea una cuenta atrás de 10 s arriba a la derecha.
2. **Añadir barra de progreso**: crea una barra abajo; en su panel, **Vincular a cuenta atrás** → la cuenta atrás anterior. La barra se rellena (o se vacía, según su modo) exactamente durante esos 10 s.
3. **Añadir sonido…** y elige un pitido corto; en su panel, **Inicio** → **Anclado a un elemento** → la cuenta atrás, **Borde** → **Fin**, **Desplazamiento** → `0`. El pitido sonará justo cuando la cuenta atrás llegue a 0 (para que se oiga entero, el vídeo debe durar al menos hasta ese instante más la duración del pitido).

El formato de la cuenta atrás es automático: si dura **menos de 60 s** se muestra en segundos (`SS`, con los decimales y ceros a la izquierda elegidos); si dura **60 s o más**, se muestra en minutos y segundos (`M:SS`) **durante toda la cuenta**, incluido el último minuto (por ejemplo, una cuenta atrás de 1:15 pasa por `1:15`, `1:00`, `0:59`… hasta `0:01` y desaparece).

El proyecto de ejemplo `script/videomix/renderOverlaysExample.ts` monta los cuatro tipos (esta misma cuenta atrás con su barra, un logo con fundidos anclado al inicio de un clip y un pitido anclado al fin de la cuenta atrás) y comprueba el resultado con ffmpeg.

### Avisos

Un elemento puede mostrar un aviso ▲, tanto en su bloque como en el panel:

- **Fuera del vídeo** / **Parcialmente fuera del vídeo**: su tiempo cae total o parcialmente después del final del montaje; se recorta.
- **Sus anclajes forman un ciclo**, **el clip/elemento al que está anclado ya no existe** o **la cuenta atrás vinculada ya no existe**: el elemento sigue con un tiempo de respaldo (su tiempo actual, en absoluto).
- **Fichero no encontrado**: al abrir un proyecto cuyo PNG, sonido o fuente no se encuentra, aparece un aviso con **Localizar...** para indicar su nueva ubicación (también hay un aviso general al abrir el proyecto si falta algún fichero de este tipo). El botón **Reemplazar…** del panel, para cambiar el fichero de una imagen o un sonido por otro, también hace desaparecer este aviso.

Estos avisos (recortado, fuera del vídeo, ciclo, referencia rota) se repiten, si los hay, en la confirmación previa a previsualizar o renderizar (§8), con la opción de continuar de todos modos.

**Borrar un clip o un elemento** del que dependen otros elementos anclados los convierte en anclaje absoluto (conservan su tiempo actual) y avisa con un mensaje; deshacer restaura también el anclaje.

## 8. Previsualizar y renderizar

Con clips en el proyecto:

- **Previsualizar el montaje** (`Ctrl/Cmd+P`, o **Proyecto → Previsualizar el montaje**, o el botón **Vista previa** de la barra inferior): genera un render rápido a baja resolución (640×360) y lo reproduce en una ventana, con audio. Útil para comprobar el resultado sin esperar el render final.
- **Renderizar el montaje...** (`Ctrl/Cmd+E`, `E`, o **Proyecto → Renderizar el montaje...**, o el botón **Renderizar** de la barra inferior): genera el vídeo final en la resolución, fps y calidad elegidos en los ajustes. Pide dónde guardar el MP4 y muestra el progreso; se puede cancelar en cualquier momento sin dejar ficheros temporales.

Antes de generar el vídeo (previsualización o render final) se muestran los avisos del proyecto si los hay (por ejemplo, un clip que se amplía más de ×2, o huecos que se rellenan porque no hay suficientes clips en ese momento), con la opción de continuar de todos modos.

Mientras se genera el vídeo (render final o previsualización) se muestra una ventana de progreso con:

- la fase en curso: **Analizando la sonoridad del audio** (solo lo que aún no se había medido; suele ser breve) y **Renderizando el vídeo y el audio**;
- una barra de progreso con el porcentaje;
- el tiempo **Transcurrido** desde el inicio y el tiempo **Restante** aproximado. El restante se calcula con la velocidad del render de los últimos segundos, así que al principio pone **Calculando…** (unos segundos) y luego se va afinando; los fragmentos que vienen de la caché (sección 8.1) no cuentan para esa velocidad;
- el botón **Cancelar**, que detiene el render en el momento: no se genera el fichero, se borran los temporales, los fragmentos ya terminados se quedan en la caché para la próxima vez y no aparece ningún error.

La ventana no se cierra con `Esc` ni haciendo clic fuera, para no cancelar un render sin querer: solo con **Cancelar**. El porcentaje sigue apareciendo también en el título de la ventana y en el icono de la barra de tareas.

Al terminar el render aparece un diálogo con la ruta del fichero y un botón para abrir la carpeta.

### 8.1 Caché de render

VideoMix guarda en una carpeta oculta junto al proyecto (`.<nombre>.vmx.cache/`, o en una carpeta temporal de la aplicación mientras el proyecto no se ha guardado) los fragmentos de vídeo y audio ya codificados de renders y previsualizaciones anteriores. Si vuelves a renderizar sin haber cambiado nada relevante (mismo recorte, mismos ajustes, mismos ficheros), esos fragmentos se reutilizan tal cual en vez de volver a codificarlos, lo que acelera mucho los renders repetidos (por ejemplo, tras cambiar solo un elemento superpuesto al final del vídeo). Un cambio que sí afecta a un fragmento (otro recorte, otra transición, otro clip, otro codificador...) simplemente hace que ese fragmento se recodifique; el resto sigue viniendo de la caché.

**Proyecto → Vaciar caché de render** borra toda la caché de render de este proyecto (y la de los proyectos sin guardar que ya no se usan); el próximo render vuelve a codificar todo desde cero. No hace falta usarlo en el uso normal: la caché se recorta ella sola por tamaño (un límite por proyecto; los fragmentos menos usados recientemente se borran primero) y las cachés de proyectos sin guardar y abandonados se limpian solas al cabo de unos días.

En la misma carpeta, `converted/` guarda las versiones convertidas para el reproductor de las fuentes que no se pueden ver directamente (ver la sección 2). No son caché de render: ni el recorte automático por tamaño ni **Vaciar caché de render** las borran (convertir una fuente puede ser lento). Si se quiere liberar ese espacio, se puede borrar la carpeta `converted/` a mano con el proyecto cerrado; se vuelven a crear la próxima vez que se active cada fuente.

## 9. Atajos de teclado

Puedes ver y personalizar todos los atajos en **Ayuda → Atajos de teclado y ratón** (`Mayús+/`).

**Los atajos funcionan con el foco en cualquier sitio**, por ejemplo justo después de hacer clic en un botón, salvo:

- mientras escribes en un **campo de texto o número**, o dentro de un **diálogo o menú** abierto (que usan sus propias teclas);
- en un **desplegable** (`select`), las teclas normales quedan para elegir una opción, pero las combinaciones con **Ctrl/Cmd** (como `Ctrl/Cmd+Z`) sí llegan a los atajos, así que puedes deshacer justo después de elegir una opción sin tener que hacer clic fuera antes;
- si el foco está en un **botón** (o en otro control activable, como una casilla), **Espacio** e **Intro** activan ese control en vez de disparar el atajo que tuvieran asignado; el resto de atajos (incluido deshacer) sigue funcionando con normalidad.

Cada acción de edición (mover un clip en la vista Montaje, fijarlo, cambiar un rectángulo, un keyframe, un ajuste...) queda como un único paso de deshacer, sin importar dónde estuviera el foco al hacerla.

Los más importantes:

| Acción | Atajo |
|---|---|
| Reproducir / pausar | `Espacio` |
| Fotograma anterior / siguiente | `,` / `.` |
| Retroceder / avanzar | `←` / `→` |
| Marcar inicio / marcar fin del clip | `I` / `O` |
| Nuevo clip desde aquí (aunque el cursor esté dentro de otro clip) | `Mayús+I` |
| Añadir clip | `N` |
| Dividir clip en el cursor | `B` |
| Quitar punto de corte (elimina el clip) | `Retroceso` |
| Duplicar / eliminar clip seleccionado | `Ctrl/Cmd+D` / `Supr` |
| Girar el clip seleccionado +90° / −90° / 180° | `R` / `Mayús+R` / `Alt+R` |
| Copiar / pegar el encuadre del clip seleccionado | `Ctrl/Cmd+Mayús+C` / `Ctrl/Cmd+Mayús+V` |
| Keyframe de encuadre anterior / siguiente / borrar el del cursor | `Mayús+,` / `Mayús+.` / `Mayús+Retroceso` |
| Ir al clip anterior / siguiente | `↑` / `↓` |
| Ir al primer / último clip | `Av Pág` / `Re Pág` |
| Deshacer / rehacer | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` |
| Nuevo / abrir / guardar / guardar como proyecto | — / — / `Ctrl/Cmd+S` / `Ctrl/Cmd+Shift+S` |
| Renombrar el clip actual | `Intro` |
| Capturar fotograma / al portapapeles | `C` / `Mayús+C` |
| Silenciar / subir / bajar volumen | `M` / `Alt+↑` / `Alt+↓` |
| Zoom de la línea de tiempo | `Ctrl+↑` / `Ctrl+↓` |
| Pantalla completa | `F` |
| Ajustes de montaje | `Ctrl/Cmd+Shift+M` |
| Previsualizar el montaje | `Ctrl/Cmd+P` |
| Renderizar el montaje | `Ctrl/Cmd+E` (o `E`) |

Si tenías una configuración de teclado de una versión anterior, los atajos nuevos pueden no aparecer hasta que restablezcas los atajos (botón "Restablecer" en el diálogo de atajos).

Las acciones más nuevas (añadir texto, fijar/agrupar clips, aplicar/guardar estilo, vaciar la caché de render) no tienen atajo de teclado por defecto: se usan desde su botón, su menú contextual o el menú **Proyecto**; sí se pueden personalizar en el diálogo de atajos si se quiere.

## 10. Otros ajustes

En **Ajustes** (`Ctrl/Cmd+,`) se mantienen las opciones generales de reproducción, captura de fotogramas, atajos de teclado y ratón, interfaz y notificaciones. Las opciones específicas de exportación de LosslessCut (formatos, pistas, corte sin pérdidas...) no aplican a VideoMix y no aparecen.

El tamaño máximo de la caché de render (§8.1, 5 GB por defecto; `0` la desactiva) no tiene control en la interfaz: se cambia editando `renderCacheMaxBytes` en el fichero de configuración (**Ayuda → Fichero de configuración**).
