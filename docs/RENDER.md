# Publicar Nexo Solar en Render Free

Render aloja un único servicio Node.js con la consola, el portal y la API. La base
de datos permanece en Tiger Data y Gemini sigue configurado en el backend.
Render proporciona una dirección `onrender.com` y HTTPS: no necesitamos un
servidor Vultr, Docker, Caddy, dominio propio ni configurar SSH.

## 1. Cuenta y repositorio

1. Regístrate en https://dashboard.render.com/register con GitHub.
2. En el panel selecciona **New → Blueprint**.
3. Autoriza acceso al repositorio `luisangelhdzz/nexo-solar`. Si no aparece porque
   no tienes permisos suficientes, Luis puede conectar el repositorio desde su
   cuenta de Render. No es necesario compartir contraseñas de GitHub.
4. Selecciona la rama `main` y el archivo `render.yaml` de la raíz.
5. Confirma que se muestra únicamente el servicio web `nexo-solar`, plan **Free**.
   Esta configuración no crea otra base de datos.

## 2. Credenciales

Render pedirá estos valores. Introdúcelos directamente en su panel:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La misma URL completa de Tiger Data configurada en `backend/.env` |
| `GEMINI_API_KEY` | La misma clave de Gemini de `backend/.env` |
| `ADMIN_PASSWORD` | Una contraseña exclusiva para entrar a la consola del equipo |

El Blueprint ya establece SSL, la ruta del certificado incluido en el repositorio,
el modelo `gemini-3.5-flash-lite` que pasó la prueba real y el modo `draft` del
asistente. La contraseña de la consola no es la de PostgreSQL.

Si usan Gmail mediante n8n, después agrega `N8N_WEBHOOK_URL` y
`N8N_WEBHOOK_SECRET` en **Environment**. El webhook debe ser público HTTPS.

No subas el `.env` a GitHub. Tampoco copies `PORT=3001`: Render proporciona el
puerto mediante su propia variable `PORT`. No hace falta una variable de URL
del backend en el frontend, porque ambos usan la misma dirección y `/api`.

## 3. Despliegue y verificación

Inicia el despliegue del Blueprint. Render instala las dependencias con `npm ci`,
compila React y arranca Express desde `backend/`. El script de arranque exige
`DATABASE_URL` y `ADMIN_PASSWORD`, evitando publicar una consola desprotegida o
usar almacenamiento en memoria por error.

En los logs deben aparecer:

- `Almacenamiento: PostgreSQL`.
- `Consola protegida con contraseña: sí`.
- Gemini como proveedor y el asistente en modo borrador.

El backend crea tablas faltantes sin borrar datos existentes. `SEED_DEMO=false`
evita cargar automáticamente otra demo. Al usar la misma base compartida, las
solicitudes de la web también se verán desde el dashboard local del equipo.

Cuando Render indique que está **Live**, abre:

- `https://TU-SERVICIO.onrender.com/api/health`: debe devolver `{"ok":true}`.
- `https://TU-SERVICIO.onrender.com/`: consola con contraseña.
- `https://TU-SERVICIO.onrender.com/portal#/cotizar`: formulario del cliente.

Envía una solicitud ficticia desde el portal y comprueba que aparece en el
dashboard. Revisa un caso con el panel del asistente para verificar Gemini.

El portal aún usa selección de empresas ficticias, sin autenticación individual
de clientes. Este despliegue sirve para presentar el prototipo con datos ficticios.

## 4. Límites de Free y seguimiento

Render Free se duerme después de 15 minutos sin visitas y tarda aproximadamente
un minuto en despertar. Mientras duerme, los temporizadores del asistente no
ejecutan revisiones. Los datos permanecen en Tiger Data. Abre la aplicación antes
de la presentación; este plan no garantiza seguimiento autónomo continuo.

La configuración mantiene `ASSISTANT_AUTOPILOT=draft`. Si alguien sigue ejecutando
un backend local con modo `draft`, ambos pueden generar borradores en la base
compartida. Para centralizar el seguimiento, cambia **solo el `.env` local** a
`ASSISTANT_AUTOPILOT=off` y reinicia ese backend. El equipo puede trabajar desde
la dirección de Render. No habilites múltiples instancias en modo `auto`.

Los nuevos commits en `main` pueden desplegarse automáticamente desde GitHub.
Las credenciales permanecen en las variables de Render.

Referencias: [primer despliegue](https://render.com/docs/your-first-deploy),
[Blueprints](https://render.com/docs/blueprint-spec),
[límites gratuitos](https://render.com/docs/free).
