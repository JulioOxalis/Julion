/**
 * Seed script — run once to create collections, indexes, and (optionally) test data.
 *
 *   node --env-file=.env tools/seed.js
 *   SEED_TEST_DATA=true node --env-file=.env tools/seed.js
 */
import clientPromise from "../db/client.js";

async function seed() {
  const client = await clientPromise;
  const db     = client.db(process.env.DB_NAME);

  console.log(`\nConnected to database: ${process.env.DB_NAME}`);

  // ── Create collections ─────────────────────────────────────────────────────
  for (const name of ["members", "user_tokens", "auth_sessions"]) {
    await db.createCollection(name).catch(() => {}); // ignore "already exists"
    console.log(`  collection: ${name}`);
  }

  // ── Indexes ────────────────────────────────────────────────────────────────
  await db.collection("members").createIndex({ email: 1 }, { unique: true });
  await db.collection("user_tokens").createIndex({ userEmail: 1 }, { unique: true });
  await db.collection("auth_sessions").createIndex({ sessionId: 1 }, { unique: true });

  // TTL index — MongoDB auto-purges expired sessions
  await db.collection("auth_sessions").createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  );
  await db.collection("auth_sessions").createIndex({ status: 1, expiresAt: 1 });

  console.log("\n  Indexes created.");

  // ── Optional test data ─────────────────────────────────────────────────────
  if (process.env.SEED_TEST_DATA === "true") {
    await db.collection("members").insertMany([
      { email: "test1@example.com", name: "Test User 1", picture: null, createdAt: new Date() },
      { email: "test2@example.com", name: "Test User 2", picture: null, createdAt: new Date() },
    ]).catch(() => {});
    console.log("  Test members inserted.");
  }

  console.log("\nDatabase seeded successfully.\n");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
