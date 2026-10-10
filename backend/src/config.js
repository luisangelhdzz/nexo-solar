import 'dotenv/config';

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// Gemini se conecta por su API compatible con OpenAI (no hace falta instalar otra librería).
export const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

const AUTOPILOT_MODES = ['off', 'draft', 'auto'];
const autopilot = (process.env.ASSISTANT_AUTOPILOT || 'draft').toLowerCase();

export const config = {
  port: num('PORT', 3001),
  databaseUrl: process.env.DATABASE_URL || '',
  ai: {
    // gemini | anthropic | openai | heuristic
    provider: (process.env.AI_PROVIDER || 'heuristic').toLowerCase(),
    timeoutMs: num('AI_TIMEOUT_MS', 20000),
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
    },
    openai: {
      baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || '',
    },
    // La clave vive solo en backend/.env (nunca en el código ni en GitHub).
    gemini: {
      baseUrl: (process.env.GEMINI_BASE_URL || GEMINI_OPENAI_BASE_URL).replace(/\/$/, ''),
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL,
      // Cuánto razona el modelo antes de responder: low (rápido) | medium | high.
      reasoningEffort: (process.env.GEMINI_REASONING_EFFORT || 'low').toLowerCase(),
      // false = pide JSON simple en vez de JSON con esquema estricto (por si el esquema lo hace lento).
      strictSchema: process.env.GEMINI_STRICT_SCHEMA !== 'false',
    },
  },
  // Asistente comercial: la IA propone y el backend valida con las reglas antes de ejecutar.
  assistant: {
    // off: solo cuando el equipo lo pide · draft: prepara borradores solo · auto: envía lo que pasa todas las validaciones
    autopilot: AUTOPILOT_MODES.includes(autopilot) ? autopilot : 'draft',
    reviewMinutes: num('ASSISTANT_REVIEW_MINUTES', 5),
    timeoutMs: num('ASSISTANT_TIMEOUT_MS', 60000),
  },
  // Contraseña de la consola. Si está vacía (desarrollo local), la consola no pide contraseña.
  adminPassword: process.env.ADMIN_PASSWORD || '',
  // Carga clientes y cotizaciones de demostración al arrancar si la base está vacía.
  seedDemo: process.env.SEED_DEMO === 'true',
  n8n: {
    webhookUrl: process.env.N8N_WEBHOOK_URL || '',
    secret: process.env.N8N_WEBHOOK_SECRET || '',
    timeoutMs: num('N8N_TIMEOUT_MS', 10000),
  },
  policy: {
    followUpHours: num('FOLLOW_UP_HOURS', 48),
    highAmountMxn: num('HIGH_AMOUNT_MXN', 500000),
    maxUnansweredFollowups: num('MAX_UNANSWERED_FOLLOWUPS', 2),
    patienceMargin: num('PATIENCE_MARGIN', 1.2),
  },
};
