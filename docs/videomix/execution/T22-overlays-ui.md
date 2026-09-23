# T22 · Overlays: pistas en la vista Mix y panel de propiedades

- **Hito**: M7 · **Modelo**: Opus · **Depende de**: T19 · **Estado**: pendiente

## Objetivo

Crear y editar imágenes, contadores, barras y sonidos desde la vista "Mix".

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §9.2 y §9.3
- [04-diseno](../04-diseno.md) §8.4
- Notas de T15 (`MixPlanView`, mini vista del fotograma), T06 (`overlayMath`: arrastre de rectángulos) y T04 (ediciones *transient* y undo)
- Modelo y reducer de T19

## Alcance

1. **Carriles nuevos en `MixPlanView`**: Imágenes, Contadores/barras y Sonidos.
   - Los bloques se colocan en su tiempo resuelto.
   - Arrastrar mueve el inicio: cambia el `offset` si el elemento está anclado o `time` si es absoluto. Arrastrar el borde derecho cambia la duración (no aplica a los sonidos).
   - Cada arrastre es un único paso de undo.
2. **Añadir**: botones o menú "Add image… / Add countdown / Add progress bar / Add sound…". Por defecto se colocan en el cursor de la vista Mix, con tiempo absoluto. Los diálogos de fichero filtran por tipo: PNG; wav, mp3, m4a, ogg, flac; ttf, otf.
3. **Panel de propiedades** del elemento seleccionado, con todos los campos del modelo:
   - anclaje: tipo, clip o elemento, borde y desplazamiento;
   - cajas y presets de posición;
   - colores, fuente, decimales, dirección, etc.;
   - duplicar, borrar y subir o bajar de capa.
   - Para la barra, "vincular a contador".
4. **Colocación visual**: los elementos visuales se arrastran y redimensionan sobre la mini vista del fotograma (reutiliza `overlayMath` en coordenadas 0..1). Si T20 ya dibuja las cajas en la mini vista, se integran; si no, las dibuja esta tarea. Coordínalo leyendo el árbol.
5. **Avisos** de `resolveOverlayTimes` visibles: ciclo, referencia borrada o fuera de duración.
6. **Borrar un clip** del que dependen elementos: convierte esos anclajes en absolutos (acción de T19) y avisa con un toast.
7. **i18n** con claves en inglés y traducción al español.

## Criterios de aceptación

- Se puede crear cada tipo, anclarlo a un clip y a otro elemento, moverlo y deshacer.
- `yarn tsc && yarn lint && yarn test run && yarn build` en verde.
- Instrucciones de prueba manual en las notas.

## Notas de ejecución

## Revisión
