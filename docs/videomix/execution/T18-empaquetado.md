# T18 · Empaquetado de VideoMix

- **Hito**: M6 · **Modelo**: Sonnet · **Depende de**: T17 · **Estado**: pendiente

## Objetivo

Poder generar instalables de VideoMix.

## Contexto (leer antes de empezar)

- [02-as-built](../02-as-built.md) §10
- `package.json` (`build`)
- T01 (identidad)

## Decisiones del usuario

- **Objetivos**: Linux (AppImage + tar) y Windows (zip/7z). Sin Mac, sin Microsoft Store (appx), sin Mac App Store y sin snap.
- **Icono**: generar uno provisional (SVG sencillo que evoque columnas de vídeo) a partir del que usa `script/generateIcon.ts`.
- **`author`**: `{ "name": "wizardy126", "url": "https://wizardy.net" }`. Se mantiene el crédito a LosslessCut / Mikael Finstad en el panel About y en las licencias.
- **CI**: no se reactiva ningún workflow de build.

## Alcance

1. **Configuración de electron-builder para VideoMix**:
   - `appId` e identidades de la tienda coherentes;
   - quitar los objetivos `mas` / `appx` / `snap` si no se van a usar (**pregunta**: el orquestador consultará al usuario qué objetivos quiere);
   - asociaciones de ficheros: añadir `.vmx` y revisar las de vídeo.
2. Renombrar los ficheros de escritorio de Linux (`no.mifi.losslesscut.desktop` y `.appdata.xml`) a `net.wizardy.videomix.*` y ajustar su contenido.
3. **Icono**: si no hay uno propio, mantener el generado y anotarlo (**pregunta** al usuario).
4. Reactivar un workflow de build adaptado solo si el usuario lo pide.
5. Probar `yarn pack-linux` (AppImage o tar) en este entorno.

## Criterios de aceptación

- El paquete de Linux arranca (al menos se construye correctamente).
- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

## Revisión
