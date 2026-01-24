// server.js
const express = require("express");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve static assets from /public (for CSS, images, JS if needed)
app.use(express.static(path.join(__dirname, "public")));

// Landing page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "landing.html"));
});

// Login page
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

// Teacher dashboard (main app UI)
app.get("/teacher", (req, res) => {
  res.sendFile(path.join(__dirname, "teacher.html"));
});

// Student dashboard page
app.get("/student", (req, res) => {
  res.sendFile(path.join(__dirname, "student.html"));
});

/**
 * Face login endpoint
 * Expects: { image: base64DataUrl, role: "student" | "teacher" }
 * For now: dummy match that always succeeds with a sample roll/code.
 * Later: plug in real face recognition using students.photo_url and embeddings.
 */
app.post("/face-login", (req, res) => {
  try {
    const { image, role } = req.body;

    if (!image) {
      return res
        .status(400)
        .json({ success: false, message: "No image received" });
    }

    // TODO: real face matching with DB (students.photo_url, etc.)
    if (role === "student") {
      // Example: pretend we matched roll 20
      return res.json({ success: true, role: "student", roll: 20 });
    } else {
      // Example: pretend we matched teacher code T001
      return res.json({ success: true, role: "teacher", code: "T001" });
    }
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Face login failed" });
  }
});

// Save an attendance session
app.post("/api/attendance", (req, res) => {
  try {
    const { teacherName, subject, section, date, students } = req.body;

    if (
      !teacherName ||
      !subject ||
      !section ||
      !date ||
      !Array.isArray(students)
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const now = new Date().toISOString();

    const insertSession = db.prepare(
      `
      INSERT INTO sessions (teacher_name, subject, section, date, created_at)
      VALUES (?, ?, ?, ?, ?)
    `
    );
    const sessionResult = insertSession.run(
      teacherName,
      subject,
      section,
      date,
      now
    );
    const sessionId = sessionResult.lastInsertRowid;

    const insertStudent = db.prepare(
      `
      INSERT INTO students (name, roll_number, section)
      VALUES (?, ?, ?)
    `
    );

    const findStudent = db.prepare(
      `
      SELECT id FROM students WHERE roll_number = ? AND section = ?
    `
    );

    const insertAttendance = db.prepare(
      `
      INSERT INTO attendance (session_id, student_id, status, marked_at)
      VALUES (?, ?, ?, ?)
    `
    );

    const transaction = db.transaction(() => {
      students.forEach((s) => {
        if (!s.name || !s.rollNumber || !s.status) {
          return;
        }

        let student = findStudent.get(s.rollNumber, section);
        let studentId;

        if (!student) {
          const result = insertStudent.run(s.name, s.rollNumber, section);
          studentId = result.lastInsertRowid;
        } else {
          studentId = student.id;
        }

        insertAttendance.run(sessionId, studentId, s.status, now);
      });
    });

    transaction();

    res.json({ ok: true, sessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save attendance" });
  }
});

// Get all sessions
app.get("/api/sessions", (req, res) => {
  try {
    const rows = db
      .prepare(
        `
      SELECT id, teacher_name, subject, section, date, created_at
      FROM sessions
      ORDER BY created_at DESC
    `
      )
      .all();

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

// Get details for a single session (students + statuses)
app.get("/api/sessions/:id", (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (Number.isNaN(sessionId)) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const session = db
      .prepare(
        `
      SELECT id, teacher_name, subject, section, date, created_at
      FROM sessions
      WHERE id = ?
    `
      )
      .get(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const records = db
      .prepare(
        `
      SELECT
        students.name,
        students.roll_number,
        students.section,
        attendance.status,
        attendance.marked_at
      FROM attendance
      JOIN students ON students.id = attendance.student_id
      WHERE attendance.session_id = ?
      ORDER BY students.roll_number ASC
    `
      )
      .all(sessionId);

    res.json({
      session,
      records,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch session details" });
  }
});

// List students (optionally by section)
app.get("/api/students", (req, res) => {
  try {
    const { section } = req.query;

    let rows;
    if (section) {
      rows = db
        .prepare(
          `
        SELECT id, name, roll_number, section, photo_url
        FROM students
        WHERE section = ?
        ORDER BY roll_number ASC
      `
        )
        .all(section);
    } else {
      rows = db
        .prepare(
          `
        SELECT id, name, roll_number, section, photo_url
        FROM students
        ORDER BY section ASC, roll_number ASC
      `
        )
        .all();
    }

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

// Add a student
app.post("/api/students", (req, res) => {
  try {
    const { name, rollNumber, section, photoUrl } = req.body;

    if (!name || !rollNumber || !section) {
      return res
        .status(400)
        .json({ error: "name, rollNumber and section are required" });
    }

    const existing = db
      .prepare(
        `
      SELECT id FROM students WHERE roll_number = ? AND section = ?
    `
      )
      .get(rollNumber, section);

    if (existing) {
      return res
        .status(409)
        .json({ error: "Student already exists in this section" });
    }

    const insert = db.prepare(
      `
      INSERT INTO students (name, roll_number, section, photo_url)
      VALUES (?, ?, ?, ?)
    `
    );

    const result = insert.run(name, rollNumber, section, photoUrl || null);

    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      roll_number: rollNumber,
      section,
      photo_url: photoUrl || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add student" });
  }
});

// Per-student history by roll number
app.get("/api/students/:roll/history", (req, res) => {
  try {
    const roll = req.params.roll;

    if (!roll) {
      return res.status(400).json({ error: "Missing roll parameter" });
    }

    const student = db
      .prepare(
        `
      SELECT id, name, roll_number, section, photo_url
      FROM students
      WHERE roll_number = ?
      LIMIT 1
    `
      )
      .get(roll);

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    const history = db
      .prepare(
        `
      SELECT
        sessions.id AS session_id,
        sessions.date,
        sessions.subject,
        sessions.section,
        attendance.status,
        attendance.marked_at
      FROM attendance
      JOIN sessions ON sessions.id = attendance.session_id
      WHERE attendance.student_id = ?
      ORDER BY sessions.date ASC, sessions.created_at ASC
    `
      )
      .all(student.id);

    res.json({
      student,
      history,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch student history" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
