import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../migrations/',import.meta.url));
const required=["0001_init.sql", "0002_study_groups.sql", "0003_scenarios.sql", "0004_cdrs_engine.sql", "0005_empirical_calibration.sql", "0006_defense_rigor.sql", "0007_d1_read_optimization.sql", "0008_denormalized_counts.sql", "0009_incremental_revalidation.sql", "0010_fdic_connectors.sql", "0011_fdic_reverification_priority.sql", "0012_fdic_reverification_workbench.sql", "0013_storage_lineage.sql", "0014_official_case_layers.sql", "0015_external_mapping_and_d1_optimization.sql", "0016_external_validation_matrix.sql", "0017_research_lab.sql", "0018_collection_dedup.sql", "0019_research_redesign.sql", "0020_job_candidate_recovery.sql", "0021_external_runner_lease.sql"];
const missing=required.filter(name=>!fs.existsSync(path.join(root,name))||!fs.readFileSync(path.join(root,name),'utf8').trim());
if(missing.length){console.error('Required migration files are missing or empty: '+missing.join(', '));console.error('Restore the original SQL files in migrations/ before running tests or deploying.');process.exitCode=1;}else console.log('Migration files verified: '+required.length);
