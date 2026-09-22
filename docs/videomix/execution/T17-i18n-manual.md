# T17 · i18n (es), atajos y manual de usuario

- **Hito**: M5 · **Modelo**: Sonnet · **Depende de**: T16 · **Estado**: pendiente

## Objetivo

Dejar la UI de VideoMix traducida al español, los atajos revisados y un manual de usuario.

## Contexto (leer antes de empezar)

- [03-convenciones](../03-convenciones.md) §7

## Alcance

1. Ejecuta `yarn scan-i18n` y traduce al español en `locales/es/translation.json` **todas** las claves nuevas de VideoMix. Revisa también que las claves de LosslessCut que siguen visibles tengan traducción.
2. Revisa el diálogo de atajos (`KeyboardShortcuts.tsx`): que las acciones nuevas aparezcan con nombre y categoría.
3. Escribe `docs/videomix/manual-usuario.md` en español: crear un proyecto, añadir fuentes, crear clips (tiempo y rectángulos máx./mín.), orden, ajustes de montaje, previsualizar y montar, música y atajos.

## Criterios de aceptación

- Con el idioma en español, la UI de VideoMix no muestra textos en inglés.
- `yarn tsc && yarn lint && yarn test run` en verde.

## Notas de ejecución

## Revisión
