/**
 * Admin tool — local dev/ops tasks against the MongoDB database.
 *
 *   node --env-file=.env tools/admin.js <command>
 *
 * Commands:
 *   list-users        Print all registered users
 *   list-sessions     Print last 20 auth sessions
 *   purge-sessions    Delete all expired sessions
 *   delete-user       Delete user + tokens (requires email arg)
 *   stats             Database collection counts
 */
import clientPromise from "../db/client.js";

async function db() {
  return (await clientPromise).db(process.env.DB_NAME);
}

const commands = {
  async "list-users"() {
    const users = await (await db()).collection("members").find().sort({ lastLoginAt: -1 }).toArray();
    console.log(`\n${users.length} user(s):\n`);
    users.forEach((u) =>
      console.log(`  ${u.email.padEnd(40)} ${(u.name || "").padEnd(28)} last login: ${u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : "never"}`)
    );
  },

  async "list-sessions"() {
    const sessions = await (await db())
      .collection("auth_sessions")
      .find()
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
    console.log(`\n${sessions.length} recent session(s):\n`);
    sessions.forEach((s) =>
      console.log(`  ${s.sessionId.slice(0, 16)}…  status:${s.status.padEnd(8)}  expires:${new Date(s.expiresAt).toISOString()}  user:${s.userEmail || "—"}`)
    );
  },

  async "purge-sessions"() {
    const result = await (await db())
      .collection("auth_sessions")
      .deleteMany({ expiresAt: { $lt: new Date() } });
    console.log(`\nPurged ${result.deletedCount} expired session(s).`);
  },

  async "delete-user"() {
    const email = process.argv[3];
    if (!email) {
      console.error("Usage: node tools/admin.js delete-user <email>");
      process.exit(1);
    }
    const d = await db();
    await d.collection("members").deleteOne({ email });
    await d.collection("user_tokens").deleteOne({ userEmail: email });
    await d.collection("auth_sessions").deleteMany({ userEmail: email });
    console.log(`\nDeleted user: ${email}`);
  },

  async "stats"() {
    const d = await db();
    const [users, tokens, sessions] = await Promise.all([
      d.collection("members").countDocuments(),
      d.collection("user_tokens").countDocuments(),
      d.collection("auth_sessions").countDocuments(),
    ]);
    console.log(`\nDatabase: ${process.env.DB_NAME}`);
    console.log(`  users:         ${users}`);
    console.log(`  user_tokens:   ${tokens}`);
    console.log(`  auth_sessions: ${sessions}`);
  },
};

async function main() {
  const cmd = process.argv[2];
  if (!cmd || !commands[cmd]) {
    console.log("\nUsage: node tools/admin.js <command>\n");
    console.log("Commands:");
    Object.keys(commands).forEach((c) => console.log(`  ${c}`));
    process.exit(0);
  }
  await commands[cmd]();
  process.exit(0);
}

main().catch((err) => {
  console.error("Admin error:", err.message);
  process.exit(1);
});
