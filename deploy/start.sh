#!/bin/sh
set -eu

# Impide publicar una consola sin contraseña o perder datos usando memoria.
if [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "Falta ADMIN_PASSWORD: configura la contraseña de la consola en las variables del servicio." >&2
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "Falta DATABASE_URL: el despliegue requiere PostgreSQL persistente." >&2
  exit 1
fi
exec node src/server.js
