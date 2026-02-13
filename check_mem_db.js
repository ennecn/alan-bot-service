const Database = require("better-sqlite3");
const db = new Database("/home/node/.openclaw/memory/main.sqlite", {readonly:true});
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("Tables:", tables.map(t=>t.name).join(", "));
for (const t of tables) {
  try {
    const count = db.prepare("SELECT COUNT(*) as c FROM " + t.name).get();
    console.log("  " + t.name + ": " + count.c + " rows");
  } catch(e) {}
}
try {
  const recent = db.prepare("SELECT substr(text,1,100) as t FROM memories ORDER BY rowid DESC LIMIT 3").all();
  console.log("Recent memories:");
  recent.forEach(r => console.log("  -", r.t));
} catch(e) { console.log("No memories table:", e.message); }
db.close();
