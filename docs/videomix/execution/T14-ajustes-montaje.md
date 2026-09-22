# T14 · Diálogo de ajustes de montaje

- **Hito**: M4 · **Modelo**: Sonnet · **Depende de**: T04 · **Estado**: pendiente

## Objetivo

Diálogo para editar todos los `MixSettings` del proyecto.

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) §4, §5, §6
- [04-diseno](../04-diseno.md) §1.2 (`MixSettings` y valores por defecto)
- [02-as-built](../02-as-built.md) §9: patrón de `components/Settings.tsx` y componentes base `Select`, `Switch`, `Button`, `TextInput` y `Dialog`
- [03-convenciones](../03-convenciones.md) §3, §7

## Alcance

1. **`videomix/components/MixSettingsDialog.tsx`** (`Dialog` de Radix controlado por estado), organizado por secciones.

   | Sección | Ajustes |
   |---|---|
   | Salida | resolución (720p / 1080p / 4K), fps, CRF (0–51, con explicación breve), preset |
   | Composición | máximo de columnas (1–6), separación (px + color), relleno (desenfoque o color + color) |
   | Orden | lista o aleatorio, semilla con botón "Barajar de nuevo", ventana de reorden (0–10) |
   | Transición | tipo (lista de `TransitionType` con nombres legibles) y duración (0,1–2 s), fade in/out global |
   | Música | seleccionar o quitar fichero (diálogo con filtro de audio), volumen en dB (−30…+6) y "Repetir" |

2. Cada cambio pasa por `updateSettings`, así que queda en el historial y marca el proyecto como sucio.
3. Se abre desde el menú Project → "Mix settings…" y desde un botón de la UI VideoMix.
4. Textos con `t()` en inglés; la traducción al español se hace en T17.

## Criterios de aceptación

- Los cambios se guardan en el `.vmx` y se restauran al abrir.
- `yarn tsc && yarn lint && yarn test run` en verde.
- Instrucciones de prueba manual en las notas.

## Notas de ejecución

## Revisión
