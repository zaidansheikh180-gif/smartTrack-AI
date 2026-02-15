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

// Middleware
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static assets from root
app.use(express.static(path.resolve(__dirname)));

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
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ---------- Routes ----------

app.get("/", (req, res) => res.sendFile(path.resolve(__dirname, "landing.html")));
app.get("/login", (req, res) => res.sendFile(path.resolve(__dirname, "login.html")));
app.get("/teacher", (req, res) => res.sendFile(path.resolve(__dirname, "teacher.html")));
app.get("/student", (req, res) => res.sendFile(path.resolve(__dirname, "student.html")));

// ---------- Auth API ----------

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: "Missing fields" });

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role, roll_number: user.roll_number });
    setAuthCookie(res, token);

    let redirect = user.role === "teacher" ? "teacher.html" : `student.html?roll=${user.roll_number}`;
    res.json({ success: true, redirect });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/auth/face-login", async (req, res) => {
  try {
    const { descriptor } = req.body; // Array of numbers from face-api.js
    if (!descriptor) return res.status(400).json({ ok: false, error: "Missing face data" });

    // Fetch all students who have enrolled
    const students = db.prepare("SELECT roll_number, face_token FROM students WHERE face_token IS NOT NULL").all();
    let matchedRoll = null;
    const threshold = 0.6; // Standard distance for face-api recognition

    for (const s of students) {
      try {
        const enrolled = JSON.parse(s.face_token);
        // Euclidean distance calculation
        const dist = Math.sqrt(descriptor.reduce((acc, val, i) => acc + Math.pow(val - enrolled[i], 2), 0));
        if (dist < threshold) { matchedRoll = s.roll_number; break; }
      } catch (e) { continue; }
    }

    if (!matchedRoll) return res.status(401).json({ ok: false, error: "Face not recognized" });

    const user = db.prepare("SELECT * FROM users WHERE roll_number = ?").get(matchedRoll);
    if (!user) return res.status(404).json({ ok: false, error: "Account not found" });

    const token = signToken({ id: user.id, email: user.email, role: user.role, roll_number: user.roll_number });
    setAuthCookie(res, token);
    res.json({ ok: true, redirect: `student.html?roll=${user.roll_number}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Face login failed" });
  }
});

// ---------- Data APIs ----------

app.get("/api/student/profile", requireAuth, (req, res) => {
  const roll = req.query.roll;
  const student = db.prepare("SELECT * FROM students WHERE roll_number = ?").get(roll);
  res.json({ ok: true, student });
});

app.post("/api/students/:roll/face-enroll", requireAuth, (req, res) => {
  try {
    const { face_token } = req.body;
    db.prepare("UPDATE students SET face_token = ? WHERE roll_number = ?").run(face_token, req.params.roll);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Enroll failed" });
  }
});

app.listen(PORT, () => console.log(`Server live on port ${PORT}`));
