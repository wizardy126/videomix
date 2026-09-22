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

`T02` añade un script que genera vídeos sintéticos en `test-media/` (ignorado por git):
- horizontales y verticales;
- con y sin audio;
- con rotación de metadatos;
- una pista de música.

Ver el propio script para la lista exacta.

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

**Definición de hecho de cada tarea**: `yarn tsc && yarn lint && yarn test run` en verde.

## Notas

- `yarn lint` imprime avisos `TSSatisfiesExpression could not be resolved` que vienen del as-built. Son inofensivos.
- La app de Electron no se puede ejecutar con interfaz en el entorno de agentes (no hay display). La UI se valida con tests de la lógica y la revisa el usuario.
