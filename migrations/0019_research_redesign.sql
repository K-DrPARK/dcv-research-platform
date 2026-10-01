ALTER TABLE design_candidates ADD COLUMN base_id TEXT;
ALTER TABLE design_candidates ADD COLUMN candidate_role TEXT NOT NULL DEFAULT 'exploratory';
ALTER TABLE design_candidates ADD COLUMN pair_seed_key TEXT;
ALTER TABLE reviewer_observations ADD COLUMN trial_id TEXT;
CREATE UNIQUE INDEX idx_reviewer_trial_unique ON reviewer_observations(trial_id) WHERE trial_id IS NOT NULL;
CREATE TABLE reviewer_trials (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, participant_hash TEXT NOT NULL,
 confidence REAL NOT NULL, ai_correct INTEGER NOT NULL, recommendation INTEGER NOT NULL,
 task_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', research_cycle INTEGER NOT NULL,
 evidence_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE INDEX idx_trial_participant ON reviewer_trials(project_id,research_cycle,participant_hash,status);
