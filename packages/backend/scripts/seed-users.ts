import "dotenv/config";
import * as argon2 from "argon2";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { config } from "../src/config/index.js";
import fs from "node:fs";
import path from "node:path";

interface UserSeed {
  email: string;
  password: string;
  name: string;
}

const SEED_USERS: UserSeed[] = [
  {
    email: "admin@example.com",
    password: "admin123",
    name: "Administrador",
  },
  {
    email: "doctor@example.com",
    password: "doctor123",
    name: "Dr. García",
  },
];

async function seedUsers(): Promise<void> {
  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(config.databasePath);

  db.pragma("foreign_keys = ON");

  const schemaPath = new URL("../src/db/schema.sql", import.meta.url);
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO users (id, email, password_hash, name)
    VALUES (?, ?, ?, ?)
  `);

  for (const user of SEED_USERS) {
    const existingUser = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(user.email) as { id: string } | undefined;

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
