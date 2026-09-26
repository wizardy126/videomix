# T58 · v6: exportar, importar y biblioteca de plantillas (H2, H3, H4, H7)

- **Hito**: M13 · **Modelo**: Opus · **Depende de**: T56 · **Estado**: en curso

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§9 (overlays) y §14 (v6)**, [03-convenciones](../03-convenciones.md), [04-diseno](../04-diseno.md) (overlays, §1.2 modelo).
- Notas de T56 (formato `.vmxblock`, JSON Schema, operaciones), T26 (exportar/importar presets de estilo: patrón de diálogos y ficheros), T42 (ficheros de la app), `projectFile.ts` (rutas relativas).

## Alcance

1. **Exportar** un bloque o la **selección** de overlays sueltos a `.vmxblock`, con casilla **"Incluir ficheros"** (copia PNG, sonidos y fuentes a una carpeta junto al `.vmxblock`, rutas relativas).
2. **Importar** con diálogo: vista previa (overlays, duración), colocación (**tiempos originales**, **desplazar ± s**, **en el cursor**, **anclado a un clip** inicio/fin + desfase), **variables** (formulario con los `{{nombre}}` encontrados y sus valores por defecto), **Adaptar** a la proporción si es distinta (H7, marcado por defecto), importar como bloque o desagrupado. Ficheros que faltan → localizarlos. Errores de validación mostrados con campo y motivo, sin importar a medias. Un paso de deshacer.
3. **Biblioteca** (H3): carpeta global de la app (en userData, o configurable), "Guardar en la biblioteca", menú **"Insertar bloque"** con nombre, duración y miniatura (fotograma central renderizado con ffmpeg o dibujado con el motor de la previsualización; decide), "Abrir carpeta de la biblioteca".
4. Menús y atajos donde encaje; i18n (en + es); e2e con un `.vmxblock` editado a mano (comentarios JSON5) y con ficheros incluidos.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde.

## Notas de ejecución

## Revisión
