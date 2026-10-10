# Publicar Nexo Solar en Vultr

La aplicación corre en un contenedor Node.js: dashboard en `/`, portal en `/portal`
y API en `/api`. Caddy recibe las visitas y gestiona HTTPS. PostgreSQL sigue en
Tiger Data; Gemini sigue siendo una API externa. Se ejecuta una sola instancia
del backend para no duplicar el seguimiento del asistente.

## 1. Servidor

En Vultr crea un servidor Cloud Compute con Ubuntu y la aplicación Docker del
Marketplace. Para esta demo propongo 2 GB de RAM; comprueba el precio y tus créditos
en la consola antes de crearlo. La compilación del frontend también consume memoria.

Configura acceso SSH con una clave. Permite TCP 80 y 443 para las visitas, y TCP 22
para SSH desde tu IP. El backend no publica el puerto 3001. Si hay firewall tanto
en Vultr como en Ubuntu, las reglas deben permitir el tráfico en ambos.

Conéctate usando el usuario indicado por Vultr:

```bash
ssh USUARIO@IP_DEL_SERVIDOR
```

## 2. Código y configuración

En el servidor:

```bash
git clone https://github.com/luisangelhdzz/nexo-solar.git
cd nexo-solar
cp backend/.env.example backend/.env
cp deploy/vultr.env.example deploy/vultr.env
chmod 600 backend/.env deploy/vultr.env
nano backend/.env
```

Completa en `backend/.env`:

- `DATABASE_URL`: Service URL completo de Tiger Data.
- `DATABASE_SSL=true` y `DATABASE_SSL_CA_FILE=certs/tiger-ca.crt`.
- `ADMIN_PASSWORD`: contraseña exclusiva para la consola del equipo. Es obligatoria
  en este despliegue; no uses la contraseña de la base de datos.
- `AI_PROVIDER=gemini`, `GEMINI_API_KEY` y `GEMINI_MODEL`: usa el modelo que haya
  pasado `ai:check` con tu clave, sin sustituirlo por el ejemplo si no está disponible.
- `ASSISTANT_AUTOPILOT=draft`: solo borradores. Compose también fija este modo
  mediante `deploy/vultr.env`.
- Si usan Gmail: `N8N_WEBHOOK_URL` público HTTPS y `N8N_WEBHOOK_SECRET`.

No subas esos archivos a GitHub. No hay que descargar nuevamente el certificado:
`backend/certs/tiger-ca.crt` viene en el repositorio y en la imagen.

Edita `deploy/vultr.env` y establece `SITE_ADDRESS` con tu dominio. Crea en su DNS
un registro A que apunte a la IP pública del servidor (y elimina registros AAAA
que apunten a otra máquina). Los puertos 80 y 443 deben estar disponibles para Caddy.

## 3. Arranque y verificación

Desde la raíz del repositorio:

```bash
docker compose --env-file deploy/vultr.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/vultr.env -f deploy/compose.yaml ps
docker compose --env-file deploy/vultr.env -f deploy/compose.yaml logs --tail=80 app web
```

Al arrancar el backend verifica PostgreSQL y crea las tablas faltantes sin borrar
datos. En los logs debe aparecer `Almacenamiento: PostgreSQL` y el asistente en
modo borrador. Caddy puede tardar unos minutos en obtener el certificado.

Comprueba `https://TU_DOMINIO/api/health`, que debe devolver `{"ok":true}`. Abre
`https://TU_DOMINIO/` para la consola y `https://TU_DOMINIO/portal#/cotizar` para el
formulario. Verifica que la consola pide contraseña y realiza una solicitud de
prueba para comprobar que aparece en el dashboard.

La demo del portal permite seleccionar empresas ficticias: aún no tiene login
individual para clientes. Presenta datos ficticios hasta añadir esa autenticación.

## 4. Actualizaciones

```bash
git pull --ff-only
docker compose --env-file deploy/vultr.env -f deploy/compose.yaml up -d --build
```

Si el pull encuentra cambios locales, revísalos antes de continuar. Las credenciales
se conservan en los archivos ignorados. No ejecutes una segunda copia del backend
con `npm run dev:backend` en este servidor.

Referencias: [Docker en Vultr](https://docs.vultr.com/how-to-use-vultrs-docker-marketplace-application),
[HTTPS en Caddy](https://caddyserver.com/docs/quick-starts/https).
