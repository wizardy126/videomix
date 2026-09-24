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

### Recortar en espacio: rectángulos máximo y mínimo

Con un clip seleccionado, sobre el vídeo aparece un overlay con su rectángulo:

- **Máx.**: la zona máxima de la fuente que puede llegar a mostrarse.
- **Mín.** (opcional): la zona que siempre debe verse, contenida en el máx. Si no se define, el montaje solo puede recortar hasta el máx. (mín. = máx.).

Arrastra los tiradores de las esquinas y los lados para redimensionar, o el interior para mover. Con el rectángulo seleccionado (haz clic sobre él), las flechas del teclado lo desplazan 2 px (10 px con Mayús).

La barra de herramientas sobre el vídeo permite:

- fijar una **proporción** para el máx. (Libre, 9:16, 3:4, 1:1, 4:3, 16:9);
- **Mín. = Máx.** (quita el mínimo) / **Añadir mín.**;
- **Rellenar fotograma** (el máx. vuelve a ocupar todo el vídeo).

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

## 4. Orden de los clips

El orden de la lista de clips es la base del montaje, pero el algoritmo puede reordenar para encajar los tamaños de columna, dentro de una "ventana de reordenación" configurable: un número de posiciones (sin tope práctico; 3 por defecto) o **Ilimitado**, que permite traer clips de cualquier punto del proyecto para rellenar los huecos. Aun así, entre opciones igual de buenas se sigue prefiriendo el orden de la lista. También existe un **orden aleatorio** reproducible (con una semilla guardada en el proyecto y un botón para "barajar de nuevo"); se elige en Ajustes de montaje.

## 5. Ajustes de montaje

Se abren con **Proyecto → Ajustes de montaje...** (`Ctrl/Cmd+Shift+M`) o el botón **Ajustes** de la barra inferior:

| Sección | Ajustes |
|---|---|
| **Salida** | **proporción** (16:9 horizontal con clips lado a lado, 9:16 vertical con clips apilados, 1:1 cuadrado — el montaje elige lado a lado o apilados, lo que mejor encaje), resolución (lado corto: 720p / 1080p / 4K), fotogramas por segundo, calidad (CRF), preset de velocidad, **códec de vídeo** (H.264 / H.265-HEVC) y **codificador** (Automático, Solo software, o uno de hardware — NVIDIA NVENC, Intel Quick Sync, Apple VideoToolbox, VAAPI — marcado como detectado o no según el equipo) |
| **Composición** | máximo de columnas o filas visibles (1–6, según la proporción), separación entre columnas o filas en px (y su color), relleno del hueco (desenfoque o color sólido) |
| **Orden** | orden de la lista o aleatorio (con semilla y "barajar de nuevo"), ventana de reordenación (número de posiciones o casilla "Ilimitado") |
| **Transición** | tipo (fundido, disolución, barridos, deslizamientos...) y duración; fundido de entrada/salida al principio y final del vídeo |
| **Música** | **lista de reproducción** de varias pistas (añadir, reordenar, quitar, volumen por pista), fundido cruzado entre pistas, repetir la lista si es más corta que el vídeo y **ducking** (bajar automáticamente la música mientras se oye algún clip) — ver §5.1 |

Cada cambio se guarda en el historial (se puede deshacer) y marca el proyecto como modificado. Cambiar la **proporción** de salida reajusta además, para conservar su forma sin deformarla, la caja de cualquier imagen superpuesta cuyo fichero se pueda volver a leer en ese momento (véase §7).

En 1:1 el montaje decide, proyecto a proyecto, si sale mejor en columnas o en filas (según el tipo de clips); no hay un selector manual de eje.

### 5.1 Música: lista de reproducción y *ducking*

Al soltar o añadir un fichero de audio se pregunta si se usa como música del proyecto (o se añade al final de la lista si ya había alguna). En la sección **Música** de los ajustes:

- **Lista de pistas**: arrastra el asa para reordenarlas, edita el volumen de cada una (−30…+6 dB) y quítalas con su botón; **Añadir ficheros de música…** admite selección múltiple.
- **Fundido cruzado entre pistas**: 0–10 s; cada pista empieza ese tiempo antes de que termine la anterior.
- **Repetir la lista si es más corta que el vídeo**: si no, la música termina y el resto del vídeo queda sin música.
- ***Ducking***: interruptor y cantidad (−30…−3 dB); mientras se oye algún clip, la música baja ese número de decibelios (con una subida y bajada progresivas, no un corte brusco) y vuelve a su volumen normal en los huecos sin clips.

Si el fichero de una pista ya no se encuentra (proyecto movido o pista borrada), la fila lo indica con "Fichero no encontrado" y un enlace **Localizar...**.

## 6. Previsualizar el plan del montaje

La pestaña **Montaje** (junto a **Fuente**, sobre la línea de tiempo) muestra una vista del plan de montaje calculado a partir de los clips y los ajustes actuales: un carril por columna (o por fila, en salida vertical) con los bloques de cada clip (con su color, nombre y miniatura de fondo si el bloque es lo bastante ancho), las transiciones y las zonas de relleno. Sirve para entender qué se va a ver antes de renderizar, sin necesidad de esperar al render. Al hacer clic en un bloque se selecciona su clip (igual que en la lista); arrastrar un bloque lo mueve y lo **fija** en su nuevo instante al soltarlo (§3).

Sobre el plan, donde antes solo había una miniatura del fotograma bajo el cursor, ahora hay una **previsualización en vivo** que se reproduce de verdad (ver §6.1).

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

Al terminar el render aparece un diálogo con la ruta del fichero y un botón para abrir la carpeta.

### 8.1 Caché de render

VideoMix guarda en una carpeta oculta junto al proyecto (`.<nombre>.vmx.cache/`, o en una carpeta temporal de la aplicación mientras el proyecto no se ha guardado) los fragmentos de vídeo y audio ya codificados de renders y previsualizaciones anteriores. Si vuelves a renderizar sin haber cambiado nada relevante (mismo recorte, mismos ajustes, mismos ficheros), esos fragmentos se reutilizan tal cual en vez de volver a codificarlos, lo que acelera mucho los renders repetidos (por ejemplo, tras cambiar solo un elemento superpuesto al final del vídeo). Un cambio que sí afecta a un fragmento (otro recorte, otra transición, otro clip, otro codificador...) simplemente hace que ese fragmento se recodifique; el resto sigue viniendo de la caché.

**Proyecto → Vaciar caché de render** borra toda la caché de render de este proyecto (y la de los proyectos sin guardar que ya no se usan); el próximo render vuelve a codificar todo desde cero. No hace falta usarlo en el uso normal: la caché se recorta ella sola por tamaño (un límite por proyecto; los fragmentos menos usados recientemente se borran primero) y las cachés de proyectos sin guardar y abandonados se limpian solas al cabo de unos días.

## 9. Atajos de teclado

Puedes ver y personalizar todos los atajos en **Ayuda → Atajos de teclado y ratón** (`Mayús+/`). Los más importantes:

| Acción | Atajo |
|---|---|
| Reproducir / pausar | `Espacio` |
| Fotograma anterior / siguiente | `,` / `.` |
| Retroceder / avanzar | `←` / `→` |
| Marcar inicio / marcar fin del clip | `I` / `O` |
| Añadir clip | `N` |
| Dividir clip en el cursor | `B` |
| Quitar punto de corte (elimina el clip) | `Retroceso` |
| Duplicar / eliminar clip seleccionado | `Ctrl/Cmd+D` / `Supr` |
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
