import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { openDatabase } from "../db";
import { libraryFolders } from "../db/schema";
import { createLogger } from "../log";
import { isMountName, listFolders, syncFolders } from "./folders";

const MIGRATIONS = path.resolve(__dirname, "../../../drizzle");

it("takes a kind's folder and the ones named like it, nothing else", () => {
  expect(isMountName("audiobooks", "audiobooks")).toBe(true);
  expect(isMountName("audiobooks-kids", "audiobooks")).toBe(true);
  expect(isMountName("audiobooks2", "audiobooks")).toBe(false);
  expect(isMountName("music", "audiobooks")).toBe(false);
  expect(isMountName("movies-4k", "movies")).toBe(true);
});

it("matches the folder list to what's mounted", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "murmur-folders-"));
  const root = path.join(tmp, "mnt");
  for (const d of ["audiobooks", "audiobooks-kids", "audiobooks-music", "audiobooks2"]) fs.mkdirSync(path.join(root, d), { recursive: true });
  const { sqlite, db } = await openDatabase({ dbPath: path.join(tmp, "murmur.db"), migrationsDir: MIGRATIONS, backupsDir: path.join(tmp, "backups"), log: createLogger("test") });
  try {
    const add = (p: string, kind: "books" | "music") => db.insert(libraryFolders).values({ path: p, kind, createdAt: 0 }).run();
    // Taken out of the compose file, so its path is gone.
    add(path.join(root, "audiobooks-old"), "books");
    // Already another kind's folder.
    add(path.join(root, "audiobooks-music"), "music");

    await syncFolders(db, "books", path.join(root, "audiobooks"));
    expect(listFolders(db).map((f) => path.basename(f.path)).sort()).toEqual(["audiobooks", "audiobooks-kids"]);

    // A second start with nothing changed leaves the same rows, so ids (and the books under them) stay.
    const ids = listFolders(db).map((f) => f.id);
    await syncFolders(db, "books", path.join(root, "audiobooks"));
    expect(listFolders(db).map((f) => f.id)).toEqual(ids);

    // Renamed in the compose file: the old folder goes and the new one comes in the same start.
    fs.renameSync(path.join(root, "audiobooks-kids"), path.join(root, "audiobooks-family"));
    await syncFolders(db, "books", path.join(root, "audiobooks"));
    expect(listFolders(db).map((f) => path.basename(f.path)).sort()).toEqual(["audiobooks", "audiobooks-family"]);
  } finally {
    sqlite.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
