# T38b · v3: ampliar más allá del máx. para evitar relleno (E7)

- **Hito**: M9 · **Modelo**: Opus · **Depende de**: T37, T38 · **Estado**: pendiente

## Objetivo

Cuando, respetando los máx., una disposición dejaría relleno, se amplía el recorte de los clips que lo permitan hasta llenar el fotograma con material real de la fuente.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §11 (E7)
- [04-diseno](../04-diseno.md) §2 (geometría) y §3 (planificador)
- Notas de T03, T10b, T29, T35 (píxeles de visualización), T38 y T32 (previsualización)

## Alcance

1. **Modelo**: `MixClip.extendBeyondMax?: boolean`, donde sin definir equivale a `true` (aditivo, sin cambio de versión). Se valida.
2. **Geometría**:
   - intervalo de proporciones ampliado de un clip: el máx. puede crecer en el eje principal hasta los bordes del fotograma de la fuente, manteniendo la altura (o el ancho en filas);
   - recorte centrado en el máx. y asimétrico si un lado toca el borde;
   - pares y en píxeles de visualización (T35).
3. **Planificador (último recurso)**:
   - las opciones se evalúan igual que ahora, con los intervalos normales;
   - solo si la opción elegida deja relleno estructural (o pillarbox o letterbox), se intenta cubrirlo ampliando los clips con el flag;
   - el ancho extra se reparte en proporción al material disponible de cada clip, saturando;
   - si no alcanza, queda relleno el resto.
   - **No** se aplica al final del vídeo (columnas que terminan sin sucesor).
   - Se emite el aviso `extended` (clip, píxeles ampliados y rango de tiempo).
   - Sin clips ampliables o con el flag desactivado, el plan es idéntico al actual (snapshots sin cambios).
4. **Render y previsualización en vivo**: usan el recorte ampliado. En el render, el `crop` codificado es de T35.
5. **UI**:
   - interruptor por clip ("Ampliar más allá del máx. si hace falta") en la lista de clips o en su menú, y en el panel del clip seleccionado si existe;
   - aviso en la vista Mix: icono en el bloque y tooltip, más la línea en la confirmación previa al render.
   - i18n en español.
6. **Tests**:
   - geometría (centrado, asimetría en el borde, reparto proporcional);
   - planificador: invariantes nuevas (el recorte ampliado no sale de la fuente y el relleno se reduce) y propiedades en los 3 aspectos;
   - render con ffmpeg real de un caso que antes tenía relleno y ahora no, revisando los fotogramas.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

## Revisión
