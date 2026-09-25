# T49 · v4: edición de keyframes (A9)

- **Hito**: M11 · **Modelo**: Opus · **Depende de**: T44, T45, T48 · **Estado**: en curso

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§12 (v4)**, [03-convenciones](../03-convenciones.md), lo relevante de [04-diseno](../04-diseno.md).
- Helpers de keyframes de T44, notas de T45 (barra del editor) y T48. `RectOverlay.tsx`, `RectOverlayToolbar.tsx`, `ClipRectEditor.tsx`, timeline heredado (marcas del clip activo), atajos.

## Alcance

1. Botón **"Animar"** (cronómetro) por clip: activa los keyframes (crea el primero en el instante actual con el encuadre actual). Desactivarlo borra los keyframes, con confirmación.
2. **Auto-key**: con el clip animado, el editor muestra el recorte interpolado en el instante del cursor; mover o escalar el recorte (proporción bloqueada) crea o actualiza el keyframe de ese instante (un paso de historial por gesto). Con el clip animado, el tirador del mín. y los que cambian la proporción se comportan de forma coherente (decide y documenta; p. ej. editar la proporción solo sin animar, o aplicar a todos los keyframes).
3. **Marcas** de keyframes en la línea de tiempo del clip; **anterior / siguiente** (con atajos) y **borrar** el del instante actual.
4. **Interpolación por keyframe**: suave (por defecto), lineal, mantener; selector en la barra cuando el cursor está sobre un keyframe.
5. Compatibilidad: el indicador de encaje (T45) y el imán siguen funcionando (la proporción no cambia); copiar/pegar (T46) según la decisión de T44.
6. **Barra del editor** (preexistente desde T06, empeorado al crecer en T45): cuando el máx. toca el borde superior del fotograma, la barra tapa la etiqueta de tamaño y los tiradores superiores (captura `13a-turned-clip-editor.png`). Recolocarla para que nunca tape tiradores ni etiquetas (p. ej. fuera del área de la imagen o en la parte libre), sin romper los e2e.
7. i18n (en + es).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde; e2e: activar Animar, mover el recorte en dos instantes, comprobar las marcas y que la previsualización en vivo cambia entre ellos.

## Notas de ejecución

## Revisión
