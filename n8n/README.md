# Correos al cliente con n8n

El backend le manda al cliente **tres correos**. Cada uno ya va armado (destinatario, asunto, HTML y texto) y **n8n solo lo entrega** con tu cuenta de correo.

| Momento | Evento | Correo |
|---|---|---|
| El cliente pide su cotización en el portal | `solicitud.recibida` | "Recibimos tu solicitud": folio y resumen de lo que escribió |
| El equipo publica la propuesta en la consola | `propuesta.enviada` | "Tu propuesta está lista": título, solución, precio con IVA, alcance y botón al portal |
| El cliente acepta y compra | `compra.completada` | Comprobante de compra con IVA desglosado (se manda solo al correo de la solicitud) |

```
Portal / consola → Backend → POST al webhook de n8n (con secreto) → Gmail o SMTP → bandeja del cliente
```

**Reglas que siempre se respetan**

- Los correos automáticos respetan lo que pidió el cliente. Si dijo que no lo contacten (R2), pidió esperar hasta una fecha (R3) o lo pidió en un mensaje, el correo no sale y la consola dice por qué. El comprobante se queda en el portal y el cliente lo puede pedir con un clic.
- El agente de IA **nunca** manda correos.
- La propuesta solo se manda si las reglas permiten publicarla, y nunca dos veces.
- Si n8n falla o tarda, el cliente no se entera: se reintenta una vez y la consola muestra el estado en **Correos al cliente**.
- Como el portal es público, cada dirección recibe como máximo 3 acuses de solicitud por hora (evita que alguien lo use para llenar de correos la bandeja de otra persona).
- Es un **comprobante de demostración**, no una factura fiscal (CFDI).

## 1. ¿Dónde corre n8n?

El backend tiene que poder llamar al webhook de n8n.

| Tu backend | Usa | Para mandar correo |
|---|---|---|
| **En Render** (la app publicada) | **n8n Cloud** (prueba gratis de 14 días, 1,000 ejecuciones) | Gmail con "Sign in with Google" (un clic) → flujo `nexo-solar-correos.json` |
| **En tu Mac** (`npm start`) | `npx n8n` en tu Mac (http://localhost:5678) | SMTP con una contraseña de aplicación de Gmail → flujo `nexo-solar-correos-smtp.json` |

Un n8n en tu Mac **no** es alcanzable desde Render. Para la app publicada usa n8n Cloud (o un n8n propio con dirección pública).

## 2. Crea el secreto compartido

Es una contraseña larga que solo conocen el backend y n8n. Sin ella, cualquiera que conozca la URL podría mandar correos con tu cuenta. Genérala en la terminal:

```bash
openssl rand -hex 24
```

Cópiala; la vas a pegar en dos lugares (pasos 3 y 5). **No la subas a GitHub ni la mandes por chat.**

## 3. Importa el flujo en n8n

1. En n8n: **Create workflow** → menú **⋯** → **Import from File** → elige el archivo según la tabla del paso 1.
2. Abre el nodo **Webhook (Nexo Solar)** → en **Credential for Header Auth** elige **Create new credential**:
   - **Name:** `x-nexo-secret`
   - **Value:** el secreto del paso 2
3. Abre el nodo de envío:
   - **Enviar por Gmail** (n8n Cloud): **Create new credential** → **Sign in with Google** → elige la cuenta que enviará los correos.
   - **Enviar por SMTP** (n8n en tu Mac): **Create new credential** con Host `smtp.gmail.com`, Port `465`, SSL/TLS activado, User = tu Gmail y Password = una **contraseña de aplicación** (en tu cuenta de Google: Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones). Después cambia `TU_CORREO@gmail.com` en **From Email** por ese mismo Gmail.
4. Guarda y **publica** el flujo (botón **Publish**; en versiones anteriores de n8n, interruptor **Active**).
5. Abre otra vez el nodo Webhook y copia la **Production URL**. Termina en `/webhook/nexo-solar-correos`; no uses la Test URL (`/webhook-test/...`).

## 4. Prueba solo n8n (opcional)

```bash
curl -X POST "PEGA_AQUI_LA_PRODUCTION_URL" \
  -H 'content-type: application/json' \
  -H "x-nexo-secret: PEGA_AQUI_TU_SECRETO" \
  -d '{"event":"prueba","email":"tucorreo@gmail.com","subject":"Prueba Nexo Solar","html":"<p>Hola desde Nexo Solar</p>","text":"Hola desde Nexo Solar"}'
```

Debe responder `{"ok":true,...}` y llegarte el correo.

## 5. Configura el backend

En tu Mac, en `backend/.env`:

```
N8N_WEBHOOK_URL=https://TU-N8N/webhook/nexo-solar-correos
N8N_WEBHOOK_SECRET=el-mismo-secreto-del-paso-2
```

En Render: **Environment** → agrega las mismas dos variables → **Save** (Render vuelve a desplegar solo).

Los enlaces de los correos apuntan al portal. En Render la dirección se toma sola (`RENDER_EXTERNAL_URL`); en tu Mac es `http://localhost:3001`. Para usar otra dirección, define `PUBLIC_URL`.

## 6. Comprueba todo con un comando

```bash
npm run n8n:check -- tucorreo@gmail.com          # correo de prueba
npm run n8n:check -- tucorreo@gmail.com --todos  # además, los 3 correos con datos ficticios
```

El comando revisa la configuración sin mostrar el secreto, manda los correos y, si algo falla, dice qué revisar. Al arrancar, el backend debe decir `Correos al cliente por n8n: configurado`.

Después prueba el flujo real: en el portal pide una cotización con tu correo, publica la propuesta desde la consola y acepta la compra. En la consola, cada cotización muestra **Correos al cliente** con el estado de cada envío.

## Qué recibe n8n

Un `POST` con el encabezado `x-nexo-secret` y este JSON:

| Campo | Contenido |
|---|---|
| `event` | `solicitud.recibida`, `propuesta.enviada`, `compra.completada` o `prueba` |
| `id` | Clave única del correo (por ejemplo `propuesta:NS-REQ-…`) |
| `email` | Destinatario |
| `subject`, `html`, `text` | Correo listo para enviar |
| `case_id`, `customer_id`, `customer_name` | Cotización y cliente |
| `portal_url` | Enlace a la cotización en el portal |
| `title`, `amount_mxn`, `package_id` | Solo en `propuesta.enviada` |
| `invoice_number`, `concept`, `subtotal_mxn`, `iva_mxn`, `total_mxn`, `issued_at` | Solo en `compra.completada` |

Con estos campos puedes extender el mismo flujo, por ejemplo guardar cada venta en Google Sheets o avisar al equipo en Slack cuando llega una solicitud (un nodo **Switch** sobre `event`).

## Problemas comunes

| Lo que ves | Qué hacer |
|---|---|
| `n8n rechazó el secreto (403)` | El **Value** de la credencial Header Auth debe ser idéntico a `N8N_WEBHOOK_SECRET`, y el **Name** debe ser `x-nexo-secret`. |
| `n8n no encontró el webhook (404)` | Publica el flujo y usa la **Production URL** (`/webhook/...`). |
| `El flujo de n8n falló (500)` | En n8n abre **Executions** → la ejecución fallida. Casi siempre falta conectar Gmail, o la contraseña de aplicación del SMTP es incorrecta. |
| `No se pudo conectar con n8n` | Revisa la URL. Si el backend está en Render, n8n no puede estar en `localhost`. |
| `Sin n8n` en la consola | Falta `N8N_WEBHOOK_URL` en el backend. Todo sigue funcionando en el portal. |
| El correo no aparece | Revisa la carpeta de spam la primera vez y marca "No es spam". |

Los flujos se probaron con n8n 2.42.
