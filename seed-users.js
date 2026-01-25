// seed-users.js
const bcrypt = require("bcrypt");
const db = require("./db");

function seed() {
  const now = new Date().toISOString();

  // Wipe existing users
  db.exec(`DELETE FROM users;`);

  const teacherHash = bcrypt.hashSync("password123", 10);
  db.prepare(
    `
    INSERT INTO users (email, password_hash, role, roll_number, created_at)
    VALUES (?, ?, 'teacher', NULL, ?)
  `
  ).run("teacher@college.edu", teacherHash, now);

  const studentHash = bcrypt.hashSync("password123", 10);
  db.prepare(
    `
    INSERT INTO users (email, password_hash, role, roll_number, created_at)
    VALUES (?, ?, 'student', ?, ?)
  `
  ).run("student20@college.edu", studentHash, "20", now);

  console.log("Seeded users: teacher@college.edu, student20@college.edu");
}

seed();
