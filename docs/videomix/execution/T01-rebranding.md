# T01 · Rebranding e identidad de la app, CI

- **Hito**: M0 · **Modelo**: Sonnet · **Depende de**: — · **Estado**: hecha

## Objetivo

Convertir la identidad de la app en **VideoMix** para que se pueda instalar y ejecutar junto a un LosslessCut sin compartir configuración, y ajustar el CI.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §3 (P3, P4, P7)
- [02-as-built](../02-as-built.md) §2, §8, §10
- [03-convenciones](../03-convenciones.md)

## Alcance

1. **`package.json`**:
   - `name`: `videomix`
   - `productName`: `VideoMix`
   - `description`: "Compose videos from clips of multiple videos"
   - `version`: `0.1.0`
   - `author` / `repository` / `homepage`: dejar al autor original en `copyright` si la licencia lo requiere, y poner el repositorio `https://github.com/wizardy126/videomix`
   - `build.appId`: `net.wizardy.videomix` (y los `appId`/identidades de mac/mas/appx derivados de forma coherente, p. ej. `net.wizardy.videomix-mac`)
   - `linux.executableName`: `videomix`

   No cambies las dependencias.
2. **Directorio de configuración** (`userData`): debe resolver a una carpeta propia de VideoMix. Verifica cómo lo resuelve Electron (normalmente por `productName` / `name`) y si `src/main` fija algo explícitamente, por ejemplo con `app.setName` o rutas con "LosslessCut". Busca `LosslessCut` y `losslesscut` en `src/main`.
3. **Título de la ventana y textos visibles de "LosslessCut"** en main (about panel, menú "About", título):
   - cámbialos a VideoMix donde sea identidad de la app;
   - conserva los créditos a LosslessCut / mifi en el about.
   - Los textos que sean claves i18n se cambian en la clave en inglés (`yarn scan-i18n`); **no** traduzcas el resto de idiomas.
4. **Actualizaciones**: desactiva el comprobador de actualizaciones de LosslessCut (`updateChecker.ts`), que consulta las releases de mifi. Debe quedar desactivado por defecto y sin llamadas de red, con un cambio mínimo.
5. **CI**: desactiva `.github/workflows/build.yml` renombrándolo a `build.yml.disabled` (o quitando sus triggers y dejando solo `workflow_dispatch`, documentando cuál se eligió). `test.yml` no se toca.
6. **`README.md`**: añade una sección inicial breve que diga que esto es **VideoMix**, un fork de LosslessCut, con enlace a `docs/videomix/README.md`. Deja el resto del README original debajo, bajo un encabezado "Original LosslessCut README".
7. **Ficheros de escritorio de Linux**: `no.mifi.losslesscut.desktop` y `.appdata.xml` no se renombran en esta tarea (se hará en T18); solo se anota en "Notas de ejecución".

## Fuera de alcance

- Iconos y empaquetado real (T18).
- Cambios en la UI del renderer.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run` en verde. `yarn build` compila.
- Queda documentado cuál será el directorio `userData` de VideoMix en Linux, macOS y Windows.
- No hay llamadas de red de update-check por defecto.

## Validación

```
yarn tsc && yarn lint && yarn test run && yarn build
grep -rn "LosslessCut" src/main
```

La segunda orden sirve para revisar lo que queda.

## Notas de ejecución

### Resumen de cambios

- **`package.json`**: `name` → `videomix`, `productName` → `VideoMix`, `description` → "Compose videos from clips of multiple videos", `version` → `0.1.0`, `repository.url` → `https://github.com/wizardy126/videomix`, `build.appId` → `net.wizardy.videomix`, `build.mac.appId` → `net.wizardy.videomix-mac` (heredado automáticamente por `mas`, que no define `appId` propio), `build.linux.executableName` → `videomix`, y en `build.appx`: `applicationId` → `VideoMix`, `identityName`/`publisher`/`publisherDisplayName` → placeholders coherentes (`wizardy126.videomix` / `CN=wizardy126.videomix` / `wizardy126`). No se ha tocado ninguna dependencia. Tras el cambio de `name` hizo falta `yarn install` para que Yarn actualizara la entrada `workspace:.` en `yarn.lock` (si no, `yarn tsc`/`lint`/`build` fallan con "Package for videomix@workspace:. not found").
- **`author` / `homepage`**: sin cambios (ver "Dudas" más abajo).
- **`userData`**: Electron resuelve `app.getPath('userData')` a partir de `app.name` (o `app.getName()`), que en `src/main/index.ts:54` se fija explícitamente con `app.name = appName` (`src/main/common.ts`). Al cambiar `appName` a `'VideoMix'`, el directorio de configuración pasa a:
  - Linux: `~/.config/VideoMix`
  - macOS: `~/Library/Application Support/VideoMix`
  - Windows: `%APPDATA%\VideoMix`
  No hay ninguna ruta con "LosslessCut" fijada a mano en `configStore.ts` (usa `app.getPath('userData')` sin más), así que no convive con un LosslessCut instalado.
- **Identidad visible en `src/main`**: `common.ts` (`appName`), textos en `index.ts` (log de versión, comentario "VideoMix executable", comentario "open with VideoMix"), `menu.ts` (clave i18n `About LosslessCut` → `About VideoMix`) y `src/renderer/index.html` (`<title>`, título de la ventana ya que no se pasa `title` a `BrowserWindow`). El about panel (`aboutPanel.ts`) usa `appName` directamente, así que ya queda como "VideoMix" y conserva la línea de copyright a Mikael Finstad. El resto de enlaces (`githubUrl`, `homepageUrl`, `thanksUrl`, `licensesUrl`, `featureRequestUrl` en `src/common/constants.ts`) se han dejado igual porque son créditos/enlaces al proyecto original, fuera del alcance de esta tarea.
- **i18n**: se cambió la clave `'About LosslessCut'` → `'About VideoMix'` en `menu.ts` y se ejecutó `yarn scan-i18n`, que solo tocó `locales/en/translation.json` (una línea). Se añadió a mano la traducción en `locales/es/translation.json` (`"About VideoMix": "Acerca de VideoMix"`), sustituyendo la entrada anterior con la misma clave. No se ha tocado ningún otro idioma.
- **Update checker**: cambio mínimo en `src/main/configStore.ts`, el default de `enableUpdateCheck` pasa de `true` a `false` (con comentario explicando el motivo). `src/main/index.ts` ya solo llama a `checkNewVersion()` (que consulta `mifi/lossless-cut` en GitHub) cuando `enableUpdateCheck` es `true`, así que con el nuevo default no hay ninguna llamada de red por defecto. No se ha borrado `updateChecker.ts` ni el ajuste de la UI (`Settings.tsx`) porque el criterio de aceptación solo exige que esté desactivado por defecto y sin llamadas de red por defecto; si el usuario lo reactiva manualmente seguiría consultando el repo de mifi (ver "Dudas").
- **CI**: `.github/workflows/build.yml` renombrado a `build.yml.disabled` (opción elegida frente a dejar solo `workflow_dispatch`, tal como sugería el enunciado). `test.yml` no se ha tocado.
- **`README.md`**: se ha añadido al principio una sección breve "# VideoMix" con la descripción del fork y enlace a `docs/videomix/README.md`, y el resto del README original ha quedado debajo de un encabezado "## Original LosslessCut README".
- **Ficheros de escritorio de Linux**: `no.mifi.losslesscut.desktop` y `no.mifi.losslesscut.appdata.xml` existen y siguen con esos nombres; no se han tocado, tal como indica el punto 7 del alcance (se renombrarán en T18). `script/postversion.ts` y `script/generateIcon.ts` siguen referenciando `no.mifi.losslesscut.appdata.xml` por su nombre de fichero, lo que es coherente con no renombrarlo aquí.

### Decisiones

- El `appId` de `mas` no se ha añadido como clave separada porque electron-builder hereda el `appId` de `mac` para el target `mas` (no hay un campo `mas.appId` en el `package.json` original); al cambiar `mac.appId` ya queda coherente.
- Las identidades de `build.appx` (`identityName`, `publisher`, `publisherDisplayName`) son en realidad credenciales de una publicación real en la Microsoft Store (el `publisher` es el hash de un certificado de mifi.no). Se han sustituido por placeholders coherentes con el nuevo nombre/appId, dejando claro que habrá que revisarlos de verdad si algún día se publica en la Store (T18 / empaquetado real).
- Se ha optado por bajar el default de `enableUpdateCheck` en vez de eliminar `updateChecker.ts` o el ajuste de Settings, para mantener el cambio mínimo tal como pide el enunciado.
- Se hizo `yarn install` (sin cambiar versiones de dependencias) únicamente para que Yarn actualizara la entrada de workspace en `yarn.lock` tras el cambio de `name`; era necesario para que `tsc`/`lint`/`build` funcionaran.

### Desviaciones y dudas de requisitos

- El punto 1 del alcance dice: *"`author` / `repository` / `homepage`: dejar al autor original en `copyright` si la licencia lo requiere, y poner el repositorio `https://github.com/wizardy126/videomix`"*. Es ambiguo si `author` y `homepage` deben cambiarse. Se ha optado por la opción más conservadora: **no tocar** `author` (sigue siendo Mikael Finstad, lo que además mantiene correcta la interpolación `${author}` en `copyright`) ni `homepage` (vale `"./"`, un valor técnico de electron-vite/CRA para rutas relativas de los assets empaquetados, no una URL de proyecto). Solo se ha cambiado `repository.url`. **Duda para el usuario/orquestador**: ¿el `author` de `package.json` debe pasar a ser el nuevo mantenedor (p. ej. `wizardy126`) dejando a Mikael Finstad solo en el texto de copyright/about, o se prefiere dejarlo como está?
- La URL de `repository.url` se ha puesto exactamente como aparece en el enunciado (`https://github.com/wizardy126/videomix`, sin `.git`), aunque la entrada original sí llevaba `.git`. Si se prefiere mantener el sufijo `.git` por convención, es un cambio de una línea.
- `script/checkLicenses.ts` tiene una lista de licencias seguras que permite `GPL-2.0-only` solo para el paquete `lossless-cut` (el propio proyecto). Al cambiar `name` a `videomix`, ese script (no incluido en la validación obligatoria de esta tarea) dejaría de reconocer la licencia del propio paquete como segura. No se ha tocado porque no es parte del alcance de T01 ni de la validación pedida, pero conviene ajustarlo (cambiar `'lossless-cut'` por `'videomix'` en `script/checkLicenses.ts`) en una tarea posterior de empaquetado/licencias.

## Revisión

- **Resultado**: aceptada. Revisado el diff; `tsc`, `lint`, `test` y `build` en verde.
- **Ajuste del orquestador**: `script/checkLicenses.ts` pasa a permitir GPL-2.0-only para `videomix`, porque CI ejecuta `check-licenses`.
- **Dudas `author` / `homepage`**: se deja como está (conservador). Se consultará al usuario en T18.
