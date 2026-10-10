# Casos para presentar Nexo Solar

Los seis negocios son ficticios. Comparten la misma base Tiger Data que usa Render.

| Caso | Negocio | Situación | Qué mostrar |
| --- | --- | --- | --- |
| DEMO-01 | Abarrotes El Sol | Solicitud sin gasto de luz | El motor pide información y Gemini prepara un borrador para pedir el recibo. |
| DEMO-02 | Taller Horizonte | Pregunta sobre instalación | El asistente ayuda a resolver la duda; el equipo revisa el borrador antes de enviarlo. |
| DEMO-03 | Hotel Sierra Clara | Pide contacto dentro de tres días | Se espera hasta la fecha registrada; no se envía seguimiento antes. |
| DEMO-04 | Clínica Buen Día | Duda de financiamiento y contacto no autorizado | Se deriva al equipo; el sistema bloquea el contacto. |
| DEMO-05 | Panadería La Espiga | Venta ganada por ahorro esperado | El cierre conserva el motivo y detiene el seguimiento. |
| DEMO-06 | Ferretería Los Pinos | Venta perdida por precio | El cierre conserva la explicación y alimenta Aprendizaje. |

## Recorrido para la presentación

1. Abre el Dashboard y muestra cuatro casos abiertos y dos cerrados.
2. En Cotizaciones abre DEMO-01 y DEMO-02: revisa siguiente paso y propuesta del asistente.
3. Abre DEMO-03 y DEMO-04 para explicar que la IA respeta restricciones del cliente.
4. En Resultados revisa la venta ganada y la perdida, con sus motivos.
5. Abre Aprendizaje: muestra las conclusiones de los dos cierres. Son ejemplos; no prueban tendencias estadísticas.

Gemini interpreta y redacta; el motor aplica las reglas y valida si se puede actuar. En modo `draft` solo se preparan borradores. No se reentrena el modelo: se le proporciona contexto y ejemplos al consultarlo.

## Volver a cargar estos escenarios

Este comando reemplaza todos los datos de Nexo Solar en la base configurada. Coordina con el equipo, pausa los backends y el asistente en Render antes de usarlo. Guarda y verifica un respaldo SQL privado en `backups/` antes de borrar; la carga completa ocurre en una transacción.

Desde la raíz:

```bash
npm run db:presentation --prefix backend -- --reset
```

El comando lee `backend/.env`. También puedes ejecutarlo desde `backend`:

```bash
cd backend
npm run db:presentation -- --reset
```

Después reactiva el asistente en `draft`, reinicia el backend y recarga la consola. Las fechas se calculan al cargar: el plazo de DEMO-03 vence tres días después.

## Recuperar el respaldo

Los respaldos están excluidos de Git. No contienen la URL de conexión, pero sí los datos anteriores: guárdalos de forma privada.

Con los backends pausados, usa SQLTools sobre la misma base para ejecutar el archivo `.sql` completo del respaldo. Incluye una transacción, los datos de las once tablas y la recuperación de las secuencias. Reemplaza el contenido actual. Si el archivo es grande, usa `psql` con la conexión privada configurada y `-v ON_ERROR_STOP=1 -f ruta-del-respaldo.sql`. Después reactiva los servicios.
