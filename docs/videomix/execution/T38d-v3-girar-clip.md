# T38d · v3: girar un clip (E9)

- **Hito**: M9 · **Modelo**: Opus · **Depende de**: T38c, T35b · **Estado**: pendiente

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §11 (E9)
- Notas de T06 y T07 (overlay y editor de rectángulos; la rotación manual de LosslessCut se desactivó en VideoMix), T35 (píxeles de visualización, SAR y rotación de metadatos), T29, T31 (miniaturas), T32 (previsualización en vivo) y T38b (ampliar más allá del máx.)

## Alcance

1. **Modelo**:
   - `MixClip.rotation?: 0 | 90 | 180 | 270`, en grados en sentido horario (aditivo; sin definir = 0);
   - validación;
   - al duplicar un clip se copia la rotación.
2. **Geometría**:
   - los rectángulos del clip están en el **fotograma de la fuente girado** por su `rotation`, además de la rotación de metadatos y el SAR (T35);
   - función pura para transformar rectángulos al cambiar el giro, de modo que se conserva el encuadre: el mismo contenido pasa a la nueva orientación;
   - el tamaño del fotograma girado se usa en la validación, el planificador (intervalos de proporción y orientación) y T38b (material disponible).
3. **Render**:
   - `transpose` / `hflip,vflip` antes del `crop` (o convertir el recorte a coordenadas sin girar y girar después, lo que sea más eficiente);
   - coherente con el SAR (T35);
   - test con ffmpeg real en los 4 giros, comparando por píxeles con una referencia.
4. **Miniaturas y previsualización en vivo**: aplican el giro. En la previsualización, se rota en el canvas.
5. **Editor**:
   - con un clip girado seleccionado, el reproductor muestra la imagen girada (transformación CSS del `<video>`, o el reproductor compat con rotación) y el overlay de rectángulos trabaja en ese espacio;
   - acciones "Girar +90°", "Girar −90°" y "Girar 180°" en el menú del clip de `ClipList` y en la barra del editor de rectángulos, con atajos si no chocan;
   - indicador de giro en la fila.
6. **i18n**: español.
7. **Tests**: transformación de rectángulos (ida y vuelta en 4 giros, pares, dentro del fotograma), validación, planificador con clips girados y un escenario e2e (girar un clip y renderizar la previsualización).

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

## Revisión
