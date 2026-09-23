# T32 · v2: previsualización en vivo (A1)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T26, T27, T29 · **Estado**: pendiente

## Alcance

1. **Motor**:
   - en la pestaña Mix, el área del player muestra la composición en tiempo real según `renderTimeline` (columnas o filas, recortes, re-layouts con `smoothstep`, rellenos de color o desenfoque aproximado, separaciones, transiciones aproximadas con *fade*);
   - los overlays se dibujan en un canvas (PNG, textos con sus animaciones, contadores y barras), con los mismos cálculos de `overlayFrames`.
2. **Vídeos**:
   - un `<video>` por clip visible, más precarga del siguiente de cada columna;
   - sincronizados con un reloj maestro, corrigiendo la deriva;
   - fuentes no reproducibles por Chromium: se reutiliza el `previewFilePath` de html5ify si existe, o se muestra un marcador "no previsualizable".
3. **Audio** con WebAudio:
   - ganancias de normalización (cache de sonoridad) más `gainDb`;
   - lista de música con crossfade y ducking aproximado;
   - efectos de sonido.
4. **Controles**: reproducir, pausar, buscar (sincronizado con el cursor de la vista Mix), barra espaciadora y aviso "Aproximado; el render es la referencia".
5. **Rendimiento**: objetivo de 30 fps con 3 columnas a 1080p en un equipo medio. Se documentan los límites.
6. **Tests** de la lógica pura: planificación de qué vídeos cargar, reloj y cálculo de ganancias.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde. Instrucciones de prueba manual.

## Notas de ejecución

## Revisión
