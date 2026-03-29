import { ensureSchema, isMainModule, loadLocalEnv, openSkylineDatabase } from "./shared.mjs";

export function applySchema() {
  loadLocalEnv();

  const database = openSkylineDatabase();

  try {
    ensureSchema(database);
  } finally {
    database.close();
  }

  console.log("Applied skyline schema.");
}

if (isMainModule(import.meta)) {
  applySchema();
}
