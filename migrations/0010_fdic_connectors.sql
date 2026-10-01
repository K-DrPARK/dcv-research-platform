-- FDIC BankFind Suite connectors: episode→CERT linkage, Financials/SOD raw observations,
-- and market metrics.  These tables deliberately do not overwrite the thesis panel's
-- concentration or peak_outflow fields; FDIC-derived values are verification covariates
-- until a protocol explicitly promotes them.

CREATE TABLE IF NOT EXISTS fdic_episode_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  cert INTEGER NOT NULL,
  institution_name TEXT,
  match_status TEXT NOT NULL DEFAULT 'pending', -- pending|confirmed|rejected
  match_method TEXT NOT NULL DEFAULT 'manual',  -- failure_exact|failure_fuzzy|institution_search|manual
  match_score REAL,
  candidate_json TEXT NOT NULL DEFAULT '{}',
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, episode_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(episode_id) REFERENCES empirical_episodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fdic_links_project_status ON fdic_episode_links(project_id, match_status);
CREATE INDEX IF NOT EXISTS idx_fdic_links_cert ON fdic_episode_links(project_id, cert);

CREATE TABLE IF NOT EXISTS fdic_financial_observations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  cert INTEGER NOT NULL,
  repdte TEXT NOT NULL,
  asset REAL,
  deposits_total REAL,
  deposits_domestic REAL,
  uninsured_deposits REAL,
  equity REAL,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE(project_id, cert, repdte),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(episode_id) REFERENCES empirical_episodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fdic_fin_project_episode ON fdic_financial_observations(project_id, episode_id, repdte);

CREATE TABLE IF NOT EXISTS fdic_sod_observations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_id TEXT,
  cert INTEGER NOT NULL,
  year INTEGER NOT NULL,
  branch_num TEXT,
  uninumber TEXT,
  state TEXT,
  county TEXT,
  cbsa TEXT,
  branch_deposits REAL,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  row_key TEXT NOT NULL,
  UNIQUE(project_id, row_key),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(episode_id) REFERENCES empirical_episodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fdic_sod_project_episode ON fdic_sod_observations(project_id, episode_id, year);
CREATE INDEX IF NOT EXISTS idx_fdic_sod_project_market ON fdic_sod_observations(project_id, year, state);

CREATE TABLE IF NOT EXISTS fdic_market_metrics (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  cert INTEGER NOT NULL,
  year INTEGER NOT NULL,
  market_type TEXT NOT NULL,
  market_key TEXT NOT NULL,
  hhi REAL,
  bank_count INTEGER,
  total_deposits REAL,
  target_bank_share REAL,
  methodology_version TEXT NOT NULL DEFAULT 'FDIC-SOD-STATE-HHI-v1',
  quality_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, episode_id, year, market_type, market_key),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(episode_id) REFERENCES empirical_episodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fdic_market_project_episode ON fdic_market_metrics(project_id, episode_id, year);
