// server.js
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// JWT config – use env var in Codespaces: Settings > Secrets
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-smarttrack-key";
const JWT_EXPIRES_IN = "2h";

// Common SmartTrack password for all students (class key)
const STUDENT_COMMON_PASSWORD =
  process.env.STUDENT_COMMON_PASSWORD || "AIML2026!";

// Middleware
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static assets from /public (for CSS, images, JS if needed)
app.use(express.static(path.join(__dirname, "public")));

// ---------- Auth helpers ----------

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function setAuthCookie(res, token) {
  res.cookie("smarttrack_jwt", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 2 * 60 * 60 * 1000, // 2 hours
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies.smarttrack_jwt;
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, role, email, roll_number }
    next();
  } catch (err) {
    console.error("JWT verify failed:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "Forbidden for this role" });
    }
    next();
  };
}

// ---------- Simple seed for demo accounts (optional, idempotent) ----------

function ensureDemoUsers() {
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE email = ?")
    .get("teacher@college.edu").c;

  if (count === 0) {
    const now = new Date().toISOString();
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

    console.log(
      "Seeded demo users teacher@college.edu and student20@college.edu"
    );
  }
}

ensureDemoUsers();

// ---------- Public pages ----------

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

// ---------- Auth endpoints ----------

/**
 * Email/password login with real hashing and JWT cookie.
 * Expects: { email, password } from login form.
 * Uses the `users` table.
 */
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password required" });
    }

    const user = db
      .prepare(
        `
      SELECT id, email, password_hash, role, roll_number
      FROM users
      WHERE email = ?
      LIMIT 1
    `
      )
      .get(email);

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      roll_number: user.roll_number || null,
    });

    setAuthCookie(res, token);

    let redirect = "/";
    if (user.role === "teacher") {
      redirect = "/teacher";
    } else if (user.role === "student") {
      if (!user.roll_number) {
        return res.status(500).json({
          success: false,
          message: "Student user has no linked roll_number",
        });
      }
      redirect = `/student?roll=${encodeURIComponent(user.roll_number)}`;
    }

    return res.json({
      success: true,
      role: user.role,
      roll: user.roll_number,
      redirect,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: "Login failed" });
  }
});

/**
 * Logout – clear JWT cookie.
 */
app.post("/auth/logout", (req, res) => {
  res.clearCookie("smarttrack_jwt", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  res.json({ success: true });
});

/**
 * Check current session – used for auto-redirect on login page.
 */
app.get("/auth/me", requireAuth, (req, res) => {
  res.json({
    ok: true,
    role: req.user.role,
    roll: req.user.roll_number || null,
  });
});

// ---------- Protected API routes ----------

// Save an attendance session (teacher-only)
app.post("/api/attendance", requireAuth, requireRole("teacher"), (req, res) => {
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
      INSERT INTO sessions (teacher_name, subject, section, date, created_at, teacher_user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    );
    const sessionResult = insertSession.run(
      teacherName,
      subject,
      section,
      date,
      now,
      req.user.id // link session to logged-in teacher
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

// Get all sessions (teacher-only, only this teacher's sessions)
app.get("/api/sessions", requireAuth, requireRole("teacher"), (req, res) => {
  try {
    const rows = db
      .prepare(
        `
        SELECT id, teacher_name, subject, section, date, created_at
        FROM sessions
        WHERE teacher_user_id = ?
        ORDER BY created_at DESC
      `
      )
      .all(req.user.id);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

// Get details for a single session (teacher-only)
app.get(
  "/api/sessions/:id",
  requireAuth,
  requireRole("teacher"),
  (req, res) => {
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
  }
);

// List students (teacher-only)
app.get(
  "/api/students",
  requireAuth,
  requireRole("teacher"),
  (req, res) => {
    try {
      const { section } = req.query;

      let rows;
      if (section) {
        rows = db
          .prepare(
            `
          SELECT id, name, roll_number, section, email, photo_url
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
          SELECT id, name, roll_number, section, email, photo_url
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
  }
);

// Add a student (teacher-only)
app.post(
  "/api/students",
  requireAuth,
  requireRole("teacher"),
  (req, res) => {
    try {
      const { name, rollNumber, section, photoUrl, email } = req.body;

      if (!name || !rollNumber || !section || !email) {
        return res
          .status(400)
          .json({ error: "name, rollNumber, section and email are required" });
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

      const insertStudent = db.prepare(
        `
        INSERT INTO students (name, roll_number, section, email, photo_url)
        VALUES (?, ?, ?, ?, ?)
      `
      );

      const now = new Date().toISOString();
      const result = insertStudent.run(
        name,
        rollNumber,
        section,
        email,
        photoUrl || null
      );

      // Ensure a user account for this email with common student password
      const existingUser = db
        .prepare(
          `
          SELECT id FROM users
          WHERE email = ? AND role = 'student'
        `
        )
        .get(email);

      if (!existingUser) {
        const hash = bcrypt.hashSync(STUDENT_COMMON_PASSWORD, 10);

        db.prepare(
          `
          INSERT INTO users (email, password_hash, role, roll_number, created_at)
          VALUES (?, ?, 'student', ?, ?)
        `
        ).run(email, hash, rollNumber, now);
      }

      res.status(201).json({
        id: result.lastInsertRowid,
        name,
        roll_number: rollNumber,
        section,
        email,
        photo_url: photoUrl || null,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to add student" });
    }
  }
);

// Per-student history by roll number (student or teacher)
app.get("/api/students/:roll/history", requireAuth, (req, res) => {
  try {
    const roll = req.params.roll;

    if (!roll) {
      return res.status(400).json({ error: "Missing roll parameter" });
    }

    const student = db
      .prepare(
        `
        SELECT id, name, roll_number, section, email, photo_url
        FROM students
        WHERE roll_number = ?
        LIMIT 1
      `
      )
      .get(roll);

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // If logged in as student, enforce own roll only
    if (req.user.role === "student" && req.user.roll_number !== roll) {
      return res.status(403).json({ error: "Forbidden for this student" });
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
