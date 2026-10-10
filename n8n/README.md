# Comprobante por correo con n8n + Gmail

Cuando un cliente acepta su cotización en el portal y escribe su correo, el backend manda el
comprobante (ya armado en HTML) a un webhook de n8n, y n8n lo envía con Gmail.

```
Portal (cliente acepta y da su correo) → Backend → POST al webhook de n8n → Gmail → bandeja del cliente
```

- El **agente de recomendaciones nunca manda correos**. El envío lo dispara el propio cliente al comprar.
- Es un **comprobante de demostración**, no una factura fiscal (CFDI).
- Si n8n no está configurado o falla, el portal muestra el comprobante en pantalla y la consola registra el estado.

## 1. Tener n8n accesible desde internet

El backend tiene que poder llamar al webhook. Elige una opción:

- **Backend desplegado en Render:** usa n8n en la nube (n8n Cloud) o un n8n desplegado. Un n8n en tu Mac no es alcanzable desde Render.
- **Todo local (pruebas):** `npx n8n` en tu Mac y el backend también local. La URL sería `http://localhost:5678/webhook/nexo-solar-comprobante`.

## 2. Importar el flujo

1. En n8n: **Workflows → Import from file** y elige `nexo-solar-comprobante.json`.
2. Abre el nodo **Enviar por Gmail** y crea o elige una credencial de Gmail (OAuth2 con tu cuenta de Google).
3. Abre el nodo **Secreto correcto** y cambia `CAMBIA_ESTE_SECRETO` por una cadena larga. Esa misma cadena va en `N8N_WEBHOOK_SECRET` del backend.
4. Guarda y **activa** el flujo (interruptor *Active*).
5. Abre el nodo **Webhook** y copia la **Production URL**.

Si la importación marca algún nodo con error por diferencias de versión, créalo a mano con estos datos:

| Nodo | Configuración |
|---|---|
| Webhook | Método POST, path `nexo-solar-comprobante`, Respond: *Using 'Respond to Webhook' node* |
| IF | `{{ $json.headers['x-nexo-secret'] }}` es igual a tu secreto |
| Gmail (Send) | To: `{{ $json.body.email }}`, Subject: `{{ $json.body.subject }}`, Email type: HTML, Message: `{{ $json.body.html }}` |
| Respond to Webhook | JSON `{ "ok": true }` (y otro con código 401 para la rama falsa del IF) |

## 3. Configurar el backend

En `backend/.env` (o en las variables de entorno de Render):

```
N8N_WEBHOOK_URL=https://TU-N8N/webhook/nexo-solar-comprobante
N8N_WEBHOOK_SECRET=la-misma-cadena-del-nodo-IF
```

Reinicia el backend. Al arrancar debe decir: `Envío de comprobantes por n8n: configurado`.

## 4. Probar sin el portal

```bash
curl -X POST "$N8N_WEBHOOK_URL" \
  -H 'content-type: application/json' \
  -H "x-nexo-secret: $N8N_WEBHOOK_SECRET" \
  -d '{"email":"tucorreo@ejemplo.com","subject":"Prueba Nexo Solar","html":"<p>Hola desde Nexo Solar</p>"}'
```

## Qué recibe n8n

El backend envía un JSON con estos campos:

| Campo | Contenido |
|---|---|
| `email` | Correo que escribió el cliente |
| `subject` | Asunto del correo |
| `html`, `text` | Comprobante listo para enviar |
| `invoice_number` | Folio |
| `case_id` | Cotización |
| `customer_id`, `customer_name` | Cliente |
| `concept` | Concepto de la compra |
| `subtotal_mxn`, `iva_mxn`, `total_mxn` | Importes |
| `issued_at` | Fecha de la compra |

Puedes usar estos campos para guardar la venta en Google Sheets o avisar al equipo por Slack desde el mismo flujo.
