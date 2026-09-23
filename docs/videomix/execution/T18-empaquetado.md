# T18 · Empaquetado de VideoMix

- **Hito**: M6 · **Modelo**: Sonnet · **Depende de**: T17 · **Estado**: hecha

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

### Resumen de cambios

- **`package.json` (`author`)**: `{ "name": "wizardy126", "url": "https://wizardy.net" }`. `copyright` sigue siendo `"Copyright © 2026 ${author}"`; electron-builder interpola `${author}` a `author.name` (ver `app-builder-lib/out/appInfo.js`), así que ahora renderiza `"Copyright © 2026 wizardy126"`. El crédito a LosslessCut / Mikael Finstad se mantiene en `src/main/aboutPanel.ts` (no tocado en esta tarea) y en `licenses.txt` (generado por `yarn generate-licenses`, que usa `yarn licenses generate-disclaimer`, el cual toma las licencias reales de las dependencias, no el `author` del propio paquete).
- **`build` (electron-builder)**: se han quitado por completo las claves `mac`, `mas`, `appx` y `snap`. Los objetivos que quedan son:
  - `win.target`: `zip` y `7z`, para `x64` y `arm64` (antes tenía `7z` + `appx`; se sustituye `appx` por `zip`, que es el otro formato pedido en la decisión del usuario).
  - `linux.target`: `AppImage` y `tar.bz2` para `x64`, más `tar.bz2` para `arm64`/`armv7l` (se ha quitado `snap`; se mantiene `tar.bz2` en vez de cambiar a `tar.gz` porque la decisión del usuario dice "tar.bz2 **o** tar.gz" y ya estaba configurado así).
  - `extraResources` de ffmpeg para `linux`/`win` no se han tocado.
  - `icon-build/app.icns` (macOS) y las plantillas de Windows Store (`StoreLogo`/`Square*Logo`/`Wide*Logo`) han dejado de generarse (ver `script/generateIcon.ts`); `icon-build/app-512.png` (Linux) y `icon-build/app.ico` (Windows) siguen igual.
- **Asociaciones de ficheros**: se añade `.vmx` ("VideoMix Project", rol `Editor`) tanto en `win.fileAssociations` como en `linux.fileAssociations`; en Linux se le pone `mimeType: "application/x-videomix-project"` explícito porque electron-builder solo escribe la clave `MimeType` del `.desktop` generado (y el `mime-info` xml) para las asociaciones que tienen `mimeType` (ver `app-builder-lib/out/targets/LinuxTargetHelper.js`). Las asociaciones de vídeo/audio existentes (que nunca tuvieron `mimeType`) se han dejado igual: quedan registradas por extensión pero, como ya pasaba antes de esta tarea, no aportan una entrada `MimeType` al `.desktop` generado; no se ha ampliado ese alcance porque no lo pedía la tarea.
- **Icono provisional**: `src/renderer/src/icon.svg` se ha sustituido por un diseño sencillo (fondo oscuro redondeado, un marco de vídeo 16:9 y tres columnas verticales redondeadas de anchos distintos en colores intensos: teal, coral y amarillo) que evoca varios clips de vídeo combinándose en un único resultado. `script/generateIcon.ts` se ha simplificado para generar solo lo que hace falta en Linux/Windows (`app-512.png`, `app.ico`); se ha quitado la generación de `.icns` y de los PNG de Windows Store, y la constante `srcMacIcon`. Como consecuencia, `src/renderer/src/icon-mac.svg` quedó sin ningún uso y se ha borrado. El icono no se usa en ningún otro sitio del código (solo en `README.md`, dentro de la sección "Original LosslessCut README", que no se ha tocado porque documenta el proyecto original).
- **Ficheros de escritorio de Linux**: `no.mifi.losslesscut.desktop` → `net.wizardy.videomix.desktop` y `no.mifi.losslesscut.appdata.xml` → `net.wizardy.videomix.appdata.xml` (renombrados con `git mv`, sin comitear). Contenido actualizado: `Name=VideoMix`, `Comment` con la descripción de VideoMix, `Icon=net.wizardy.videomix`/`videomix`, `StartupWMClass=videomix` (coincide con `linux.executableName`), `MimeType` con la lista de vídeo/audio existente más `application/x-videomix-project;`. El `appdata.xml` cambia `id`, `developer`, `name`, `summary`, `description` (incluye una frase indicando que VideoMix es un fork de LosslessCut de Mikael Finstad), `launchable`, `url` (homepage → `https://wizardy.net`, bugtracker → el repo de `wizardy126/videomix`; se quita el `url type="donation"` de PayPal, que no aplica) y resetea `<releases>` a una única entrada `0.1.0` (el historial de versiones de LosslessCut no aplica a VideoMix; `script/postversion.ts` seguirá añadiendo una entrada por cada `yarn version`). Se ha actualizado `script/postversion.ts` (URL del XML) y `package.json` (`scripts.version`, que hacía `git add no.mifi.losslesscut.appdata.xml`).
  - **Nota**: estos dos ficheros no los usa electron-builder para generar el `.desktop`/AppStream del AppImage: electron-builder genera su propio `.desktop` a partir de `build.linux` (nombre, `MimeType` de las `fileAssociations` con `mimeType`, icono, etc.) en tiempo de build. Los ficheros de la raíz del repo son metadatos estáticos (para flatpak/AppStream si algún día se empaqueta así) que se mantienen sincronizados a mano con la identidad del `appId`.
- **Scripts de `package.json`**: se quitan `pack-mac` y `pack-mas-dev` (no hay objetivo macOS). `pack-win` pasa a `electron-builder --win zip 7z --x64` (antes solo `zip --x64`, ahora que hay dos formatos configurados). `pack-linux` se deja como `electron-builder --linux` (sin flags, ya que `build.linux.target` solo tiene los objetivos decididos). `generate-icon` deja de crear `build-resources/appx` (`mkdirp icon-build && node script/generateIcon.ts`). Los scripts `download-ffmpeg-darwin-*` no se han tocado (no forman parte de la configuración de empaquetado, y pueden seguir siendo útiles para desarrollo/pruebas locales en macOS aunque no haya un target de macOS empaquetado).
- **Ficheros de macOS que se mantienen sin tocar** (no rompen nada al no estar referenciados desde `build`): `entitlements.mas.plist`, `entitlements.mas.inherit.plist`, `entitlements.mas.loginhelper.plist`, `src/main/isStoreBuild.ts` (sigue comprobando `process.mas`/`process.windowsStore`, lo cual es inofensivo: en un build de Linux/Windows normal ambos son `undefined`/`false`). No se ha tocado `script/checkLicenses.ts` (ya permitía `GPL-2.0-only` para `videomix` desde la revisión de T01).
- **`docs/videomix/06-entorno-desarrollo.md`**: se añade una sección "Empaquetado (T18)" con los comandos (`yarn pack-linux`, `yarn pack-win`, invocación directa de `electron-builder`) y cómo verificar un AppImage con `--appimage-extract` sin FUSE.
- **`desktopName`/`syncDesktopName`**: al construir el AppImage, electron-builder avisó (`desktopName is not set in package.json`) de que sin `desktopName` el `.desktop`/`StartupWMClass` generados usan el `productName` en vez del `appId`, lo que puede desincronizar la asociación de ventanas del escritorio con el `.desktop` real. Se ha añadido `"desktopName": "net.wizardy.videomix.desktop"` en la raíz de `package.json` y `"syncDesktopName": true` en `build.linux`; tras el cambio, el AppImage genera `net.wizardy.videomix.desktop` (en vez de `videomix.desktop`) con `StartupWMClass=net.wizardy.videomix`, coherente con el `appId` y con el fichero de escritorio renombrado en el punto anterior. No estaba pedido explícitamente por la tarea, pero es consecuencia directa del renombrado del `.desktop` y del `appId`, así que se ha aplicado.

### Validación de empaquetado en este entorno

- `yarn tsc && yarn lint && yarn test run && yarn build`: todo en verde (los avisos de `TSSatisfiesExpression` en `lint` son los ya documentados, ajenos a esta tarea).
- **Linux**: `node_modules/.bin/electron-builder --linux AppImage tar.bz2 --x64 --publish never` (con `ffmpeg/linux-x64/lib` ya descargado en el entorno) generó:
  - `dist/VideoMix-linux-x86_64.AppImage` (≈204 MB). Verificado con `--appimage-extract`: contiene `videomix` (ejecutable), `videomix.desktop` (generado por electron-builder, con `Name=VideoMix`, `Comment`, `MimeType=application/x-videomix-project;`, `Icon=videomix`), el icono `usr/share/icons/hicolor/512x512/apps/videomix.png` (512×512, el SVG nuevo), `resources/app.asar`, y `resources/ffmpeg` + `resources/ffprobe` + las librerías `libav*`/`libsw*` compartidas.
  - `dist/VideoMix-linux-x64.tar.bz2`: se generó correctamente, pero la compresión `bzip2 -mx=9` de ~576 MB (el `.tar` sin comprimir, dominado por las librerías de ffmpeg) tardó varios minutos de CPU en este entorno; no es un problema de configuración, es simplemente lento a máxima compresión con estos binarios.
  - No hizo falta red para binarios de electron-builder: `electron`, `7za`, el runtime de AppImage, etc. ya estaban en la caché local (`~/.cache/electron-builder`) de este entorno.
- **Windows**: no se puede generar ni ejecutar un instalable real en este entorno (no hay Wine ni binarios de ffmpeg para `win32-x64`/`win32-arm64` descargados). Para comprobar que la configuración es coherente se ejecutó `node_modules/.bin/electron-builder --win --x64 --publish never --dir` (empaquetado sin comprimir, sin firmar): terminó sin errores y generó `dist/win-unpacked/VideoMix.exe` correctamente; el único aviso fue `file source doesn't exist from=.../ffmpeg/win32-x64/lib` (esperado, porque no se descargó ese ffmpeg en este entorno). Esto confirma que `build.win` (target `zip`/`7z`, `fileAssociations` con `.vmx`, icono `.ico`) es válido para electron-builder. No se ha comprobado la firma de código ni un build real de `zip`/`7z` (no cambia respecto al `.exe` sin comprimir ya verificado).

### Decisiones

- Se han quitado `mac`/`mas`/`appx`/`snap` de `build` por completo (en vez de dejarlos deshabilitados de algún modo) porque la decisión del usuario dice explícitamente "sin Mac, sin Microsoft Store (appx), sin Mac App Store y sin snap", y dejar esas claves sin usar sería confuso para quien lea `package.json`.
- Se ha preferido **quitar** `icon-mac.svg` y la generación de `.icns`/PNGs de Windows Store en vez de dejarlos "por si acaso": quedaban sin ningún consumidor (ni build, ni código, ni docs) tras quitar `mac`/`mas`/`appx`.
- Se han dejado sin tocar los `entitlements.mas*.plist` y `isStoreBuild.ts`: son inertes sin un target `mas`/`appx` configurado y tocarlos añadiría cambios no pedidos por la tarea (ficheros `.plist` "documentan" un mecanismo de firma de Apple que podría interesar mantener si algún día se reactiva `mas`, y `isStoreBuild.ts` ya se usa para lógica genérica del About panel y del menú, no solo para builds de tienda).
- **`mimeType` de `.vmx` en Linux**: se ha elegido `application/x-videomix-project` (formato `application/x-<nombre>`, sin registrar en IANA, igual que hacen muchas apps con sus propios formatos de proyecto) en vez de dejarlo sin `mimeType` (como las asociaciones de vídeo/audio existentes), porque la tarea pide explícitamente que la asociación de `.vmx` tenga tipo MIME en el `.desktop`.
- **Contenido de `net.wizardy.videomix.appdata.xml`**: se ha optado por resetear `<releases>` a la versión actual (`0.1.0`) en vez de mantener el historial de LosslessCut (que no corresponde a este fork) o dejarlo vacío. Se ha quitado el `<url type="donation">` de PayPal (no aplica a VideoMix) y el `<screenshot>` (apuntaba a una captura de LosslessCut que ya no representa la app).

### Desviaciones y dudas de requisitos

- La decisión de usuario dice "Windows (zip/7z)"; el `package.json` original solo tenía `7z` + `appx` para Windows (nunca `zip`). Se ha interpretado como "ambos formatos deben quedar disponibles" y se han configurado los dos (`zip` y `7z`) para `x64` y `arm64`, en vez de elegir solo uno. Si se prefiere un único formato para simplificar el CI/las descargas, es un cambio de una línea en `build.win.target`.
- No se ha tocado el objetivo `arm64`/`armv7l` de Linux ni `arm64` de Windows (se han mantenido tal cual estaban, solo quitando `appx`/`snap`): la tarea no pedía reducir arquitecturas, solo tiendas/plataformas. No se han podido probar esos targets en este entorno (falta ffmpeg para esas arquitecturas y no hay hardware/qemu para ejecutarlos).
- No se ha reactivado ningún workflow de CI de build, conforme a la decisión del usuario ("CI: no se reactiva ningún workflow de build").

## Revisión

- **Resultado**: aceptada. AppImage y `tar.bz2` de Linux construidos y verificados (contienen la app, ffmpeg y el icono). La configuración de Windows se ha validado con `--dir`. `tsc`, `lint`, tests y `check-licenses` en verde.
- **Desviaciones aceptadas**:
  - Windows genera zip y 7z.
  - Se añaden `desktopName` / `syncDesktopName`.
  - En el `appdata.xml` se limpian los *releases* y la donación de LosslessCut.
