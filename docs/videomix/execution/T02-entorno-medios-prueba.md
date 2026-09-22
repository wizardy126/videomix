# T02 · Entorno de desarrollo: ffmpeg y medios de prueba

- **Hito**: M0 · **Modelo**: Sonnet · **Depende de**: — · **Estado**: hecha

## Objetivo

Que cualquier agente o desarrollador pueda disponer de ffmpeg y de un conjunto de vídeos sintéticos reproducibles para probar el montaje.

## Contexto (leer antes de empezar)

- [06-entorno-desarrollo](../06-entorno-desarrollo.md)
- [03-convenciones](../03-convenciones.md)
- Scripts existentes en `script/`: estilo TS ejecutado con `node script/x.ts` y `tsconfig.node.json`.

## Alcance

1. **ffmpeg**:
   - Descarga ffmpeg para linux-x64 con el script existente (`yarn download-ffmpeg-linux-x64`, usando `node .yarn/releases/yarn-4.18.0.cjs` si corepack falla).
   - Verifica que funciona: `LD_LIBRARY_PATH=ffmpeg/linux-x64/lib ffmpeg/linux-x64/lib/ffmpeg -version`.
   - Si el script falla en este entorno por dependencias como `wget` o `tar -xv`, anota la alternativa manual en `06-entorno-desarrollo.md`.
2. **Crea `script/videomix/generateTestMedia.ts`**:
   - Usa execa (ya es dependencia) y localiza ffmpeg igual que `src/main/ffmpeg.ts` en desarrollo (`ffmpeg/<platform>-<arch>/[lib/]`), o por una variable de entorno `FFMPEG_PATH`.
   - Genera en `test-media/`, que se añade a `.gitignore`. Todos los vídeos llevan un contador de tiempo (`drawtext` si está disponible y, si no, `testsrc2`, que ya lo incluye), para distinguirlos visualmente.

     | Fichero | Contenido |
     |---|---|
     | `h-1080p-10s.mp4` | 1920×1080, 30 fps, 10 s, `testsrc2` + tono 440 Hz |
     | `h-720p-25fps-8s.mp4` | 1280×720, 25 fps, 8 s, `smptebars` + tono 660 Hz a menor volumen (−12 dB) |
     | `v-1080x1920-12s.mp4` | vertical 1080×1920, 30 fps, 12 s, `testsrc2` + ruido rosa bajo |
     | `v-rotated-9s.mp4` | codificado 1920×1080 con metadato de rotación 90° (se ve vertical), 9 s, con audio |
     | `sq-1080-6s.mp4` | 1080×1080, 6 s, **sin audio** |
     | `v-720x1280-silent-7s.mp4` | vertical con pista de audio en silencio |
     | `music-20s.m4a` | 20 s de música sintética (acordes con `sine` + `amix`) |
     | `music-60s.mp3` | 60 s |

   - Es idempotente: no regenera lo que ya existe salvo con `--force`.
3. **`package.json`**: script `"generate-test-media": "node script/videomix/generateTestMedia.ts"`.
4. **Documentación**: actualiza `06-entorno-desarrollo.md` con el uso real y la lista de ficheros.

## Fuera de alcance

- Tests automáticos que usen ffmpeg (se decidirá en T09/T11).

## Criterios de aceptación

- `yarn generate-test-media` genera todos los ficheros.
- `ffprobe` muestra lo esperado: resoluciones, rotación, presencia o ausencia de audio y duraciones.
- `yarn tsc && yarn lint && yarn test run` en verde. El script entra en `tsconfig.node.json` por `script/**/*`.

## Validación

```
yarn generate-test-media
for f in test-media/*; do ffprobe -v error -show_entries stream=codec_type,width,height:stream_side_data=rotation:format=duration -of compact "$f"; done
```

## Notas de ejecución

- **ffmpeg**: `yarn download-ffmpeg-linux-x64` (vía `node .yarn/releases/yarn-4.18.0.cjs`) funcionó sin problemas en este entorno (wget/tar disponibles); no hizo falta la alternativa manual. Verificado con `LD_LIBRARY_PATH=ffmpeg/linux-x64/lib ffmpeg/linux-x64/lib/ffmpeg -version` → `n8.0-23-gd1f31a829d`.
- **Script**: creado `script/videomix/generateTestMedia.ts`. Localiza ffmpeg como `src/main/ffmpeg.ts` (`ffmpeg/<platform>-<arch>/[lib/]`) o vía `FFMPEG_PATH`; en Linux fija `LD_LIBRARY_PATH` a esa carpeta porque, a diferencia del build empaquetado, el binario de desarrollo no lleva rpath a sus `.so` hermanos. Genera los 8 ficheros de la tabla en `test-media/`, es idempotente (comprueba existencia antes de generar) y soporta `--force`. Todos los vídeos llevan un contador de tiempo (`drawtext`, detectado en runtime vía `ffmpeg -filters`; si no estuviera disponible, se usa el contador propio de `testsrc2`).
- **Rotación de `v-rotated-9s.mp4`**: `-metadata:s:v:0 rotate=90` no funciona para escribir rotación al codificar en este ffmpeg 8.0 (solo se lee por compatibilidad hacia atrás). La forma correcta (señalada en revisión, y usada por el as-built en `useFfmpegOperations.ts`) es `-display_rotation`, pero solo tiene efecto como opción de **entrada**: hay que aplicarla al leer/remuxear, no al codificar. El script por tanto codifica primero un fichero temporal sin rotar y luego lo remuxea con `-display_rotation:v:0 90 -i <temp> -c copy`, borrando el temporal. Verificado con `ffprobe -show_entries stream_side_data=rotation`: `rotation=90`, con `width=1920,height=1080` intactos (criterio de aceptación cumplido).
- **Documentación**: actualizado `06-entorno-desarrollo.md` con el uso real, la tabla de ficheros y la nota sobre la rotación.
- **Validación**: `yarn tsc && yarn lint && yarn test run` en verde (93 tests). `yarn generate-test-media` genera los 8 ficheros; `ffprobe` muestra resoluciones, fps, rotación, presencia/ausencia de audio y duraciones correctas (ver tabla):

  | Fichero | width×height | fps | duración | audio | rotación |
  |---|---|---|---|---|---|
  | h-1080p-10s.mp4 | 1920×1080 | — | 10.0s | sí | — |
  | h-720p-25fps-8s.mp4 | 1280×720 | 25 | 8.0s | sí (−12dB) | — |
  | v-1080x1920-12s.mp4 | 1080×1920 | — | 12.0s | sí (ruido rosa) | — |
  | v-rotated-9s.mp4 | 1920×1080 | — | 9.0s | sí | 90 |
  | sq-1080-6s.mp4 | 1080×1080 | — | 6.0s | no | — |
  | v-720x1280-silent-7s.mp4 | 720×1280 | — | 7.0s | sí (silencio, −91dB) | — |
  | music-20s.m4a | (audio) | — | 20.0s | — | — |
  | music-60s.mp3 | (audio) | — | 60.0s | — | — |

## Revisión

- **Resultado**: aceptada tras una iteración.
  - Primera versión: escribía la matriz de rotación del `tkhd` con un parser ISO-BMFF propio.
  - Cambio pedido: usar `-display_rotation:v:0 90` con remux `-c copy`, como hace el as-built. Aplicado y verificado con ffprobe (`rotation=90`).
  - El orquestador añadió el script `generate-test-media` a `package.json`.
