# Entrega de Nexo Solar en Devpost

Ficha preparada para copiar al formulario de Devpost. Evento confirmado por el equipo; pendientes los integrantes y el enlace alojado del video. No enviada todavía. Verificar las preguntas específicas del evento antes de enviar.

## Evento y estado de la entrega

- Hackathon: https://hackathon-tecnm-saltillo.devpost.com/
- Reto: ByeCode - What Should Happen Next?
- Video recibido: IMG_7728.mp4, aproximadamente 2 minutos 57 segundos (176.97 s), 53.35 MiB.
- Pendiente: subirlo a YouTube o Vimeo y agregar el enlace para los jueces. El MP4 local todavía no es un enlace de video de Devpost.
- Estado: ficha preparada en el repositorio, sin envío confirmado en Devpost.
- Video máximo del evento: 3 minutos; el archivo recibido cumple por duración.
- Cierre configurado en Devpost: 10 de octubre de 2026, 15:00 hora de Saltillo/Monterrey (21:00 UTC). Confirmado desde el contador del evento: 2026-10-10T17:00:00-04:00.
- Equipo requerido: de 3 a 5 integrantes, estudiantes activos. Pendientes sus nombres completos.
- Entrega requerida: nombre y descripción, reto elegido, GitHub, video demo, tecnologías y nombres completos.
- Uso de asistentes de IA: permitido por las bases si se declara. Usamos asistencia de IA durante el desarrollo y Gemini en el producto.
- Fuentes: [Evento](https://hackathon-tecnm-saltillo.devpost.com/) y [Reglas](https://hackathon-tecnm-saltillo.devpost.com/rules).

## Nombre

Nexo Solar

## Descripción breve

Asistente de IA que propone el siguiente paso de cada cotización solar y respeta los tiempos del cliente.

## Inspiración

En una venta solar, enviar una cotización es solo el comienzo. El equipo debe responder dudas, reunir información, reconocer cuándo conviene dar seguimiento y respetar cuándo el cliente necesita tiempo. Creamos Nexo Solar para convertir el historial de cada cotización en una recomendación clara y verificable.

## Qué hace

Conectamos un portal del cliente con un dashboard para agentes comerciales y analistas. El cliente solicita una cotización personalizada y define sus preferencias de contacto. El equipo revisa el proyecto, publica la propuesta y registra el resultado comercial.

Nuestro asistente usa Gemini para interpretar mensajes y preparar borradores. Un motor de reglas valida el siguiente paso: pedir información, resolver una duda, esperar, derivar al equipo o dejar de actuar. En el despliegue actual trabaja en modo borrador: el equipo revisa antes de enviar respuestas.

La integración con n8n prepara correos con enlaces de acceso directo a la cotización; su entrega en el despliegue debe comprobarse antes de mostrarla como operativa. El cliente puede revisar su propuesta, escribir dudas, aceptar o rechazar y cambiar sus preferencias de contacto. Registramos cierres ganados y perdidos con sus motivos para apoyar el aprendizaje del equipo.

Los analistas pueden hacer consultas internas sobre consumo en kWh, días del recibo, tarifa y aparatos. El backend calcula cifras reproducibles y Gemini señala datos faltantes y revisiones necesarias. No estimamos consumo a partir de cuartos ni dimensionamos paneles sin evaluación técnica.

También presentamos un cliente ficticio que hace preguntas recurrentes sin compra confirmada: resumimos sus dudas y buscamos qué necesita para decidir, sin asumir que nunca comprará ni cerrar automáticamente su caso.

Para el reto, cargamos eventos JSONL, conservamos su historial, ignoramos duplicados y exportamos decisiones con evidencia. El kit público muestra cómo P06 cambia de espera a aclaración cuando llega información nueva, y cómo P04 mantiene bloqueado el contacto.

## Cómo lo construimos

Usamos React y Vite para el portal y el dashboard, y Node.js con Express para el backend. Guardamos clientes, eventos, decisiones y resultados en PostgreSQL alojado en Tiger Data. Integramos Google Gemini para interpretación y propuestas comerciales, y una integración con n8n para entregar correos. Publicamos la aplicación en Render.

Proporcionamos a Gemini el contexto del caso, conocimiento comercial aprobado y ejemplos. No reentrenamos el modelo. Las reglas de contacto y cierre se validan en el backend y no dependen únicamente de la respuesta de la IA.

## Dificultades que resolvimos

- Mantener la coherencia entre la solicitud del portal y la propuesta que prepara el equipo.
- Validar las respuestas de la IA sin permitir que cambie las restricciones del cliente.
- Compartir una base persistente entre el equipo y la aplicación desplegada.
- Llevar al cliente directamente desde el correo a su propia cotización, sin mostrar un directorio de empresas.

## De qué estamos orgullosos

Construimos un flujo de solicitud, propuesta, seguimiento y cierre. Podemos explicar por qué el sistema propone actuar o esperar, conservar el historial y mostrar situaciones de compra y rechazo. Verificamos el acceso directo en escritorio y móvil y que un enlace de una cotización no permite operar otra.

## Qué aprendimos

Un asistente comercial útil necesita contexto y límites claros. Aprendimos a combinar IA para interpretar y redactar con reglas verificables para decidir si una acción está permitida. También distinguimos un motivo de cierre declarado por el equipo de una hipótesis generada a partir del historial.

## Qué sigue

Queremos evaluar más escenarios, mejorar las métricas comerciales y validar el producto con usuarios. La ejecución automática controlada será una etapa posterior a la revisión de borradores y a la evaluación de seguridad y calidad.

## Built with

Google Gemini, Tiger Data, PostgreSQL, React, Vite, JavaScript, Node.js, Express, Render, n8n.

## Enlaces

- Aplicación: https://nexo-solar.onrender.com
- Portal del cliente: https://nexo-solar.onrender.com/portal#/cotizar
- Código: https://github.com/luisangelhdzz/nexo-solar
- Video: archivo recibido y duración verificada; PENDIENTE el enlace de YouTube o Vimeo accesible para los jueces.

## Acceso de los jueces

La consola requiere contraseña. Proporcionar instrucciones de acceso mediante el campo de evaluación que indique el evento; no incluir contraseñas de infraestructura ni claves de API en esta ficha pública.

La base de presentación incluye siete casos ficticios: solicitar información, resolver una duda, esperar una fecha, bloquear contacto, venta ganada, venta perdida y preguntas recurrentes sin compra confirmada. Los casos que agregue el equipo durante el video se ingresarán manualmente. La demostración utiliza datos ficticios.

## Documentación para los jueces

- [Documentación del proyecto](DOCUMENTACION_PROYECTO.md)
- [Documentación en PDF](../output/pdf/Nexo_Solar_Documentacion.pdf)
- [Nota técnica de una página en PDF](../output/pdf/Nexo_Solar_Nota_Tecnica.pdf)
- [Nota técnica editable](NOTA_TECNICA_ACTUALIZADA.md)
- [Recomendaciones finales del kit público](../recomendaciones.json)
- [Guion y prompt del video de tres minutos](PROMPT_VIDEO_3_MINUTOS.md)

## Pendientes de la entrega

- Seleccionar RETO BYECODE. Si el formulario permite premios de patrocinadores, revisar Best Use of Gemini API y Best Use of Tiger Data, que sí utilizamos; no seleccionar herramientas que no estén integradas.
- Agregar integrantes reales e invitarlos al proyecto.
- Añadir logo y capturas reales del portal, dashboard y asistente.
- Añadir enlace del video.
- Verificar el estado de la integración n8n en el despliegue antes de presentarla como operativa.
- Completar las preguntas específicas del evento.
- Presionar Submit project y verificar Submitted.

## Orden para completar el formulario

1. Abre la página del hackathon correcto y usa **Start project** (o **Import from portfolio** si el proyecto ya existe).
2. En **Manage Team**, agrega al equipo mediante los datos que proporcione cada integrante.
3. En **Project Overview**, usa el nombre y la descripción breve de esta ficha.
4. En **Project Details**, copia las secciones desde Inspiración hasta Qué sigue. Agrega tecnologías, enlace de GitHub, aplicación, capturas y el video.
5. Completa **Additional Details** con los requisitos específicos del evento y la nota técnica cuando corresponda.
6. Revisa la vista previa, las condiciones del evento y el paso **Submit**. Una ficha en **Draft** todavía no es una entrega enviada: confirma el estado **Submitted** después de finalizar.

Fuentes oficiales: [Cómo iniciar y enviar una entrega](https://help.devpost.com/article/122-how-to-enter-a-submission) y [Campos del formulario](https://help.devpost.com/article/126-know-your-submission-steps). Las preguntas específicas y categorías deben verificarse en el evento elegido.
