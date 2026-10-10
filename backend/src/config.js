import 'dotenv/config';

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num('PORT', 3001),
  databaseUrl: process.env.DATABASE_URL || '',
  ai: {
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
