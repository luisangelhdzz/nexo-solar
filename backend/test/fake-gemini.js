// Servidor falso compatible con la API de Gemini/OpenAI (sin red ni clave) para las pruebas.
import http from 'node:http';

export async function startFakeGemini(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const entry = { method: req.method, url: req.url, headers: req.headers, body };
    requests.push(entry);
    const out = await handler(entry, requests);
    if (out.raw) {
      await out.raw(res, req);
      return;
    }
    res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
    res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1beta/openai`,
    requests,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    }),
  };
}

// Respuesta de chat/completions con el JSON indicado.
export function completion(obj, { fenced = false, model = 'gemini-3.8-flash', finish = 'stop' } = {}) {
  const content = obj === null ? '' : fenced ? `\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`` : JSON.stringify(obj);
  return {
    status: 200,
    body: { id: 'chatcmpl-test', object: 'chat.completion', model, choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content } }] },
  };
}

// Qué esquema pidió el backend (interpretación o propuesta del asistente).
export const schemaName = (body) => body?.response_format?.json_schema?.name ?? (JSON.stringify(body?.messages ?? '').includes('proposed_action') ? 'proponer_siguiente_paso' : 'registrar_interpretacion');
export const userText = (body) => body?.messages?.find((m) => m.role === 'user')?.content ?? '';
export const systemText = (body) => body?.messages?.find((m) => m.role === 'system')?.content ?? '';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Respuesta en streaming (SSE) como la de Gemini: el texto llega en partes.
// `after` son partes extra que siguen llegando después (por ejemplo, espacios sin fin).
export function sse(pieces, { delayMs = 5, after = [], afterDelayMs = 30, done = true, model = 'gemini-3.8-flash', closed } = {}) {
  return {
    raw: async (res) => {
      let open = true;
      // 'close' de la respuesta: el cliente cortó la conexión antes de que termináramos.
      res.on('close', () => {
        open = false;
        if (!res.writableEnded) closed?.();
      });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (content, finish = null) => res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content }, finish_reason: finish }] })}\n\n`);
      for (const p of pieces) {
        if (!open) return;
        send(p);
        await wait(delayMs);
      }
      for (const p of after) {
        if (!open) return;
        send(p);
        await wait(afterDelayMs);
      }
      if (!open) return;
      if (done) {
        send('', 'stop');
        res.write('data: [DONE]\n\n');
        res.end();
      }
    },
  };
}
