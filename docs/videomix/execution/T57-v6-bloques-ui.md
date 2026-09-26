# T57 · v6: bloques en la interfaz (H1, H5, H6, H8)

- **Hito**: M13 · **Modelo**: Opus · **Depende de**: T56 · **Estado**: en curso

## Contexto (leer antes de empezar)

- [01-requisitos](../01-requisitos.md) **§9 (overlays) y §14 (v6)**, [03-convenciones](../03-convenciones.md), [04-diseno](../04-diseno.md) (overlays, §1.2 modelo).
- Notas de T56 (contratos), T22 (pistas de overlays en la vista Mix y panel de propiedades), T53 (filas y zoom de la vista Mix), T51 (atajos y deshacer).

## Alcance

1. **Selección múltiple** de overlays (Ctrl/Mayús+clic) en la vista Mix y donde se listen.
2. **Agrupar en bloque**, desagrupar, renombrar, color, duplicar, borrar; el bloque se ve como una pieza en su pista y **se arrastra entero**; plegar/desplegar; **editar un miembro dentro** (panel de propiedades del miembro, con aviso si es una instancia enlazada: cambia todas).
3. **Repetir** (H5): diálogo "N veces cada X s" o "al inicio de cada clip seleccionado"; indicador de instancia enlazada; **Desvincular**.
4. **Estirar** (H6): "Duración del bloque…".
5. **Ocultar / bloquear** (H8).
6. **Variables** (H4): editar los valores de una instancia en su panel.
7. **Pendientes de T56**: orden de capas de los bloques ("Traer al frente / Enviar atrás", `moveBlockLayer`); desagrupar un bloque oculto (avisar o impedir); respetar `locked` (no mover ni editar); reajustar las imágenes de los bloques al cambiar la proporción de salida en Ajustes, igual que las sueltas; destinos de ancla que conozcan los bloques (`canOverlayDependOn`); traducción de los códigos `block-*` de validación; mostrar ficheros de miembros que faltan.
8. Deshacer en un paso por acción; i18n (en + es); e2e.

## Criterios de aceptación

- `yarn tsc && yarn lint && yarn test run && yarn build && yarn test-e2e` en verde; capturas revisadas.

## Notas de ejecución

## Revisión
