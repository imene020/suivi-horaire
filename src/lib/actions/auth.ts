"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { verifyPassword } from "@/lib/db";
import { findProfileByEmail, createPasswordReset, resetPasswordWithToken } from "@/lib/queries";
import { createSession, destroySession } from "@/lib/session";
import { getClientIp, isRateLimited, recordFailedAttempt, clearAttempts } from "@/lib/rate-limit";
import { sendPasswordResetEmail } from "@/lib/notifications";

const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_RESET_REQUESTS = 5;
const RESET_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export async function signIn(_prevState: { error: string } | null, formData: FormData) {
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");

  const ip = await getClientIp();
  // Limite par IP et par compte visé pour ralentir aussi bien le bourrage
  // d'identifiants (un email, beaucoup de mots de passe) que le balayage
  // d'emails depuis une même adresse.
  const ipKey = `login:ip:${ip}`;
  const emailKey = `login:email:${email}`;

  if ((await isRateLimited(ipKey, MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS)) || (await isRateLimited(emailKey, MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS))) {
    return { error: "Trop de tentatives. Réessayez dans quelques minutes." };
  }

  const profile = email ? await findProfileByEmail(email) : null;
  if (!profile || !verifyPassword(password, profile.password_hash)) {
    await Promise.all([recordFailedAttempt(ipKey), recordFailedAttempt(emailKey)]);
    return { error: "Email ou mot de passe incorrect." };
  }

  await Promise.all([clearAttempts(ipKey), clearAttempts(emailKey)]);
  await createSession(profile.id);
  redirect("/");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}

/**
 * URL publique de l'application, utilisée dans les liens envoyés par email.
 * Elle ne doit PAS venir de l'en-tête Host de la requête : un attaquant pourrait
 * demander une réinitialisation pour la victime avec un Host forgé, et la victime
 * recevrait un vrai email contenant un vrai jeton... pointant vers le site de
 * l'attaquant. Ordre : APP_URL, puis l'URL de production fournie par Vercel, puis
 * (en développement uniquement) l'en-tête Host.
 */
async function getAppBaseUrl(): Promise<string | null> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.NODE_ENV === "development") {
    const host = (await headers()).get("host");
    return host ? `http://${host}` : null;
  }
  return null;
}

/** Toujours le même message générique, pour ne pas révéler si un email existe. */
const RESET_REQUEST_GENERIC_MESSAGE =
  "Si un compte existe avec cet email, un lien de réinitialisation vient de lui être envoyé.";

export async function requestPasswordReset(_prevState: { message: string; error?: boolean } | null, formData: FormData) {
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return { message: "Adresse email invalide.", error: true };
  }

  const ip = await getClientIp();
  const key = `reset:${ip}:${email}`;
  if (await isRateLimited(key, MAX_RESET_REQUESTS, RESET_WINDOW_MS)) {
    return { message: "Trop de demandes. Réessayez plus tard.", error: true };
  }
  await recordFailedAttempt(key);

  const profile = await findProfileByEmail(email);
  if (profile && profile.active) {
    const baseUrl = await getAppBaseUrl();
    if (!baseUrl) {
      console.error("[reset-password] APP_URL non configurée : lien de réinitialisation non envoyé.");
    } else {
      const token = await createPasswordReset(profile.id);
      await sendPasswordResetEmail(profile, `${baseUrl}/reset-password/${token}`);
    }
  }

  // Réponse identique que le compte existe ou non (anti-énumération d'emails).
  return { message: RESET_REQUEST_GENERIC_MESSAGE };
}

export async function resetPasswordAction(
  _prevState: { message: string; error?: boolean; success?: boolean } | null,
  formData: FormData
) {
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { message: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`, error: true };
  }
  if (password !== confirm) {
    return { message: "Les mots de passe ne correspondent pas.", error: true };
  }

  const result = await resetPasswordWithToken(token, password);
  if (result.error) {
    return { message: result.error, error: true };
  }

  return { message: "Mot de passe mis à jour. Vous pouvez vous connecter.", success: true };
}
