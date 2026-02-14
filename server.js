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
  process.env.STUDENT_COMMON_PASSWORD || "AIML2026!";

// Middleware
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static assets (CSS, JS, etc.) from the root and public folders
// This allows the server to find "login.html" when the browser asks for it directly.
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
    // { id, role, email, roll_number }
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
// We support both clean routes (/login) and file routes (/login.html)

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

// Demo face-login: use a stored face_token instead of password
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

    console.log("Teacher profile save", {
      userId: req.user.id,
      name,
      subject,
      section,
      default_date,
    });

    return res.json({ ok: true });
  }
);

app.get(
  "/api/teachers/me",
  requireAuth,
  requireRole("teacher"),
  (req, res) => {
    const today = new Date().toISOString().slice(0, 10);

    res.json({
      name: "Teacher",
      subject: "Class",
      section: "AIML-C",
      default_date: today,
    });
  }
);

// ---------- Student APIs (for student.html) ----------

// Student profile by roll (student or teacher)
app.get("/api/student/profile", requireAuth, (req, res) => {
  try {
    const roll = req.query.roll;
    if (!roll) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing roll parameter" });
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
      return res
        .status(403)
        .json({ ok: false, error: "Forbidden for this student" });
    }

    return res.json({
      ok: true,
      student: {
        ...student,
        registration_number: student.usn || "",
        semester: student.semester || "",
      },
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to load student profile" });
  }
});

// Student can update own USN and semester
app.put("/api/student/profile", requireAuth, (req, res) => {
  try {
    if (req.user.role !== "student") {
      return res
        .status(403)
        .json({ ok: false, error: "Only students can update this profile" });
    }

    const roll = req.user.roll_number; // from JWT
    const { usn, semester } = req.body;

    if (!usn || !semester) {
      return res
        .status(400)
        .json({ ok: false, error: "USN and semester are required" });
    }

    const student = db
      .prepare(
        `
        SELECT id
        FROM students
        WHERE roll_number = ?
        LIMIT 1
      `
      )
      .get(roll);

    if (!student) {
      return res.status(404).json({ ok: false, error: "Student not found" });
    }

    db.prepare(
      `
      UPDATE students
      SET usn = ?, semester = ?
      WHERE roll_number = ?
    `
    ).run(usn, semester, roll);

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to save profile" });
  }
});

// Student can update own profile photo (matches ?roll= and body.photo_url)
app.post("/api/student/photo", requireAuth, (req, res) => {
  try {
    const roll = req.query.roll;
    const { photo_url } = req.body || {};

    if (!roll) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing roll parameter" });
    }

    if (!photo_url) {
      return res
        .status(400)
        .json({ ok: false, error: "photo_url is required" });
    }

    // Only allow a student to update their own photo
    if (req.user.role === "student" && req.user.roll_number !== roll) {
      return res
        .status(403)
        .json({ ok: false, error: "Forbidden for this student" });
    }

    const student = db
      .prepare(
        `
        SELECT id
        FROM students
        WHERE roll_number = ?
        LIMIT 1
      `
      )
      .get(roll);

    if (!student) {
      return res.status(404).json({ ok: false, error: "Student not found" });
    }

    db.prepare(
      `
      UPDATE students
      SET photo_url = ?
      WHERE roll_number = ?
    `
    ).run(photo_url, roll);

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to save photo" });
  }
});

// Simple attendance metrics stub
app.get("/api/student/attendance/metrics", requireAuth, (req, res) => {
  try {
    const roll = req.query.roll;
    if (!roll) {
      return res.status(400).json({ ok: false, error: "Missing roll" });
    }

    const student = db
      .prepare(
        `
        SELECT id
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
      return res
        .status(403)
        .json({ ok: false, error: "Forbidden for this student" });
    }

    return res.json({
      ok: true,
      metrics: {
        overall_percentage: 80,
        last_7_days_score: 85,
        last_7_days_comment: "Trending up this week",
        risk_subject_count: 1,
        risk_summary: "1 subject close to shortage",
      },
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to load metrics" });
  }
});

// Simple attendance list stub
app.get("/api/student/attendance", requireAuth, (req, res) => {
  try {
    const roll = req.query.roll;
    const view = req.query.view || "today";

    if (!roll) {
      return res.status(400).json({ ok: false, error: "Missing roll" });
    }

    const student = db
      .prepare(
        `
        SELECT id
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
      return res
        .status(403)
        .json({ ok: false, error: "Forbidden for this student" });
    }

    // For now, empty; you can wire real data later
    return res.json({ ok: true, attendance: [], view });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to load attendance" });
  }
});

// Upcoming classes stub
app.get("/api/student/upcoming", requireAuth, (req, res) => {
  try {
    const roll = req.query.roll;
    if (!roll) {
      return res.status(400).json({ ok: false, error: "Missing roll" });
    }

    const student = db
      .prepare(
        `
        SELECT id, section
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
      return res
        .status(403)
        .json({ ok: false, error: "Forbidden for this student" });
    }

    return res.json({
      ok: true,
      upcoming: [
        {
          subject: "AI & ML",
          time_label: "Today · 10:00–11:00",
          room: "Lab 3",
          type: "Lecture",
          faculty: "Prof. Joel",
          note: "Bring last lab notebook",
        },
      ],
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to load upcoming classes" });
  }
});

// ---------- Teacher-side attendance & students ----------

app.post(
  "/api/attendance",
  requireAuth,
  requireRole("teacher"),
  (req, res) => {
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
        req.user.id
      );
      const sessionId = sessionResult.lastInsertRowid;

      const insertStudent = db.prepare(
        `
      INSERT INTO students (name, roll_number, section, email, photo_url)
      VALUES (?, ?, ?, NULL, NULL)
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
            const result = insertStudent.run(
              s.name,
              s.rollNumber,
              section
            );
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
  }
);

app.get(
  "/api/sessions",
  requireAuth,
  requireRole("teacher"),
  (req, res) => {
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
  }
);

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

app.post(
  "/api/students",
  requireAuth,
  requireRole("teacher"),
  (req, res) => {
    try {
      const { name, rollNumber, section, photoUrl, email } = req.body;

      if (!name || !rollNumber || !section || !email) {
        return res.status(400).json({
          error: "name, rollNumber, section and email are required",
        });
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

// Update student photo (teacher or self via teacher tools)
app.put("/api/students/:roll/photo", requireAuth, async (req, res) => {
  try {
    const roll = req.params.roll;
    const { photoUrl } = req.body;

    if (!roll) {
      return res.status(400).json({ error: "Missing roll parameter" });
    }

    if (!photoUrl) {
      return res.status(400).json({ error: "photoUrl is required" });
    }

    const student = db
      .prepare(
        `
        SELECT id, roll_number
        FROM students
        WHERE roll_number = ?
        LIMIT 1
      `
      )
      .get(roll);

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    if (req.user.role === "student" && req.user.roll_number !== roll) {
      return res.status(403).json({ error: "Forbidden for this student" });
    }

    db.prepare(
      `
      UPDATE students
      SET photo_url = ?
      WHERE roll_number = ?
    `
    ).run(photoUrl, roll);

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: "Failed to update student photo" });
  }
});

// Enroll face token for a student (demo)
app.post(
  "/api/students/:roll/face-enroll",
  requireAuth,
  async (req, res) => {
    try {
      const roll = req.params.roll;
      const { face_token } = req.body;

      if (!roll) {
        return res.status(400).json({ ok: false, error: "Missing roll" });
      }

      if (!face_token) {
        return res
          .status(400)
          .json({ ok: false, error: "face_token is required" });
      }

      const student = db
        .prepare(
          `
          SELECT id, roll_number, email
          FROM students
          WHERE roll_number = ?
          LIMIT 1
        `
        )
        .get(roll);

      if (!student) {
        return res
          .status(404)
          .json({ ok: false, error: "Student not found" });
      }

      if (req.user.role === "student" && req.user.roll_number !== roll) {
        return res
          .status(403)
          .json({ ok: false, error: "Forbidden for this student" });
      }

      db.prepare(
        `
          UPDATE students
          SET face_token = ?
          WHERE roll_number = ?
        `
      ).run(face_token, roll);

      return res.json({ ok: true });
    } catch (err) {
      console.error(err);
      return res
        .status(500)
        .json({ ok: false, error: "Failed to enroll face login" });
    }
  }
);

// Per-student history by roll (student or teacher)
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

// ---------- Start server ----------

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
