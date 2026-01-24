// migrate-photo-url.js
const db = require('./db');

try {
  db.exec(`ALTER TABLE students ADD COLUMN photo_url TEXT;`);
  console.log('Added photo_url to students');
} catch (e) {
  console.log('Maybe photo_url already exists:', e.message);
}
