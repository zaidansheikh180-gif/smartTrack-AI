// server.js
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// JWT config
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-smarttrack-key";
const JWT_EXPIRES_IN = "2h";

// Common SmartTrack password for all students (class key)
const STUDENT_COMMON_PASSWORD =
  process.env.STUDENT_COMMON_PASSWORD || "student123";

// Middleware
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static assets
app.use(express.static(__dirname));
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
    maxAge: 2 * 60 * 60 * 1000,
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies.smarttrack_jwt;
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
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

// ---------- Simple seed for demo accounts ----------

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

    const studentHash = bcrypt.hashSync("student123", 10);
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "landing.html"));
});

app.get(["/login", "/login.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.get(["/teacher", "/teacher.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "teacher.html"));
});

app.get(["/student", "/student.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "student.html"));
});

// ---------- Auth endpoints ----------

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

    let redirect = "landing.html";
    if (user.role === "teacher") {
      redirect = "teacher.html";
    } else if (user.role === "student") {
      if (!user.roll_number) {
        return res.status(500).json({
          success: false,
          message: "Student user has no linked roll_number",
        });
      }
      redirect = `student.html?roll=${encodeURIComponent(user.roll_number)}`;
    }

    return res.json({
      success: true,
      role: user.role,
      roll: user.roll_number,
      redirect,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Login failed" });
  }
});

app.post("/auth/face-login", async (req, res) => {
  try {
    const { face_token } = req.body;

    if (!face_token) {
      return res
        .status(400)
        .json({ ok: false, error: "face_token is required" });
    }

    const student = db
      .prepare(
        `
        SELECT id, name, roll_number, section, email
        FROM students
        WHERE face_token = ?
        LIMIT 1
      `
      )
      .get(face_token);

    if (!student) {
      return res
        .status(401)
        .json({ ok: false, error: "Face token not recognized" });
    }

    const existingUser = db
      .prepare(
        `
        SELECT id, email, password_hash, role, roll_number
        FROM users
        WHERE email = ? AND role = 'student'
        LIMIT 1
      `
      )
      .get(student.email);

    let user = existingUser;
    if (!user) {
      const now = new Date().toISOString();
      const hash = bcrypt.hashSync(STUDENT_COMMON_PASSWORD, 10);
      const insert = db.prepare(
        `
        INSERT INTO users (email, password_hash, role, roll_number, created_at)
        VALUES (?, ?, 'student', ?, ?)
      `
      );
      const result = insert.run(
        student.email,
        hash,
        student.roll_number,
        now
      );
      user = {
        id: result.lastInsertRowid,
        email: student.email,
        role: "student",
        roll_number: student.roll_number,
      };
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      roll_number: user.roll_number || student.roll_number,
    });

    setAuthCookie(res, token);

    return res.json({
      ok: true,
      token,
      roll: student.roll_number,
      redirect: `student.html?roll=${encodeURIComponent(student.roll_number)}`,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Face login failed" });
  }
});

app.post("/auth/logout", (req, res) => {
  res.clearCookie("smarttrack_jwt", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  res.json({ success: true });
});

app.get("/auth/me", requireAuth, (req, res) => {
  res.json({
    ok: true,
    role: req.user.role,
    roll: req.user.roll_number || null,
  });
});

// ---------- Teacher profile ----------

app.put(
  "/api/teachers/me",
  requireAuth,
  requireRole("teacher"),
  (req, res) => {
    const { name, subject, section, default_date } = req.body;

    if (!name || !subject || !section || !default_date) {
      return res.status(400).json({ error: "Missing fields" });
    }

    db.prepare(`
      INSERT INTO teachers (user_id, name, subject, section, default_date)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        name=excluded.name,
        subject=excluded.subject,
        section=excluded.section,
        default_date=excluded.default_date
    `).run(req.user.id, name, subject, section, default_date);

    return res.json({ ok: true });
  }
);

app.get(
  "/api/teachers/me",
  requireAuth,
  requireRole("teacher"),
  (req, res) => {
    const teacher = db.prepare("SELECT * FROM teachers WHERE user_id = ?").get(req.user.id);
    if (teacher) {
      res.json(teacher);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      res.json({
        name: "Teacher",
        subject: "Class",
        section: "AIML-C",
        default_date: today,
      });
    }
  }
);

// ---------- Student APIs (for student.html) ----------

app.get("/api/student/profile", requireAuth, (req, res) => {
  try {
    const roll = req.query.roll;
    if (!roll) {
      return res.status(400).json({ ok: false, error: "Missing roll parameter" });
    }

    const student = db
      .prepare(
        `
        SELECT id, name, roll_number, section, email, photo_url, usn, semester
        FROM students
        WHERE roll_number = ?
        LIMIT 1
      `
      )
      .get(roll);

    if (!student) {
      return res.status(404).json({ ok: false, error: "Student not found" });
    }

    if (req.user.role === "student" && req.user.roll_number !== roll) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    return res.json({ ok: true, student });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.put("/api/student/profile", requireAuth, (req, res) => {
  try {
    if (req.user.role !== "student") {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    const roll = req.user.roll_number;
    const { usn, semester } = req.body;

    db.prepare("UPDATE students SET usn = ?, semester = ? WHERE roll_number = ?")
      .run(usn, semester, roll);

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/student/attendance/metrics", requireAuth, (req, res) => {
  try {
    const roll = req.query.roll;
    const student = db.prepare("SELECT id FROM students WHERE roll_number = ?").get(roll);
    if (!student) return res.status(404).json({ error: "Not found" });

    // Calculate REAL metrics
    const total = db.prepare("SELECT COUNT(*) as c FROM attendance WHERE student_id = ?").get(student.id).c;
    const attended = db.prepare("SELECT COUNT(*) as c FROM attendance WHERE student_id = ? AND (status = 'present' OR status = 'late')").get(student.id).c;

    const percentage = total > 0 ? (attended / total) * 100 : 0;

    return res.json({
      ok: true,
      metrics: {
        overall_percentage: percentage,
        last_7_days_score: percentage, // simplified for now
        last_7_days_comment: percentage >= 75 ? "Trending stable" : "Action required",
        risk_subject_count: percentage < 75 ? 1 : 0,
        risk_summary: percentage < 75 ? "Low attendance detected" : "All clear",
      },
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

// ---------- Teacher-side attendance & students ----------

app.delete("/api/students/:id", requireAuth, requireRole("teacher"), (req, res) => {
  try {
    const id = req.params.id;
    const student = db.prepare("SELECT email FROM students WHERE id = ?").get(id);
    if (student) {
      db.prepare("DELETE FROM users WHERE email = ? AND role = 'student'").run(student.email);
    }
    db.prepare("DELETE FROM students WHERE id = ?").run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Delete failed" });
  }
});

app.put("/api/students/:id", requireAuth, requireRole("teacher"), (req, res) => {
  try {
    const { name, roll_number, section, email, usn, semester } = req.body;
    db.prepare(`
      UPDATE students
      SET name = ?, roll_number = ?, section = ?, email = ?, usn = ?, semester = ?
      WHERE id = ?
    `).run(name, roll_number, section, email, usn, semester, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Update failed" });
  }
});

app.post("/api/attendance", requireAuth, requireRole("teacher"), (req, res) => {
  try {
    const { teacherName, subject, section, date, students } = req.body;
    const now = new Date().toISOString();
    const sessionId = db.prepare(`
      INSERT INTO sessions (teacher_name, subject, section, date, created_at, teacher_user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(teacherName, subject, section, date, now, req.user.id).lastInsertRowid;

    const insertAttendance = db.prepare("INSERT INTO attendance (session_id, student_id, status, marked_at) VALUES (?, ?, ?, ?)");
    const findStudent = db.prepare("SELECT id FROM students WHERE roll_number = ? AND section = ?");

    const transaction = db.transaction(() => {
      students.forEach((s) => {
        let student = findStudent.get(s.rollNumber, section);
        if (student) insertAttendance.run(sessionId, student.id, s.status, now);
      });
    });
    transaction();
    res.json({ ok: true, sessionId });
  } catch (err) {
    res.status(500).json({ error: "Save failed" });
  }
});

app.get("/api/sessions", requireAuth, requireRole("teacher"), (req, res) => {
  const rows = db.prepare("SELECT * FROM sessions WHERE teacher_user_id = ? ORDER BY created_at DESC").all(req.user.id);
  res.json(rows);
});

app.get("/api/sessions/:id", requireAuth, requireRole("teacher"), (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
  const records = db.prepare(`
    SELECT students.name, students.roll_number, attendance.status
    FROM attendance
    JOIN students ON students.id = attendance.student_id
    WHERE attendance.session_id = ?
  `).all(req.params.id);
  res.json({ session, records });
});

app.get("/api/students", requireAuth, requireRole("teacher"), (req, res) => {
  const { section } = req.query;
  const rows = section
    ? db.prepare("SELECT * FROM students WHERE section = ? ORDER BY roll_number ASC").all(section)
    : db.prepare("SELECT * FROM students ORDER BY section ASC, roll_number ASC").all();
  res.json(rows);
});

app.post("/api/students", requireAuth, requireRole("teacher"), (req, res) => {
  try {
    const { name, rollNumber, section, email, usn, semester } = req.body;
    const studentId = db.prepare(`
      INSERT INTO students (name, roll_number, section, email, usn, semester)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, rollNumber, section, email, usn || null, semester || null).lastInsertRowid;

    const hash = bcrypt.hashSync(STUDENT_COMMON_PASSWORD, 10);
    db.prepare(`
      INSERT OR IGNORE INTO users (email, password_hash, role, roll_number, created_at)
      VALUES (?, ?, 'student', ?, ?)
    `).run(email, hash, rollNumber, new Date().toISOString());

    res.status(201).json({ id: studentId, name, roll_number: rollNumber });
  } catch (err) {
    res.status(500).json({ error: "Add failed" });
  }
});

app.post("/api/students/:roll/face-enroll", requireAuth, (req, res) => {
  db.prepare("UPDATE students SET face_token = ? WHERE roll_number = ?").run(req.body.face_token, req.params.roll);
  res.json({ ok: true });
});

app.post("/api/student/photo", requireAuth, (req, res) => {
  db.prepare("UPDATE students SET photo_url = ? WHERE roll_number = ?").run(req.body.photo_url, req.query.roll);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
