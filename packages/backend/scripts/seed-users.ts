import * as argon2 from "argon2";
import Database from "better-sqlite3";
import "dotenv/config";
import { v4 as uuidv4 } from "uuid";

// Get database path from environment or use default
const DATABASE_PATH = process.env.DATABASE_PATH || "./data/mrp.db";

interface UserSeed {
  email: string;
  password: string;
  name: string;
}

const SEED_USERS: UserSeed[] = [
  {
    email: "admin@user.com",
    password: "admin123",
    name: "Admin User",
  },
];

async function seedUsers(): Promise<void> {
  console.log(`Opening database at ${DATABASE_PATH}`);
  const db = new Database(DATABASE_PATH);

  db.pragma("foreign_keys = ON");

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO users (id, email, password_hash, name)
    VALUES (?, ?, ?, ?)
  `);

  for (const user of SEED_USERS) {
    const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(user.email) as
      | { id: string }
      | undefined;

    const userId = existingUser?.id ?? uuidv4();
    const passwordHash = await argon2.hash(user.password);

    insertStmt.run(userId, user.email, passwordHash, user.name);
    console.log(`User seeded: ${user.email}`);
  }

  db.close();
  console.log("Seed completed successfully");
}

seedUsers().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
