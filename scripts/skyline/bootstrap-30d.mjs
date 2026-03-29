import { backfillGhArchive } from "./backfill-gharchive.mjs";
import { enrichRepos } from "./enrich-repos.mjs";
import { materializeSnapshot } from "./materialize-snapshot.mjs";
import { applySchema } from "./apply-schema.mjs";
import { isMainModule, loadLocalEnv } from "./shared.mjs";

export async function bootstrap30d() {
  loadLocalEnv();

  applySchema();
  const backfillSummary = await backfillGhArchive({ days: 30 });
  const enrichmentSummary = await enrichRepos({ days: 30 });
  const snapshotResult = materializeSnapshot({ days: 30 });

  return {
    backfillSummary,
    enrichmentSummary,
    snapshotMeta: snapshotResult.meta,
  };
}

if (isMainModule(import.meta)) {
  bootstrap30d()
    .then((summary) => {
      console.log("Completed 30-day skyline bootstrap.");
      console.log(summary);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
