"use server";

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_ERROR } from "@/lib/constants";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser, requireAdmin } from "@/lib/session";
import { createDocument, deleteDocumentRecord, findProfileById, getDocumentById } from "@/lib/queries";
import { notifyPayslipUploaded } from "@/lib/notifications";
import { DocumentRecord } from "@/lib/db";


const ALLOWED_CATEGORIES: DocumentRecord["category"][] = ["employe", "paie", "maladie", "cv"];

// Types de fichiers acceptés : documents et images courants uniquement.
// Le Content-Disposition "attachment" au téléchargement neutralise déjà le
// risque de rendu HTML/SVG dans le navigateur, mais on limite tout de même
// les types acceptés en amont.
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx"]);

function safeCategory(value: string | null): DocumentRecord["category"] {
  return ALLOWED_CATEGORIES.includes(value as DocumentRecord["category"]) ? (value as DocumentRecord["category"]) : "employe";
}

function isAllowedFile(file: File): boolean {
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;
  // Le type MIME envoyé par le navigateur peut être vide ; on ne bloque que
  // s'il est renseigné ET non reconnu, pour rester tolérant.
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) return false;
  return true;
}

async function fileToBuffer(file: File): Promise<Buffer> {
  return Buffer.from(await file.arrayBuffer());
}

export async function uploadEmployeeDocument(formData: FormData) {
  const me = await requireUser();

  const file = formData.get("file") as File | null;
  const note = formData.get("note") as string | null;
  const category = safeCategory(formData.get("category") as string | null);

  if (!file || file.size === 0) return { error: "Veuillez sélectionner un fichier." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: MAX_UPLOAD_ERROR };
  if (!isAllowedFile(file)) return { error: "Type de fichier non autorisé (PDF, Word ou image uniquement)." };

  const buffer = await fileToBuffer(file);
  await createDocument({
    profile_id: me.id,
    original_name: file.name,
    mime_type: file.type || "application/octet-stream",
    size: file.size,
    buffer,
    category,
    note,
  });

  revalidatePath("/dashboard/documents");
  return { success: true };
}

export async function uploadPaySlip(formData: FormData, profileId: string) {
  await requireAdmin();

  const file = formData.get("file") as File | null;
  const note = formData.get("note") as string | null;

  if (!file || file.size === 0) return { error: "Veuillez sélectionner un fichier." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: MAX_UPLOAD_ERROR };
  if (!isAllowedFile(file)) return { error: "Type de fichier non autorisé (PDF, Word ou image uniquement)." };

  const buffer = await fileToBuffer(file);
  await createDocument({
    profile_id: profileId,
    original_name: file.name,
    mime_type: file.type || "application/octet-stream",
    size: file.size,
    buffer,
    category: "paie",
    note,
  });

  const employee = await findProfileById(profileId);
  if (employee) after(() => notifyPayslipUploaded(employee, file.name));

  revalidatePath(`/admin/employees/${profileId}`);
  revalidatePath("/dashboard/documents");
  return { success: true };
}

export async function removeDocument(documentId: string, profileId: string) {
  const me = await requireUser();
  const isAdmin = me.role === "admin";

  if (!isAdmin && me.id !== profileId) return { error: "Accès refusé." };

  // Vérifie que le document appartient bien au profil revendiqué avant de le
  // supprimer : sans ce contrôle, un employé pourrait supprimer le document
  // d'un autre employé en devinant/récupérant son identifiant (IDOR).
  const doc = await getDocumentById(documentId);
  if (!doc) return { error: "Document introuvable." };
  if (!isAdmin && doc.profile_id !== me.id) return { error: "Accès refusé." };

  const result = await deleteDocumentRecord(documentId);
  if (result.error) return { error: result.error };

  revalidatePath("/dashboard/documents");
  revalidatePath(`/admin/employees/${profileId}`);
  return { success: true };
}
