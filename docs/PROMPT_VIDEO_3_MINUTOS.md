# Prompt para una app de creación y edición de video

Copia el bloque siguiente y adjunta la documentación de Nexo Solar, capturas y grabaciones reales del proyecto. No adjuntes contraseñas, tokens privados o el archivo .env.

```text
Actúa como productor audiovisual y editor de una demostración de hackathon. Crea un video de exactamente 3 minutos (180 segundos) sobre nuestro proyecto Nexo Solar, usando la documentación y las grabaciones que adjunto.

OBJETIVO
Explicar qué problema resolvemos y demostrar el funcionamiento real del portal, dashboard y asistente de IA. El reto ByeCode “What Should Happen Next?” evalúa qué hacer después con una propuesta comercial, cuándo y por qué. Debemos mostrar una decisión inicial, evidencia, cambio por un nuevo evento y contacto bloqueado. Presenta la información en primera persona del plural: “Creamos”, “Nuestro asistente”, “Usamos”.

FORMATO
Video horizontal 16:9, 1920×1080, en español de México. Voz natural y clara, subtítulos legibles, música instrumental discreta y transiciones sencillas. Estilo visual de Nexo Solar: azul oscuro, blanco, acentos amarillos y paneles claros o modo oscuro según las capturas reales. Pocas palabras en pantalla, títulos de máximo ocho palabras y acercamientos a la recomendación y su evidencia. Da prioridad a las grabaciones de pantalla sobre imágenes decorativas.

REGLAS DE FIDELIDAD
Usa únicamente pantallas, cifras y funciones documentadas. No inventes interfaces, clics, respuestas de Gemini o resultados comerciales. Mantén sincronizados pantalla y narración. Todos los clientes mostrados son ficticios. No muestres claves, contraseñas, enlaces privados, tokens ni datos personales reales.

Gemini interpreta y propone; el motor de reglas del backend valida lo permitido. El despliegue está en modo borrador y el equipo revisa antes de enviar. Las consultas internas de analistas no envían mensajes al cliente. No afirmes que entrenamos un modelo desde cero, que la IA garantiza ventas o que calcula automáticamente el sistema solar definitivo. El comprobante no es CFDI y no hay cobros reales.

n8n tiene una integración para correos, pero solo muestra un correo recibido si te adjunto una grabación de su entrega comprobada. En otro caso represéntalo únicamente en el diagrama de arquitectura como integración de correo. Tiger Data almacena datos en PostgreSQL; no atribuyas al proyecto métricas de compresión o análisis de series temporales que no demostramos.

GUION Y CRONOMETRAJE
Conserva estos ocho intervalos, que suman exactamente 180 segundos. Puedes ajustar pausas y velocidad de voz para respetar cada corte sin perder claridad. No leas los rótulos de tiempo ni los nombres técnicos de los eventos.

00:00-00:20 | Problema y propuesta
Visual: logo, vista breve del portal y dashboard. Texto: “El siguiente paso de cada cotización”.
Narración: “En una venta solar, enviar una cotización es solo el comienzo. Después llegan dudas, aperturas y silencios que no siempre significan intención de compra. Creamos Nexo Solar para ayudar al equipo a decidir qué hacer después, cuándo intervenir y cuándo conviene esperar.”

00:20-00:45 | Portal y solicitud
Visual: formulario real; datos ficticios, objetivo, preferencias de contacto y apartado opcional de consumo. Recorta la escritura repetitiva.
Narración: “El cliente solicita una propuesta desde nuestro portal, sin tener que elegir un kit. Registra su proyecto, cómo prefiere que lo contactemos y, si los conoce, los kilowatts-hora de su recibo y sus aparatos. La solicitud se convierte en un caso que el equipo puede revisar desde el dashboard.”

00:45-01:05 | Dashboard
Visual: indicadores Por cotizar, Atender ahora, En espera y Revisar en equipo. Abrir una cotización real de demostración.
Narración: “Aquí organizamos las cotizaciones por el siguiente paso que necesitan. Vemos cuáles requieren atención, cuáles deben esperar y cuáles necesitan revisión humana. Al abrir un caso tenemos su recomendación, su propuesta y el historial, con los detalles largos disponibles cuando hacen falta.”

01:05-01:45 | Asistente y análisis energético
Visual: Papelería Punto Claro y “Consultar al asistente como analista”. Mostrar una respuesta real y las cifras verificadas: 900 kWh en 60 días, 450 kWh por 30 días; aire acondicionado sin potencia registrada. Recortar la espera de generación, sin simular instantaneidad.
Narración: “Nuestro asistente usa Gemini para interpretar preguntas y preparar análisis para el equipo. Podemos pedirle qué información falta antes de confirmar la cotización. En este ejemplo, el recibo reporta novecientos kilowatts-hora en sesenta días: el backend calcula un equivalente de cuatrocientos cincuenta por treinta días. Falta confirmar la tarifa y la potencia del aire acondicionado. Por eso no presentamos un inventario incompleto como consumo total. Gemini propone; las cifras y restricciones se verifican en el backend.”

01:45-02:10 | Cambio de decisión y evidencia
Visual: grabaciones del caso P06 del kit en un entorno de prueba: recomendación inicial de esperar; carga de updates.jsonl; nuevo mensaje; recomendación de aclarar duda; evidencia del mismo caso. No cargues el kit ni limpies la base compartida para obtener estas tomas.
Narración: “Una decisión puede cambiar cuando llega información nueva. En este caso, primero recomendamos esperar porque hubo un contacto reciente. Cuando el cliente envía una nueva pregunta, reevaluamos y recomendamos aclarar su duda. Conservamos la decisión anterior y los eventos que explican el cambio, para que el equipo pueda revisarlo.”

02:10-02:30 | Restricciones e inacción
Visual: P04 o Clínica Buen Día con contacto prohibido; después un caso que espera la fecha solicitada. Mostrar regla y siguiente paso.
Narración: “Si el cliente prohíbe el contacto, bloqueamos los mensajes comerciales aunque tenga una pregunta pendiente. Si pide tiempo, respetamos la espera. Una apertura por sí sola no confirma compra. Nuestro objetivo también es reconocer cuándo no debemos intervenir.”

02:30-02:50 | Cierre y aprendizaje
Visual: panel de cierre, caso ganado y caso perdido con motivos ya registrados; pestaña Aprendizaje. No inventar cierres o ventas reales.
Narración: “Al cerrar una cotización registramos si la venta se concretó, se perdió o se canceló, junto con su motivo. El historial nos ayuda a revisar dudas atendidas y factores del resultado. Guardamos lecciones para orientar futuras respuestas, sin cambiar las reglas de contacto.”

02:50-03:00 | Cierre
Visual: diagrama React → Node/Express → Tiger Data; Gemini y n8n como integraciones; Render como alojamiento. Mostrar exportación JSON o enlace público, según la grabación disponible. Texto final: “Nexo Solar · Decisiones con contexto y evidencia”.
Narración: “Conectamos portal, IA y reglas verificables en una aplicación publicada. Nexo Solar convierte el historial comercial en un siguiente paso claro, explicable y respetuoso.”

ENTREGA
Exporta MP4 de 180 segundos, con voz, subtítulos y música. Comprueba legibilidad de las pantallas y duración exacta. Mantén las transiciones dentro de cada intervalo y no agregues una introducción o cierre extra.

Si faltan grabaciones esenciales, identifica exactamente qué toma falta y entrega el montaje o storyboard pendiente de ese recurso; no reemplaces la demostración por pantallas inventadas. Si esta app no puede renderizar o exportar video, entrega el guion, la lista de tomas y las instrucciones de edición sin afirmar que generaste un MP4.
```

## Tomas que conviene adjuntar

1. Portal y envío de una solicitud ficticia.
2. Dashboard y apertura de una cotización.
3. Papelería Punto Claro: cifras de consumo y respuesta real del asistente.
4. P06 antes/después de la actualización del kit, grabado en local.
5. P04 o Clínica Buen Día: contacto bloqueado; caso con espera solicitada.
6. Cierre y motivos de una venta ganada/perdida ya registrados.
7. Aprendizaje, exportación JSON, logo y diagrama de arquitectura.

En 3 minutos mostramos el flujo completo y las decisiones relevantes; los detalles de instalación y API quedan en la documentación adjunta. El guion no sustituye las instrucciones específicas de Devpost o las bases generales del evento.
