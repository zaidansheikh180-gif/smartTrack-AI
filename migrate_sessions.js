// migrate_sessions.js
const Database = require("better-sqlite3");
const db = new Database("smarttrack.db");

try {
  db.exec("ALTER TABLE sessions ADD COLUMN teacher_user_id INTEGER;");
  console.log("Migration done.");
} catch (e) {
  console.error("Migration error:", e.message);
}
