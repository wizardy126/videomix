# 01 · Requisitos

Este documento recoge los requisitos originales del proyecto y todas las decisiones cerradas con el usuario en la fase de análisis. Ante cualquier duda de interpretación, **este documento manda** sobre el resto; si algo no está aquí, se pregunta antes de asumir.

## 1. Objetivo

Crear proyectos de vídeo a partir de trozos de vídeos. El usuario define *clips* (recortes en tiempo y en espacio) de uno o varios vídeos y la aplicación monta automáticamente un vídeo final 16:9 en el que se ven varios clips a la vez, uno al lado del otro.

## 2. Requisitos originales

1. Recortar fragmentos no solo en tiempo (como ya permite LosslessCut) sino también en espacio: definir un rectángulo a recortar dentro del fotograma.
2. Ir creando *clips* con los recortes (tiempo + rectángulo visible).
3. Los clips se guardan como **definición**, no como vídeos exportados.
4. Un proyecto permite crear clips desde **múltiples vídeos** a la vez.
5. Una vez definidos los clips, el vídeo final se monta **automáticamente**.
6. El vídeo final contiene **todos** los clips, encajando los recortes para formar un fotograma completo de la resolución elegida (16:9).
7. Nunca se apilan vídeos uno encima de otro (ver §4.1).
8. En los recortes de pantalla se define un tamaño **máximo** y uno **mínimo**; el montaje puede recortar entre ambos para que los vídeos encajen formando un fotograma completo.
9. La transición entre vídeos es suave pero rápida; **tiempo y tipo parametrizables, globales** para el proyecto.
10. Se escucha el sonido de todos los vídeos visibles a la vez, **equilibrando el volumen** para que ninguno destaque.
11. Opcionalmente, una pista de audio (mp3, m4a o similar) que se mezcla con la de los vídeos, con volumen ajustable de forma independiente.

## 3. Producto

| # | Decisión |
|---|---|
| P1 | La aplicación **se convierte en VideoMix** de forma gradual: se reutiliza la infraestructura de LosslessCut y se oculta/retira la UI que no aplica. |
| P2 | La compatibilidad con el upstream **no es prioritaria**, pero el código nuevo se aísla en `src/renderer/src/videomix/` (y equivalentes en main/common) tocando lo mínimo del código existente. |
| P3 | Identidad: `productName` **VideoMix**, `appId` **`net.wizardy.videomix`**, directorio de configuración propio (no debe chocar con un LosslessCut instalado). |
| P4 | CI: se desactiva `build.yml` (publicación, App Store, builds diarios); se mantiene `test.yml`. Empaquetado multiplataforma al final del proyecto. |
| P5 | UI: textos nuevos con clave en inglés (como el as-built) y traducción al **español** mantenida. El resto de idiomas cae a inglés. |
| P6 | Documentación de `docs/videomix` en **español**. Código, comentarios y mensajes de commit en **inglés**. |
| P7 | Licencia: GPL-2.0 (obligatorio por ser obra derivada). |

## 4. Montaje del vídeo final

### 4.1 Layout espacial

- El fotograma final es **siempre una sola fila de columnas**. Cada clip visible ocupa la **altura completa** del fotograma; los anchos de las columnas (más la separación, si la hay) suman el ancho total.
- Nunca se colocan vídeos uno encima de otro.
- Un solo clip puede llenar el fotograma entero.
- Se pueden mostrar tantos clips como encajen, con un **máximo configurable de columnas visibles (por defecto 3)**. Lo habitual serán 2–3.
- El **número de columnas es variable** a lo largo del vídeo (entre 1 y el máximo).
- **Separación entre columnas** configurable (grosor en px y color); por defecto 0.

### 4.2 Rectángulos máx./mín.

- **Máx.**: zona máxima de la fuente que puede mostrarse.
- **Mín.**: zona que siempre debe verse; está contenida en el máx. Es **opcional**: si no se define, mín = máx (no se puede recortar más).
- El montaje elige, para cada clip y columna, un recorte que **contenga el mín., esté dentro del máx. y tenga la proporción de la columna**.
- El rectángulo es **fijo durante todo el clip** en v1 (sin keyframes ni paneo).
- **Orientación** (informativa y para el algoritmo): automática según el rectángulo máx.; ancho/alto > 1 → horizontal, ≤ 1 → vertical.
- **Escalado**: se permite ampliar lo necesario; la UI avisa si un clip queda ampliado **más de ×2**.
- Si no se puede llenar el espacio (ni recortando hasta el mín.), el hueco se rellena con **fondo desenfocado** (configurable a color sólido).

### 4.3 Modelo temporal: slots continuos

- La pantalla se divide en columnas (slots). **Cuando un clip termina, empieza otro en su mismo espacio.**
- **Un clip nunca se corta en tiempo**: se reproduce entero.
- Lo habitual es que siempre haya algún clip "a medias" cuando otro empieza (los cambios de las columnas no están sincronizados).
- **Inicio**: todas las columnas iniciales arrancan a la vez.
- **Final**: según van terminando los clips y no quedan más, los huecos se rellenan con fondo (no se re-expande).
- Clip entrante: el algoritmo elige, dentro de la ventana de reorden, un clip que **encaje en el ancho del hueco** liberado. Si ninguno encaja, hace un **re-layout** de toda la fila: los clips en curso siguen reproduciéndose y solo cambia su recorte/ancho.
- El re-layout se ve como una **animación suave** de los anchos, con la misma duración que la transición global.
- **Prioridad del relleno** (decidido tras T10): si la fila tiene relleno y un re-layout con otro clip lo elimina, se prefiere el re-layout aunque haya un clip que encaje exactamente en el hueco liberado.
- **Columnas frente a pantalla completa** (decidido tras T10), criterio **equilibrado**: se prefieren 2–3 columnas, recortando los horizontales flexibles hacia su mín., pero se acepta un clip a pantalla completa si para meter más columnas habría que perder mucho de su máx.
- **Columna nueva en un re-layout**: aparece creciendo desde ancho 0 y su clip entra con esa animación, sin transición adicional.
- **Final del vídeo**: cuando un clip termina y ya no quedan clips, hace un **fundido** con la transición global hacia el relleno.

### 4.4 Orden

- La base es el **orden de la lista de clips** (reordenable con drag & drop).
- El algoritmo puede reordenar para encajar los tamaños, pero solo dentro de una **ventana limitada** (±N posiciones, configurable; por defecto 3).
- **Modo aleatorio** opcional (reproducible: semilla guardada en el proyecto, con acción para "barajar de nuevo").

### 4.5 Transiciones

- Tipo y duración **globales** del proyecto. Duración por defecto **0,5 s**.
- Tipos disponibles (selección de `xfade` de ffmpeg): `fade`, `dissolve`, `fadeblack`, `wipeleft`, `wiperight`, `wipeup`, `wipedown`, `slideleft`, `slideright`, `slideup`, `slidedown`, `smoothleft`, `smoothright`, `smoothup`, `smoothdown`, `circleopen`.
- La transición se aplica cuando un clip sustituye a otro en su columna. El audio hace crossfade con la misma duración.
- **Fade desde/hacia negro** al inicio y al final del vídeo (vídeo y audio): opcional, **activado por defecto**.

### 4.6 Previsualización

- **Timeline del montaje**: vista del plan (qué clip en qué columna y cuándo, con miniaturas).
- **Render de previsualización** rápido a baja resolución.
- Los ajustes manuales sobre el plan quedan para una versión posterior.

## 5. Audio

- Se oye el audio de **todos los clips visibles**.
- **Equilibrado**: normalización de sonoridad **EBU R128 (`loudnorm`) en dos pasadas**, con objetivo **−16 LUFS** (decidido por el usuario). El análisis de cada clip se hace antes y se cachea. Después se mezcla compensando el número de fuentes simultáneas. Los clips sin audio no aportan nada.
- **Por clip**: se puede **silenciar** y aplicar **ganancia** (±dB) además del equilibrado automático.
- **Pista de música**: **una**, opcional (mp3, m4a, aac, wav, flac, ogg, opus…), con volumen independiente. **Se normaliza** a −16 LUFS igual que los clips, y el volumen es relativo a eso (0 dB = tan fuerte como los clips); por defecto −12 dB (decidido tras T12).
  - Si es más corta que el vídeo: **loop opcional** (si está desactivado, termina y queda el audio de los clips).
  - Si es más larga: se corta al final con **fade-out**.
  - Sin ducking en v1.

## 6. Salida

| Ajuste | Valores |
|---|---|
| Resolución | 1280×720, **1920×1080** (defecto), 3840×2160 |
| FPS | 24, 25, **30** (defecto), 50, 60; las fuentes se convierten al fps elegido |
| Formato | MP4, H.264 (`libx264`) + AAC |
| Calidad | CRF y preset configurables |
| Futuro | H.265, encoders por hardware |

## 7. Proyecto y clips

- Proyecto en fichero propio **`.vmx`** (JSON5 validado con zod y versionado).
  - Guarda las fuentes (ruta relativa al proyecto + absoluta de respaldo), los clips y los ajustes.
- **Guardado explícito** (Guardar / Guardar como) más **autoguardado de recuperación**.
- **UI**:
  - A la izquierda, las **fuentes** del proyecto.
  - En el centro, el **player y el timeline** de la fuente activa; ahí se marcan el tiempo y los rectángulos.
  - A la derecha, **todos los clips** del proyecto, de cualquier fuente.
- **Clip**: tiene **nombre editable** (por defecto `<fuente> #n`) y **color**. Las notas quedan para más adelante.
- **Undo/redo** sobre las ediciones del proyecto.

## 8. Proceso

| # | Decisión |
|---|---|
| W1 | Todo se desarrolla en la rama `claude/videomix-analysis-planning-97c8lp`, con un commit por tarea revisada. **Sin PR** hasta que el usuario la pida. |
| W2 | Commits con **Conventional Commits**, en inglés, cortos y descriptivos. **Prohibido incluir atribuciones** (`Co-Authored-By`, etc.). |
| W3 | Validación con ffmpeg real y vídeos sintéticos. **No se para entre hitos**: el usuario revisa la UI cuando pueda. |
| W4 | Definición de hecho: `tsc` + `lint` + `test` en verde. Tests unitarios obligatorios para el planificador/layout y para el generador del grafo ffmpeg. |

## 9. Elementos superpuestos (overlays)

Añadido tras la v1. Son capas que se dibujan o suenan **encima del vídeo final**, después del montaje automático de columnas.

### 9.1 Tipos

- **Imagen PNG** (con transparencia):
  - posición y tamaño libres, en % del fotograma para que valgan en cualquier resolución, con presets (esquinas, centro, pantalla completa);
  - *fade* de entrada y de salida configurables.
- **Contador de cuenta atrás**:
  - cuenta desde su duración hasta 0 mientras está visible y, al llegar a 0, **desaparece** (con *fade* opcional);
  - formato **automático**: `SS` si el contador dura menos de 60 s y `M:SS` si dura 60 s o más, en cuyo caso se mantiene durante toda la cuenta (`1:00` → `0:59`…); con **0–3 decimales** y ceros a la izquierda opcionales;
  - redondeo hacia arriba a la precisión elegida;
  - tamaño, color, **fuente** (fichero TTF/OTF, con una fuente libre incluida por defecto), **borde y sombra** configurables;
  - posición como las imágenes.
- **Barra de progreso**:
  - rectángulo con posición y tamaño libres;
  - color de relleno y de fondo, borde opcional;
  - dirección (izq→der, der→izq, abajo→arriba, arriba→abajo);
  - se rellena o se vacía de forma animada durante su duración;
  - puede ir sola o vinculada a un contador (mismo inicio y duración).
- **Efecto de sonido**:
  - fichero de audio;
  - **normalizado a −16 LUFS** más un ajuste en dB por efecto (0 dB = tan fuerte como los clips);
  - no cuenta en la compensación de simultaneidad;
  - sin *ducking*.

### 9.2 Tiempo y anclaje

- Cada elemento tiene inicio y duración. Los efectos de sonido duran lo que dure el fichero.
- El inicio puede ser:
  - **absoluto**: tiempo del vídeo final;
  - **anclado a un clip**: inicio o fin del clip ± desplazamiento. Se mueve solo si el montaje recoloca el clip;
  - **anclado a otro elemento**: inicio o fin de otro elemento ± desplazamiento. Por ejemplo, un sonido al terminar un contador.
- Una barra "vinculada a un contador" toma el inicio y la duración del contador.
- Se detectan los ciclos. Si el clip o el elemento de referencia se borra, el elemento pasa a tiempo absoluto (con su tiempo actual) y se muestra un aviso.
- Lo que caiga fuera de la duración del vídeo se recorta, con aviso.
- **Orden de capas**: el último elemento de la lista va encima, con acciones de subir y bajar.

### 9.3 Edición

- Tres pistas extra en la vista **"Mix"**: Imágenes, Contadores y barras, y Sonidos. Los bloques se arrastran y se redimensionan.
- **Panel de propiedades** del elemento seleccionado.
- La mini vista del fotograma muestra y permite colocar los elementos visuales.
- Los recursos son **ficheros del usuario**, guardados en el `.vmx` con ruta relativa y absoluta, como las fuentes. Un elemento se puede duplicar.
- La previsualización y el render incluyen todos los elementos.

## 10. Mejoras v2 (elegidas por el usuario)

| ID | Mejora | Decisiones |
|---|---|---|
| A1 | **Previsualización en vivo aproximada** | En el área del player al activar la pestaña Mix. Columnas o filas, re-layouts, overlays y transiciones simples en tiempo real, **con audio** a volúmenes aproximados. El render sigue siendo la referencia exacta. |
| A2 | **Miniaturas** en la lista de clips y en la vista Mix | Fotograma de inicio recortado al máx., cacheado y regenerado al cambiar el inicio o el rectángulo. |
| A4 | **Ajustes manuales del plan** | **Fijar un clip a un momento** del vídeo final (el algoritmo organiza el resto alrededor) y **agrupar clips** para que empiecen juntos. |
| B1 | **Textos libres** | **Varias líneas y alineación**, borde y sombra, *fades* y **animación de entrada** (deslizar desde un lado o escribir letra a letra). Mismo sistema de anclajes y posición que el resto de overlays. |
| B2 | **Estilos reutilizables** (presets) | Para textos, contadores y barras. **Globales de la app**, con exportar e importar a fichero. |
| B5 | **Salida vertical 9:16 y cuadrada 1:1** | En 9:16 se traspone la regla: **una sola columna de filas a ancho completo**, nunca lado a lado. En 1:1, filas o columnas, lo que encaje mejor. Resoluciones: 9:16 → 720×1280, 1080×1920 y 2160×3840; 1:1 → 720, 1080 y 2160. |
| C1 | **Ducking de la música** | La música baja cuando los clips suenan y sube en los silencios. Cantidad configurable (−10 dB por defecto), con ataque y relajación suaves. Se activa por proyecto. |
| C2 | **Varias pistas de música** | Lista ordenada (arrastrar y soltar), volumen en dB por pista, **crossfade** entre pistas (2 s por defecto) y opción de **repetir la lista**. Se corta con *fade* al final del vídeo. Cada pista se normaliza a −16 LUFS. |
| D1 | **Render incremental** | Los bloques ya renderizados se cachean en una **carpeta oculta junto al `.vmx`** y persisten entre sesiones; solo se rehacen los bloques afectados por un cambio. |
| D2 | **Codificación por hardware y H.265** | Detección automática de NVENC, QSV, VideoToolbox y VAAPI, con x264/x265 como respaldo y selección manual en los ajustes. Salida en H.264 o H.265. |
| E3 | **Tests end-to-end de la UI** | Playwright + Electron, ejecutados en local (no en CI). |

## 11. Mejoras v3 y correcciones (decididas con el usuario)

| ID | Mejora | Decisiones |
|---|---|---|
| E1 | **Contador de duración al marcar** | Con un inicio marcado sin fin, se muestra la duración inicio → cursor **junto al cursor en el timeline** y **en la barra inferior**. Con un clip seleccionado se muestra también su duración y cómo quedaría si el fin fuera el cursor. |
| E2 | **Clips enlazados automáticamente** | Dos clips de la **misma fuente** se enlazan si el inicio del segundo está como mucho **N s después del fin del primero** (N configurable, 10 por defecto; 0 = desactivado). Se encadenan por tiempo de la fuente. Los clips que **se solapan no se enlazan automáticamente**: E6 los crea a propósito (duplicar, "nuevo clip desde aquí") para encuadrar el mismo metraje de otra forma, y encadenarlos repetiría contenido. Una cadena ocupa **el mismo hueco** (columna o fila): un clip detrás de otro, con **corte directo** por defecto o transición global (ajuste del proyecto). Si las proporciones no encajan, el hueco se reajusta con la animación normal. Se puede **romper** un enlace concreto o **forzar** uno (incluso entre solapados, o con N = 0) desde la lista de clips, que muestra un indicador de cadena. |
| E3 | **Duración estimada siempre visible** | "≈ m:ss" en la barra inferior, junto a Ajustes, Vista previa y Renderizar, en ambas pestañas. Se calcula con el planificador real, con un pequeño retardo. |
| E4 | **Duración máxima del vídeo** | Ajuste del proyecto (desactivado por defecto). Si el montaje dura más, se **corta en el límite con el *fade* de salida global** (vídeo y audio), con aviso antes de renderizar y el indicador de E3 resaltado. Con límite, el planificador **favorece más columnas** para que quepa más contenido antes del corte. |
| E5 | **Secuencia siempre visible** | **Una por proyecto**: una lista ordenada de clips, que salen del reparto normal. En todo momento hay uno de ellos en pantalla, en un **hueco propio cuya posición decide el algoritmo** (se puede mover en los re-layouts). El resto se llena con los demás clips. **El vídeo dura lo que dure lo más largo**: si la secuencia acaba antes, su hueco se usa con normalidad; si acaba después, sigue hasta terminar. |
| E6 | **Clips solapados** | Ya era posible duplicando (Ctrl+D) y cambiando tiempos y rectángulos. Se añade la acción **"Nuevo clip desde aquí"**: pone un inicio nuevo en el cursor aunque esté dentro de otro clip, y "Marcar fin" lo cierra como clip nuevo. Tiene atajo propio y botón en la barra inferior. |
| E7 | **Ampliar más allá del máx. para evitar relleno** | Opción **por clip, activa por defecto**. **Último recurso**: solo cuando, respetando los máx., quedaría relleno en una disposición normal (no al final del vídeo, que sigue igual). El recorte se amplía en el eje principal (ancho en 16:9 y 1:1 en columnas; alto en vertical o filas) **por ambos lados, centrado en el máx.**; si a un lado no hay material, se amplía más por el otro. Con varios clips ampliables, el ancho extra se reparte **en proporción al material disponible** de cada uno. También evita pillarbox o letterbox cuando hay material. Los casos se **avisan en la vista Mix**. |
| E8 | **Ventana de reorden ilimitada y ampliable** | En los ajustes del proyecto, la ventana de reorden pasa de una barra (0–10) a un **campo numérico sin tope práctico**, más una opción **"Ilimitado"**: el algoritmo puede traer clips de cualquier punto del proyecto para rellenar los huecos. Aun así, entre opciones igual de buenas se sigue prefiriendo el orden de la lista. |
| E9 | **Girar un clip** | Giro **por clip**: 0, +90, −90 o 180°. Los rectángulos máx./mín. se editan **sobre la imagen ya girada**: con el clip seleccionado, el reproductor muestra la imagen girada. Al cambiar el giro, los rectángulos giran con la imagen para conservar el encuadre. La orientación (horizontal o vertical), el planificador, el render, la previsualización en vivo y las miniaturas usan el fotograma girado. |
| B1 | **Bug: fuentes con píxeles no cuadrados (SAR ≠ 1)** | Todo trabaja en **píxeles de visualización**. El tamaño de la fuente se guarda aplicando SAR y rotación, y en ffmpeg el rectángulo se convierte a píxeles codificados en el `crop` (sin reescalar el fotograma). Miniaturas y render coherentes con el editor. |
| B2 | **Bug: re-vincular una fuente a otra resolución** | Los rectángulos de sus clips se **escalan proporcionalmente**. Si cambia la proporción, además se ajustan al fotograma y se avisa. |

## 12. Mejoras v4 (decididas con el usuario)

Además, en M10 (sin ID): **modal de progreso del render** (fase, barra, transcurrido, restante aproximado, Cancelar) y **vídeos convertidos para el reproductor** (html5ify) guardados en la caché del proyecto (`.<nombre>.vmx.cache/converted/`) cuando el proyecto está guardado.

| ID | Mejora | Decisiones |
|---|---|---|
| F1 | **Indicador de encaje en fracciones** | Al editar los rectángulos se ve **en tiempo real** en qué fracciones del eje principal de la salida encaja el clip: **1/3, 1/2, 2/3 y completo** (teniendo en cuenta proporción de salida, separación entre columnas y el rango de anchos que dan máx. y mín.; en filas, fracciones del alto). Se muestran como **chips** con tres estados: ✓ encaja; **↔ encaja ampliando** (E7 activo y la fuente tiene material); ✗ no encaja. En los ✗ se indica cuánto falta o sobra en **píxeles de la fuente** ("faltan 12 px", "sobran 8 px"). Se ven **sobre el recorte** y de forma compacta **en la lista de clips**; en 1:1, sobre el eje del plan actual (columnas si aún no hay plan). **Tolerancia del 1 %** en la proporción, absorbida sin deformar, en este orden: recortar un poco dentro del máx. (y escalar ≤ 1 %), ampliar unos píxeles fuera del máx. (si E7 lo permite) y, solo si nada de eso es posible, estirar ≤ 1 %. |
| F2 | **Imán y "Ajustar a" una fracción** | **Imán** al arrastrar un borde del máx. o del mín.: se engancha al tamaño exacto de 1/3, 1/2 o 2/3. **Desactivado por defecto**; un **toggle** lo activa y sirve de indicador de estado; **mantener Alt** mientras se arrastra invierte el toggle (activa si está desactivado, desactiva si está activo). Botones **"Ajustar a 1/3 / 1/2 / 2/3"** que redimensionan el máx. a esa fracción exacta, centrado en el mín. si lo hay, si no en el centro del máx. actual, dentro del fotograma. |
| A5 | **Copiar y pegar rectángulos** | Copiar el encuadre de un clip (**máx. + mín. + giro**) y pegarlo en el clip activo o en **todos los seleccionados**. Entre fuentes de otra resolución se **escala proporcionalmente** (como al re-vincular, B2); si cambia la proporción, se ajusta al fotograma y se avisa. No se copian "Ampliar más allá del máx." ni el audio. |
| A7 | **Sugerencia automática de recorte** | (1) Botón **"Quitar bandas negras"**: analiza el tramo del clip con `cropdetect` y ajusta el máx. a la zona con imagen. (2) **Recorte centrado a fracción**: son los botones "Ajustar a" de F2. (3) **Automático al crear**: se detectan las bandas **una vez por fuente** (en segundo plano, cacheado en el proyecto) y los clips nuevos de esa fuente nacen sin ellas. Ajuste del proyecto para desactivarlo, **activo por defecto**. |
| A9 | **Keyframes del rectángulo (paneo y zoom)** | Se animan **posición y escala** del máx. y el mín. juntos, **sin cambiar su proporción**, así que el encaje (F1) y el planificador no cambian. Limitado al fotograma de la fuente. Edición con **cronómetro + auto-key**: un botón "Animar" activa los keyframes del clip y, desde entonces, mover el recorte en un instante crea o actualiza el keyframe de ese instante; marcas en la línea de tiempo del clip, keyframe anterior/siguiente y borrar. **Interpolación elegible por keyframe**: suave (ease in-out, por defecto), lineal o mantener (salto seco). Render, previsualización en vivo y miniaturas usan el recorte animado. |

## 13. Mejoras v5 y correcciones (decididas con el usuario)

| ID | Mejora | Decisiones |
|---|---|---|
| G1 | **Bug: la ventana de reorden ilimitada da peores vídeos** que 3 o 10 (más largos, peor encaje) | Se busca y corrige la causa. Además, como red de seguridad, el planificador **calcula el plan con varias ventanas** (la elegida y otras menores) y se queda con el mejor, así "ilimitado" nunca sale peor. Coste de cálculo medido y acotado. |
| G2 | **Criterio de "mejor plan" configurable** | Ajuste del proyecto en Ajustes → Orden: **"Priorizar"**: *duración más corta* (por defecto: duración → relleno → orden de la lista → re-layouts) o *menos relleno* (relleno → duración → orden → re-layouts). |
| G3 | **Bug: demasiadas filas en la vista Mix** | La vista dibujaba una fila por identificador de columna del plan. Se **compactan**: columnas que no coinciden en el tiempo comparten fila, así que hay tantas filas como columnas simultáneas (normalmente 2–3), manteniendo en lo posible arriba-abajo = izquierda-derecha. |
| G4 | **Bug: Ctrl+Z (y el resto de atajos) no responden** tras pulsar un botón | Los atajos solo funcionaban con el foco en el cuerpo de la ventana. Ahora funcionan con el foco en cualquier sitio **salvo en campos de texto**; un botón con foco sigue respondiendo a Espacio/Intro. Se revisa que cada acción (vista Mix, clips, rectángulos, keyframes) cree su paso de deshacer. |
| G5 | **"Ajustar a" con mín.** | Si hay mín., se ajusta **el mín.**: su ancho (alto en filas) crece o encoge, centrado en el propio mín., para que el ancho más estrecho del clip sea exactamente la fracción. Si el máx. no llega a la fracción, se **ensancha lo justo** (centrado, dentro del fotograma); si no cabe, aviso. Sin mín., se ajusta el máx. como hasta ahora. |
| A3 | **Zoom y scroll horizontal en la vista Mix** | Por defecto, todo el vídeo ajustado al ancho (como ahora). **Ctrl + rueda**: zoom centrado en el ratón; rueda o Mayús + rueda: desplazamiento horizontal. Botones **+ / − / Ajustar** en la cabecera. Con zoom, al reproducir, la vista **sigue al cursor**. El zoom no se guarda en el proyecto. |

## 14. Bloques de overlays y plantillas (v6, decidido con el usuario)

| ID | Mejora | Decisiones |
|---|---|---|
| H1 | **Bloques de overlays** | Un bloque agrupa overlays (contadores, barras, imágenes, textos, sonidos) con **nombre y color** y se mueve como **una sola pieza** en la vista Mix. Tiene su propia **ancla** (absoluta, a un clip o a otro overlay/bloque); los miembros guardan tiempos **relativos al inicio del bloque** y conservan sus relaciones internas (anclas entre ellos, barra vinculada a contador). **Selección múltiple** de overlays (Ctrl/Mayús+clic) y "Agrupar en bloque": el bloque **hereda el ancla** de su primer overlay (si estaba anclado a un clip, el bloque sigue al clip) y todo queda exactamente donde estaba. Desagrupar, duplicar, renombrar, editar un miembro dentro del bloque, plegar su pista. Cada acción, un paso de deshacer. |
| H2 | **Exportar e importar bloques (plantillas)** | Fichero **`.vmxblock`**: JSON indentado, legible y editable a mano (se lee como JSON5: admite comentarios y comas finales; se escribe JSON estricto), con `format`, `version`, tiempos relativos al inicio del bloque y `originalStart`. **JSON Schema** para autocompletar y validar en editores. Las anclas a clips del proyecto de origen se convierten a tiempos relativos (el nombre del clip queda como referencia informativa). También **"Exportar selección"** de overlays sueltos. Ficheros (PNG, sonidos, fuentes): casilla **"Incluir ficheros"**: sin ella, rutas relativas al `.vmxblock`; con ella, se copian a una carpeta junto al `.vmxblock`. **Importar** con vista previa y colocación: **tiempos originales**, **desplazar** ± s, **en el cursor** o **anclado a un clip** (inicio/fin + desfase). Ids nuevas siempre (se puede importar varias veces); ficheros que faltan → localizarlos; errores de validación claros, sin importar a medias. Se importa como bloque, con opción de desagrupar. |
| H3 | **Biblioteca de plantillas** (E1) | Carpeta global de la app con `.vmxblock`; menú **"Insertar bloque"** con nombre, duración y miniatura; guardar un bloque en la biblioteca; abrir la carpeta. |
| H4 | **Variables de texto** (E2) | Marcadores **`{{nombre}}`** en los textos (con valor por defecto opcional `{{nombre\|valor}}`); al importar o insertar se pide su valor en un formulario; cada instancia guarda sus valores y se pueden editar después. |
| H5 | **Repetir un bloque** (E3) | Insertar **N veces cada X s** o **al inicio de cada clip de una selección** (anclado a cada clip). Las repeticiones son **instancias enlazadas**: comparten el contenido (editar una cambia todas); cada una tiene su ancla y sus valores de variables; **"Desvincular"** convierte una instancia en bloque independiente. |
| H6 | **Estirar la duración** (E4) | Escalar los tiempos del bloque para que dure X s; fundidos y animaciones de entrada se mantienen. |
| H7 | **Adaptar a otra proporción** (E5) | Si el bloque se hizo para otra proporción de salida, el diálogo de importación ofrece **"Adaptar"** (marcado por defecto): conserva el tamaño relativo a la altura y recoloca las cajas dentro del fotograma nuevo. |
| H8 | **Ocultar y bloquear** (E6) | Ocultar un bloque (no sale en previsualización ni render, sin borrarlo) y bloquearlo (no se puede mover ni editar sin desbloquear). |

## 15. Fuera de alcance (backlog)

- Notas en los clips.
- Resolución libre.
- Las propuestas aún no elegidas del [catálogo de propuestas](07-propuestas.md).
