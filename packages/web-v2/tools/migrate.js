/**
 * MySQL → MongoDB Atlas migration script
 *
 * Reads all rows from the old MySQL tables (julion_users, julion_user_tokens,
 * julion_auth_sessions) and upserts them into the MongoDB Atlas collections.
 *
 * Run ONCE after pointing .env at Atlas:
 *   node --env-file=.env tools/migrate.js
 *
 * Safe to re-run — all operations are upserts, nothing is deleted from MySQL.
 */

import { MongoClient }   from "mongodb";
import mysql             from "mysql2/promise";
import { createRequire } from "module";

// ── helpers ──────────────────────────────────────────────────────────────────

function require(id) { return createRequire(import.meta.url)(id); }

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME   = process.env.DB_NAME || "julion";

const MYSQL_CONFIG = {
  host:     process.env.DB_HOST     || "127.0.0.1",
  port:     Number(process.env.DB_PORT || 3306),
  user:     process.env.DB_USER     || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "julion",
};

if (!MONGO_URI) {
  console.error("❌  MONGODB_URI is not set in .env");
  process.exit(1);
}

// ── connection setup ──────────────────────────────────────────────────────────

async function connectMongo() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log("✔  Connected to MongoDB Atlas");
  return client.db(DB_NAME);
}

async function connectMySQL() {
  let conn;
  try {
    conn = await mysql.createConnection(MYSQL_CONFIG);
    await conn.ping();
    console.log(`✔  Connected to MySQL  (${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${MYSQL_CONFIG.database})`);
    return conn;
  } catch (err) {
    console.warn(`⚠   MySQL not reachable: ${err.message}`);
    console.warn("    Skipping MySQL migration — only MongoDB collections will be initialised.");
    return null;
  }
}

// ── migrate users ─────────────────────────────────────────────────────────────

async function migrateUsers(sql, db) {
  console.log("\n── users ──────────────────────────────────────");
  let [rows] = await sql.execute("SELECT * FROM julion_users");
  console.log(`   Found ${rows.length} row(s) in julion_users`);

  let ok = 0, skip = 0;
  for (const row of rows) {
    try {
      await db.collection("members").updateOne(
        { email: row.email },
        {
          $set: {
            name:        row.name        || "",
            picture:     row.picture     || null,
            lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : null,
          },
          $setOnInsert: {
            createdAt: row.created_at ? new Date(row.created_at) : new Date(),
          },
        },
        { upsert: true }
      );
      ok++;
    } catch (e) {
      console.warn(`   skip ${row.email}: ${e.message}`);
      skip++;
    }
  }
  console.log(`   ✔  ${ok} upserted, ${skip} skipped`);
}

// ── migrate tokens ────────────────────────────────────────────────────────────

async function migrateTokens(sql, db) {
  console.log("\n── user_tokens ────────────────────────────────");
  let [rows] = await sql.execute("SELECT * FROM julion_user_tokens");
  console.log(`   Found ${rows.length} row(s) in julion_user_tokens`);

  let ok = 0, skip = 0;
  for (const row of rows) {
    try {
      await db.collection("user_tokens").updateOne(
        { userEmail: row.user_email },
        {
          $set: {
            tokenJson:  row.token_json,
            updatedAt:  row.updated_at ? new Date(row.updated_at) : new Date(),
          },
        },
        { upsert: true }
      );
      ok++;
    } catch (e) {
      console.warn(`   skip ${row.user_email}: ${e.message}`);
      skip++;
    }
  }
  console.log(`   ✔  ${ok} upserted, ${skip} skipped`);
}

// ── migrate auth sessions ─────────────────────────────────────────────────────

async function migrateSessions(sql, db) {
  console.log("\n── auth_sessions ──────────────────────────────");
  let [rows] = await sql.execute("SELECT * FROM julion_auth_sessions");
  console.log(`   Found ${rows.length} row(s) in julion_auth_sessions`);

  // Drop already-expired sessions — no point migrating them
  const now = new Date();
  rows = rows.filter((r) => new Date(r.expires_at) > now);
  console.log(`   ${rows.length} non-expired session(s) to migrate`);

  let ok = 0, skip = 0;
  for (const row of rows) {
    try {
      await db.collection("auth_sessions").updateOne(
        { sessionId: row.session_id },
        {
          $set: {
            sessionId:   row.session_id,
            status:      row.status,
            tokenJson:   row.token_json   || null,
            userEmail:   row.user_email   || null,
            userName:    row.user_name    || null,
            userPicture: row.user_picture || null,
            createdAt:   row.created_at ? new Date(row.created_at) : new Date(),
            expiresAt:   new Date(row.expires_at),
          },
        },
        { upsert: true }
      );
      ok++;
    } catch (e) {
      console.warn(`   skip ${row.session_id}: ${e.message}`);
      skip++;
    }
  }
  console.log(`   ✔  ${ok} upserted, ${skip} skipped`);
}

// ── create indexes ────────────────────────────────────────────────────────────

async function ensureIndexes(db) {
  console.log("\n── indexes ────────────────────────────────────");
  await db.collection("members").createIndex({ email: 1 }, { unique: true }).catch(() => {});
  await db.collection("user_tokens").createIndex({ userEmail: 1 }, { unique: true }).catch(() => {});
  await db.collection("auth_sessions").createIndex({ sessionId: 1 }, { unique: true }).catch(() => {});
  await db.collection("auth_sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
  await db.collection("auth_sessions").createIndex({ status: 1, expiresAt: 1 }).catch(() => {});
  console.log("   ✔  All indexes ensured");
}

// ── verify ────────────────────────────────────────────────────────────────────

async function verify(db) {
  const [users, tokens, sessions] = await Promise.all([
    db.collection("members").countDocuments(),
    db.collection("user_tokens").countDocuments(),
    db.collection("auth_sessions").countDocuments(),
  ]);
  console.log("\n── MongoDB counts ─────────────────────────────");
  console.log(`   members:         ${users}`);
  console.log(`   user_tokens:   ${tokens}`);
  console.log(`   auth_sessions: ${sessions}`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔄  Julion MySQL → MongoDB Atlas migration`);
  console.log(`    Target DB: ${DB_NAME}\n`);

  const [db, sql] = await Promise.all([connectMongo(), connectMySQL()]);

  // Always ensure collections + indexes (even if no MySQL data)
  for (const name of ["members", "user_tokens", "auth_sessions"]) {
    await db.createCollection(name).catch(() => {});
  }
  await ensureIndexes(db);

  if (sql) {
    try {
      await migrateUsers(sql, db);
      await migrateTokens(sql, db);
      await migrateSessions(sql, db);
    } finally {
      await sql.end().catch(() => {});
    }
  }

  await verify(db);
  console.log("\n✅  Migration complete.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌  Migration failed:", err.message);
  process.exit(1);
});
