// db.js
const Database = require("better-sqlite3");

// Open / create the SQLite database file
const db = new Database("smarttrack.db");

// Recommended for concurrency with better-sqlite3
db.pragma("journal_mode = WAL");

// Initialize schema
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    section TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    teacher_user_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    roll_number TEXT NOT NULL,
    section TEXT NOT NULL,
    email TEXT,
    photo_url TEXT,
    face_token TEXT,        -- used by demo face login
    usn TEXT,               -- student's registration number (USN)
    semester INTEGER        -- student's semester
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    marked_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  );

  -- Users table for real authentication (teachers + students)
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,         -- 'teacher' or 'student'
    roll_number TEXT,           -- for students, links to students.roll_number
    created_at TEXT NOT NULL
  );

  -- teachers profile table
  CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    section TEXT NOT NULL,
    default_date TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Helpful indexes
  CREATE INDEX IF NOT EXISTS idx_students_roll_section
    ON students (roll_number, section);

  CREATE INDEX IF NOT EXISTS idx_attendance_session
    ON attendance (session_id);

  CREATE INDEX IF NOT EXISTS idx_users_email
    ON users (email);

  CREATE INDEX IF NOT EXISTS idx_users_role_roll
    ON users (role, roll_number);
`);

// Export a single shared db instance
module.exports = db;
