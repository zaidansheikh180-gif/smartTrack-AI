// migrate-add-email.js
const Database = require("better-sqlite3");

const db = new Database("smarttrack.db");

// Optional but matches your main db.js
db.pragma("journal_mode = WAL");

try {
  // Check if 'email' column already exists
  const columns = db
    .prepare(`PRAGMA table_info(students);`)
    .all();

  const hasEmail = columns.some((col) => col.name === "email");

  if (hasEmail) {
    console.log("Column 'email' already exists on students table. Nothing to do.");
  } else {
    console.log("Adding 'email' column to students table...");
    db.exec(`ALTER TABLE students ADD COLUMN email TEXT;`);
    console.log("Migration complete: 'email' column added.");
  }
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  db.close();
}
