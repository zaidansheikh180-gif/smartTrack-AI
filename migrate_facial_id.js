// migrate_facial_id.js
const db = require("./db");

try {
  db.prepare("ALTER TABLE students ADD COLUMN facial_id TEXT;").run();
  console.log("Added facial_id column to students table.");
} catch (e) {
  console.error("Migration error (maybe column already exists):", e.message);
}
