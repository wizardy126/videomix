# T26 · v2: textos libres y presets globales (B1, B2)

- **Hito**: M8 · **Modelo**: Opus · **Depende de**: T24 · **Estado**: pendiente

## Alcance

1. **Render del overlay `text`** en `render/overlayFilters.ts`:
   - multilínea con alineación, usando `drawtext` con `textfile` o una línea por `drawtext` (hay que resolver bien el escapado);
   - borde, sombra y *fades*;
   - **animación de entrada**:
     - *slide*: `x`/`y` en función de `t` con *easing*;
     - *typewriter*: aparición carácter a carácter, con un `drawtext` por tramo o `enable` por prefijos, sin `if()` anidados.
   - Tests con ffmpeg real (se omiten si falta).
2. **Mini vista y UI**:
   - el texto se muestra en la mini vista (aproximado) y en la pista de Contadores y barras, que pasa a llamarse "Textos, contadores y barras";
   - panel de propiedades para el texto (área multilínea);
   - botón "Add text".
3. **Presets globales (B2)**:
   - se guardan en `configStore` (clave nueva, con migración y valor por defecto `[]`);
   - desde el panel de propiedades de un texto, contador o barra: "Guardar estilo…", "Aplicar estilo" (lista filtrada por tipo) y gestión (renombrar y borrar);
   - exportar e importar presets a un fichero JSON.
   - Un preset solo guarda propiedades de estilo, sin tiempos, anclajes ni textos.
4. **i18n**: español.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build` en verde. Fotogramas revisados de un texto multilínea, de *slide* a mitad y de *typewriter* a mitad.

## Notas de ejecución

## Revisión
