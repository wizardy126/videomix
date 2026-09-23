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

## 10. Fuera de alcance en v1 (backlog)

- Keyframes o paneo del rectángulo.
- Ajustes manuales del plan de montaje.
- Ducking de la música.
- Varias pistas de música.
- Notas en los clips.
- H.265 y encoders por hardware.
- Resolución libre.
