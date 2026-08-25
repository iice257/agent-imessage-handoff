import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
let json = false;
if (args[0] === "-json") {
  json = true;
  args.shift();
}

const dbPath = args[0];
const sql = args.slice(1).join(" ");
if (!dbPath || !sql) {
  process.exit(1);
}

const db = existsSync(dbPath)
  ? safeJson(readFileSync(dbPath, "utf8"))
  : { threads: {} };

if (/^CREATE\s+TABLE\s+threads/i.test(sql)) {
  db.threads = db.threads || {};
  writeFileSync(dbPath, JSON.stringify(db), "utf8");
  process.exit(0);
}

const insert = sql.match(/INSERT\s+INTO\s+threads\s*\(\s*id\s*,\s*title\s*\)\s*VALUES\s*\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*\)/i);
if (insert) {
  db.threads = db.threads || {};
  db.threads[unescapeSql(insert[1])] = { title: unescapeSql(insert[2]) };
  writeFileSync(dbPath, JSON.stringify(db), "utf8");
  process.exit(0);
}

const select = sql.match(/SELECT\s+title\s+FROM\s+threads\s+WHERE\s+id\s*=\s*'((?:''|[^'])*)'\s+LIMIT\s+1/i);
if (select) {
  const row = db.threads?.[unescapeSql(select[1])];
  const rows = row ? [{ title: row.title }] : [];
  process.stdout.write(json ? JSON.stringify(rows) : rows.map((item) => item.title).join("\n"));
  process.exit(0);
}

process.stderr.write(`sqlite3 shim does not support SQL: ${sql}\n`);
process.exit(1);

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { threads: {} };
  }
}

function unescapeSql(value) {
  return String(value).replace(/''/g, "'");
}
