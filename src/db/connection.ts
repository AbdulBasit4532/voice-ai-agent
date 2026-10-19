import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Db = Database.Database;

const here = path.dirname(fileURLToPath(import.meta.url));

function readSchema(): string {
  // schema.sql sits next to this file both in src/ (tsx) and dist/ (after build + copy:assets).
  return fs.readFileSync(path.join(here, "schema.sql"), "utf8");
}

/**
 * Opens (or creates) the SQLite database at `databasePath` and applies the schema.
 * The schema is idempotent (CREATE ... IF NOT EXISTS), so this is safe on every boot.
 */
export function openDatabase(databasePath: string): Db {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(readSchema());
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}
