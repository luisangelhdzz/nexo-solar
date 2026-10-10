# Certificado de la base de desarrollo

`tiger-ca.crt` contiene únicamente la CA pública privada de Timescale presentada por el servicio Shared durante el diagnóstico del 10 de octubre de 2026. No contiene contraseñas ni claves privadas.

La confianza inicial se estableció a partir de la cadena presentada por el endpoint configurado (trust on first use), no desde un certificado descargado por un canal independiente. La CA coincidió con la observada en el diagnóstico anterior; se comprobaron la firma del certificado del servidor y su hostname. Queda pendiente confirmar su huella con soporte de Tiger Data antes de usar datos reales en producción.

Huella SHA-256 de la CA:

```
06:5A:75:0D:0D:64:F6:2D:AC:DC:97:9E:3B:83:D2:11:95:40:71:EA:59:B8:F3:40:7C:4E:87:CA:68:34:64:57
```

Caducidad de la CA: 20 de octubre de 2027 (UTC).

En `backend/.env`:

```dotenv
DATABASE_URL=URL_PRIVADA_DEL_SERVICIO
DATABASE_SSL=true
DATABASE_SSL_CA_FILE=certs/tiger-ca.crt
```

La ruta del certificado se resuelve respecto a `backend/`. El adaptador exige validación de firma y hostname y usa esta CA solo en su conexión PostgreSQL, sin instalarla en el sistema. Si el proveedor cambia la CA, obtener y verificar la nueva antes de reemplazar el archivo. No desactivar la verificación SSL.

Desde la raíz del repositorio:

```bash
npm run db:init --prefix backend
npm run dev:backend
```

Cada colaborador y despliegue debe configurar sus variables de entorno; `.env` no se comparte por Git. Al desplegar, incluir también el archivo de CA y mantener su ruta relativa a `backend/`.
