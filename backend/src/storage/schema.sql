-- Esquema de PostgreSQL para Nexo Solar.
-- Se crea automáticamente al iniciar el backend (CREATE ... IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS ingest_batches (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT,
  accepted    INTEGER NOT NULL DEFAULT 0,
  duplicates  INTEGER NOT NULL DEFAULT 0,
  errors      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- event_id es la llave primaria: así la deduplicación la garantiza la base de datos.
-- seq conserva el orden de llegada (el kit pide aplicar los eventos en orden).
CREATE TABLE IF NOT EXISTS events (
  event_id     TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  occurred_at  TEXT NOT NULL,
  data         JSONB NOT NULL,
  seq          BIGSERIAL UNIQUE,
  batch_id     BIGINT REFERENCES ingest_batches(id) ON DELETE SET NULL,
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_case_idx ON events (case_id, seq);

-- Caché de interpretaciones de la IA (evita llamadas repetidas y hace reproducible la evaluación).
CREATE TABLE IF NOT EXISTS interpretations (
  cache_key   TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL,
  result      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historial de decisiones: nunca se sobrescriben, así se puede mostrar qué cambió.
CREATE TABLE IF NOT EXISTS decisions (
  id              BIGSERIAL PRIMARY KEY,
  case_id         TEXT NOT NULL,
  evaluation_at   TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  last_seq        BIGINT NOT NULL,
  previous_id     BIGINT REFERENCES decisions(id) ON DELETE SET NULL,
  recommendation  JSONB NOT NULL,
  detail          JSONB NOT NULL,
  new_event_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  changes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS decisions_case_idx ON decisions (case_id, id DESC);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  JSONB NOT NULL
);

-- Extensión del portal: clientes ficticios y ficha que llena el equipo.
CREATE TABLE IF NOT EXISTS customers (
  customer_id             TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  contact_name            TEXT,
  segment                 TEXT,
  city                    TEXT,
  trusted                 BOOLEAN NOT NULL DEFAULT false,
  decision_hours_override NUMERIC,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comprobantes de compra enviados por correo a través de n8n.
CREATE TABLE IF NOT EXISTS invoices (
  id              BIGSERIAL PRIMARY KEY,
  invoice_number  TEXT NOT NULL,
  case_id         TEXT NOT NULL,
  customer_id     TEXT,
  email           TEXT NOT NULL,
  amount_mxn      NUMERIC NOT NULL,
  status          TEXT NOT NULL,
  error           TEXT,
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoices_case_idx ON invoices (case_id);

-- Aprendizaje: análisis y lección de cada cotización cerrada.
CREATE TABLE IF NOT EXISTS lessons (
  case_id      TEXT PRIMARY KEY,
  customer_id  TEXT,
  outcome      TEXT NOT NULL,
  closed_at    TEXT,
  summary      TEXT NOT NULL,
  lesson       TEXT NOT NULL,
  source       TEXT NOT NULL,
  model        TEXT,
  tags         JSONB NOT NULL DEFAULT '[]'::jsonb,
  analysis     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
