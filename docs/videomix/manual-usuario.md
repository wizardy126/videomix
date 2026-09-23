# Manual de usuario de VideoMix

VideoMix crea un vídeo final 16:9 combinando fragmentos ("clips") de varios vídeos, mostrados uno junto a otro en columnas. Este manual cubre el flujo completo: crear un proyecto, añadir fuentes, definir clips, ajustar el montaje, previsualizar, renderizar y la música de fondo.

## 1. Crear un proyecto

Al abrir VideoMix se crea automáticamente un proyecto sin título ("Proyecto sin título"). Un proyecto se guarda en un fichero `.vmx` (JSON) que contiene las fuentes, los clips y los ajustes de montaje.

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

### La lista de clips

El panel derecho lista **todos** los clips del proyecto, de cualquier fuente, en el orden en que se montarán (reordenable arrastrando el asa `⋮⋮`). Por cada clip se puede:

- cambiar su **nombre** (clic sobre el nombre, escribe y pulsa Intro);
- cambiar su **color** (clic en el número de la fila);
- **silenciar** su audio o ajustar su **ganancia** (−20…+20 dB);
- ver su **duración** y avisos (clip muy corto, sin mínimo definido, etc.);
- con el menú contextual (clic derecho): duplicar, eliminar o ir a su fuente.

Al hacer clic en un clip de otra fuente, esa fuente se activa automáticamente y el reproductor salta a su inicio.

Deshacer/rehacer (`Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z`) cubre todas las ediciones del proyecto: fuentes, clips, rectángulos y ajustes.

## 4. Orden de los clips

El orden de la lista de clips es la base del montaje, pero el algoritmo puede reordenar ligeramente para encajar los tamaños de columna (dentro de una "ventana de reordenación" configurable). También existe un **orden aleatorio** reproducible (con una semilla guardada en el proyecto y un botón para "barajar de nuevo"); se elige en Ajustes de montaje.

## 5. Ajustes de montaje

Se abren con **Proyecto → Ajustes de montaje...** (`Ctrl/Cmd+Shift+M`) o el botón **Ajustes** de la barra inferior:

| Sección | Ajustes |
|---|---|
| **Salida** | resolución (720p / 1080p / 4K), fotogramas por segundo, calidad (CRF) y preset de velocidad de codificación |
| **Composición** | máximo de columnas visibles (1–6), separación entre columnas en px (y su color), relleno del hueco (desenfoque o color sólido) |
| **Orden** | orden de la lista o aleatorio (con semilla y "barajar de nuevo"), ventana de reordenación |
| **Transición** | tipo (fundido, disolución, barridos, deslizamientos...) y duración; fundido de entrada/salida al principio y final del vídeo |
| **Música** | elegir o quitar el fichero, volumen en dB y repetir en bucle si es más corta que el vídeo |

Cada cambio se guarda en el historial (se puede deshacer) y marca el proyecto como modificado.

## 6. Previsualizar el plan del montaje

La pestaña **Montaje** (junto a **Fuente**, sobre la línea de tiempo) muestra una vista del plan de montaje calculado a partir de los clips y los ajustes actuales: un carril por columna con los bloques de cada clip (con su color y nombre), las transiciones, las zonas de relleno y una miniatura del fotograma en el instante bajo el cursor. Sirve para entender qué se va a ver antes de renderizar, sin necesidad de esperar al render. Al hacer clic en un bloque se selecciona su clip (igual que en la lista).

## 7. Previsualizar y renderizar

Con clips en el proyecto:

- **Previsualizar el montaje** (`Ctrl/Cmd+P`, o **Proyecto → Previsualizar el montaje**, o el botón **Vista previa** de la barra inferior): genera un render rápido a baja resolución (640×360) y lo reproduce en una ventana, con audio. Útil para comprobar el resultado sin esperar el render final.
- **Renderizar el montaje...** (`Ctrl/Cmd+E`, `E`, o **Proyecto → Renderizar el montaje...**, o el botón **Renderizar** de la barra inferior): genera el vídeo final en la resolución, fps y calidad elegidos en los ajustes. Pide dónde guardar el MP4 y muestra el progreso; se puede cancelar en cualquier momento sin dejar ficheros temporales.

Antes de generar el vídeo (previsualización o render final) se muestran los avisos del proyecto si los hay (por ejemplo, un clip que se amplía más de ×2, o huecos que se rellenan porque no hay suficientes clips en ese momento), con la opción de continuar de todos modos.

Al terminar el render aparece un diálogo con la ruta del fichero y un botón para abrir la carpeta.

## 8. Atajos de teclado

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

## 9. Otros ajustes

En **Ajustes** (`Ctrl/Cmd+,`) se mantienen las opciones generales de reproducción, captura de fotogramas, atajos de teclado y ratón, interfaz y notificaciones. Las opciones específicas de exportación de LosslessCut (formatos, pistas, corte sin pérdidas...) no aplican a VideoMix y no aparecen.
