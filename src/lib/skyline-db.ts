import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SkylineSnapshot } from "@/lib/skyline-data";

const defaultSnapshotPath = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "data",
  "skyline-snapshot.json",
);

export async function loadMaterializedSkylineSnapshot(): Promise<SkylineSnapshot | null> {
  const snapshotPath = process.env.SKYLINE_SNAPSHOT_PATH?.trim() || defaultSnapshotPath;

  try {
    const contents = await readFile(snapshotPath, "utf8");
    const parsed = JSON.parse(contents) as SkylineSnapshot;

    if (!parsed || !Array.isArray(parsed.repos) || !Array.isArray(parsed.districts)) {
      return null;
    }

    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Failed to read skyline snapshot file", error);
    }

    return null;
  }
}
