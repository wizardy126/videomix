# 06 · Entorno de desarrollo

## Requisitos

- Node 22 o superior (CI usa 22).
- Yarn 4, incluido en `.yarn/releases/yarn-4.18.0.cjs`.
- ffmpeg/ffprobe 8.x.

## Instalación

```bash
yarn install --immutable
```

Si corepack no puede descargar Yarn (por ejemplo, detrás de un proxy restrictivo), usa directamente el binario incluido:

```bash
node .yarn/releases/yarn-4.18.0.cjs install --immutable
alias yarn="node $(pwd)/.yarn/releases/yarn-4.18.0.cjs"
```

## ffmpeg

En desarrollo, la app busca ffmpeg en `ffmpeg/<platform>-<arch>/` (la carpeta está en `.gitignore`):

```bash
yarn download-ffmpeg-linux-x64      # o darwin-x64 / darwin-arm64 / win32-x64 / win32-arm64
```

- En Linux los binarios quedan en `ffmpeg/linux-x64/lib/`, con las librerías compartidas. Para usarlos desde la terminal: `LD_LIBRARY_PATH=ffmpeg/linux-x64/lib ffmpeg/linux-x64/lib/ffmpeg …`.
- También se puede indicar una ruta propia en los Ajustes de la app (`customFfPath`).

## Medios de prueba

`script/videomix/generateTestMedia.ts` genera un conjunto fijo de ficheros sintéticos en
`test-media/` (ignorado por git), todos con un contador de tiempo superpuesto (`drawtext`, o el
contador propio de `testsrc2` si `drawtext` no está disponible) para distinguirlos a simple vista:

```bash
yarn generate-test-media          # no regenera lo que ya existe
yarn generate-test-media --force  # regenera todo
```

Localiza ffmpeg igual que la app en desarrollo (`ffmpeg/<platform>-<arch>/[lib/]`), o usa
`FFMPEG_PATH=/ruta/a/ffmpeg yarn generate-test-media` para apuntar a otro binario.

| Fichero | Contenido |
|---|---|
| `h-1080p-10s.mp4` | 1920×1080, 30 fps, 10 s, `testsrc2` + tono 440 Hz |
| `h-720p-25fps-8s.mp4` | 1280×720, 25 fps, 8 s, `smptebars` + tono 660 Hz a −12 dB |
| `v-1080x1920-12s.mp4` | vertical 1080×1920, 30 fps, 12 s, `testsrc2` + ruido rosa a −24 dB |
| `v-rotated-9s.mp4` | codificado 1920×1080, 9 s, con audio; matriz de rotación 90° en el `tkhd` (se ve vertical) |
| `sq-1080-6s.mp4` | 1080×1080, 30 fps, 6 s, sin audio |
| `v-720x1280-silent-7s.mp4` | vertical 720×1280, 30 fps, 7 s, con pista de audio en silencio |
| `music-20s.m4a` | 20 s de acordes sintéticos (`sine` + `amix`), aac |
| `music-60s.mp3` | 60 s, mismo generador, mp3 |

**Nota sobre `v-rotated-9s.mp4`**: `-display_rotation` solo surte efecto como opción de *entrada*
(fija side data de rotación al leer, que luego se propaga al remuxear). Por eso el script primero
codifica un fichero temporal sin rotar y luego lo remuxea con `-display_rotation:v:0 90 -c copy`
(el mismo mecanismo que usa el as-built en `useFfmpegOperations.ts` para rotar clips), borrando el
temporal al terminar.

## Comandos

| Comando | Uso |
|---|---|
| `yarn dev` | App en modo desarrollo (renderer en 127.0.0.1:3001, recarga en caliente) |
| `yarn tsc` | Comprobación de tipos (4 proyectos TS) |
| `yarn lint` | ESLint |
| `yarn test run` | Tests (vitest, una pasada). `yarn test` = modo watch |
| `yarn build` | Build de producción de electron-vite |
| `yarn scan-i18n` | Extrae las claves nuevas a `locales/en/translation.json` |
| `yarn check` | Todo lo anterior más licencias y docs |
| `yarn generate-test-media` | Genera los vídeos y audios sintéticos de `test-media/` (ver arriba) |

**Definición de hecho de cada tarea**: `yarn tsc && yarn lint && yarn test run` en verde.

## Empaquetado (T18)

VideoMix solo empaqueta para **Linux** (AppImage + tar.bz2) y **Windows** (zip/7z); no hay
objetivos de macOS, Mac App Store, Microsoft Store (appx) ni snap. La configuración vive en la
clave `build` de `package.json` (electron-builder 26).

```bash
# Linux (necesita ffmpeg en ffmpeg/linux-x64/, ver más arriba)
yarn pack-linux           # todos los objetivos de build.linux.target (tar.bz2 + AppImage, x64/arm64/armv7l)
# o, para un objetivo/arquitectura concretos, sin pasar por el script:
yarn build && node_modules/.bin/electron-builder --linux AppImage tar.gz --x64 --publish never

# Windows (necesita ffmpeg en ffmpeg/win32-x64/lib, o win32-arm64/lib)
yarn pack-win              # zip + 7z, x64 y arm64
```

Los artefactos se generan en `dist/` (ignorado por git; nunca se comitea). El icono provisional
(`src/renderer/src/icon.svg`, tres columnas de vídeo en un marco 16:9) se renderiza a
`icon-build/app-512.png` (Linux) y `icon-build/app.ico` (Windows) con `yarn generate-icon`
(`script/generateIcon.ts`, usa `sharp`); `yarn build` ya lo invoca.

Para comprobar un AppImage sin necesidad de FUSE/sandbox:

```bash
dist/VideoMix-linux-x64.AppImage --appimage-extract
ls squashfs-root                                   # AppRun, videomix.desktop, resources/, ffmpeg, ffprobe…
```

Los ficheros de escritorio de Linux (`net.wizardy.videomix.desktop`,
`net.wizardy.videomix.appdata.xml`, en la raíz del repo) no los usa electron-builder para generar
el AppImage (que crea su propio `.desktop` a partir de `build.linux`); son metadatos para
integraciones de escritorio/AppStream y quedan sincronizados a mano con la identidad del `appId`.

## Notas

- `yarn lint` imprime avisos `TSSatisfiesExpression could not be resolved` que vienen del as-built. Son inofensivos.
- La app de Electron no se puede ejecutar con interfaz en el entorno de agentes (no hay display). La UI se valida con tests de la lógica y la revisa el usuario.
