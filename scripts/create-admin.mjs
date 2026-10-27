#!/usr/bin/env node
// Crée (ou promeut) un compte administrateur RH.
//
//   DATABASE_URL=postgresql://... node scripts/create-admin.mjs admin@example.com "Admin RH"
//
// Le mot de passe est demandé au clavier (ou lu dans ADMIN_PASSWORD).
// Si un compte existe déjà avec cet email, il devient admin et son mot de passe est remplacé.
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { neon } from "@neondatabase/serverless";

const [email, fullName = "Admin RH"] = process.argv.slice(2);
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage : node scripts/create-admin.mjs <email> ["Nom complet"]');
  process.exit(1);
}
if (!url) {
  console.error("DATABASE_URL (ou POSTGRES_URL) doit être défini.");
  process.exit(1);
}

let password = process.env.ADMIN_PASSWORD;
if (!password) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question("Mot de passe (8 caractères minimum) : ");
  rl.close();
}
if (!password || password.length < 8) {
  console.error("Mot de passe trop court (8 caractères minimum).");
  process.exit(1);
}

// Même format que hashPassword() dans src/lib/db.ts : "<sel hex>:<hash scrypt hex>".
const salt = crypto.randomBytes(16).toString("hex");
const passwordHash = `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
const normalizedEmail = email.trim().toLowerCase();

const sql = neon(url);
const existing = await sql`SELECT id FROM profiles WHERE lower(email) = ${normalizedEmail} LIMIT 1`;

if (existing.length > 0) {
  await sql`UPDATE profiles SET role = 'admin', active = true, password_hash = ${passwordHash} WHERE id = ${existing[0].id}`;
  console.log(`Compte existant ${normalizedEmail} promu administrateur (mot de passe remplacé).`);
} else {
  await sql`INSERT INTO profiles (id, email, full_name, role, function_title, company, password_hash, qr_token, active, created_at)
    VALUES (${crypto.randomUUID()}, ${normalizedEmail}, ${fullName}, 'admin', 'Responsable RH', '', ${passwordHash},
      ${crypto.randomUUID()}, true, ${new Date().toISOString()})`;
  console.log(`Administrateur ${normalizedEmail} créé.`);
}
