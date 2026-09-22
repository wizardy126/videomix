# T01 · Rebranding e identidad de la app, CI

- **Hito**: M0 · **Modelo**: Sonnet · **Depende de**: — · **Estado**: pendiente

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

## Revisión
