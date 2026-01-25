# SmartTrack AI

SmartTrack AI is a modern attendance tracking system that combines a sleek web UI with a Node.js + SQLite backend and real email-based authentication for teachers and students.

## Features

- Clean, responsive dashboard-style UI for attendance (teacher and student views).
- Quick student search and filtering by section and roll number.
- Status chips for Present, Late, and Absent.
- Daily summary card with total students and present count.
- Per-student attendance history view for both teacher and the logged-in student.
- Real authentication using email + password with hashed passwords (bcrypt) and JWT cookies.
- Student accounts auto-created by the teacher using **college email + a common class password** (no need for real email passwords).

## Tech stack

- Frontend: HTML5, CSS3 (glassmorphism-style dashboard layout), vanilla JS.
- Backend: Node.js with Express.
- Database: SQLite (via `better-sqlite3`) for lightweight storage.
- Auth: JWT (httpOnly cookie) + bcrypt password hashing.

## Project goals

- Make marking attendance fast and visually clear for teachers.
- Let students securely view their own attendance history.
- Provide a simple, extendable full-stack codebase (Node + SQLite).
- Be ready for future AI-assisted features (e.g., highlight frequently absent students).

## Getting started

1. Clone this repository:
   ```bash
   git clone https://github.com/zaidansheikh180-gif/smartTrack-AI.git
   cd smartTrack-AI
