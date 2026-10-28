"use server";

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_ERROR } from "@/lib/constants";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin } from "@/lib/session";
import {
  createMeeting,
  updateMeeting,
  deleteMeeting,
  saveMeetingMinutes,
  getMeetingById,
  listMeetingParticipants,
  createMeetingAttachment,
  deleteMeetingAttachment,
  getMeetingAttachmentById,
  findProfileById,
} from "@/lib/queries";
import { notifyMeetingInvite } from "@/lib/notifications";
import { MeetingRecurrence, Profile } from "@/lib/types";

const ALLOWED_EXT = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg"]);

function revalidateAll(meetingId?: string) {
  revalidatePath("/admin/meetings");
  revalidatePath("/meetings");
  if (meetingId) revalidatePath(`/meetings/${meetingId}`);
}

async function resolveParticipants(ids: string[]): Promise<Profile[]> {
  const profiles = await Promise.all(ids.map((id) => findProfileById(id)));
  return profiles.filter((p): p is Profile => !!p);
}

export async function createMeetingAction(input: {
  title: string;
  description: string;
  location: string;
  meeting_link: string;
  start_at: string;
  end_at: string | null;
  recurrence: MeetingRecurrence;
  recurrence_until: string | null;
  participant_ids: string[];
}) {
  const me = await requireAdmin();
  if (!input.title.trim()) return { error: "Le titre est requis." };
  if (!input.start_at) return { error: "La date/heure de début est requise." };

  const meetings = await createMeeting({ ...input, created_by: me.id });

  if (input.participant_ids.length > 0 && meetings.length > 0) {
    const participants = await resolveParticipants(input.participant_ids);
    after(() => notifyMeetingInvite(participants, meetings[0], me.full_name));
  }

  revalidateAll();
  return { success: true, count: meetings.length };
}

export async function updateMeetingAction(
  id: string,
  input: {
    title: string;
    description: string;
    location: string;
    meeting_link: string;
    start_at: string;
    end_at: string | null;
    participant_ids: string[];
    notifyParticipants: boolean;
  }
) {
  const me = await requireAdmin();
  if (!input.title.trim()) return { error: "Le titre est requis." };

  const result = await updateMeeting(id, input);
  if (result.error) return { error: result.error };

  if (input.notifyParticipants && input.participant_ids.length > 0) {
    const [participants, meeting] = await Promise.all([resolveParticipants(input.participant_ids), getMeetingById(id)]);
    if (meeting) after(() => notifyMeetingInvite(participants, meeting, me.full_name));
  }

  revalidateAll(id);
  return { success: true };
}

export async function deleteMeetingAction(id: string) {
  await requireAdmin();
  await deleteMeeting(id);
  revalidateAll();
  return { success: true };
}

export async function saveMeetingMinutesAction(id: string, minutes: string) {
  await requireAdmin();
  await saveMeetingMinutes(id, minutes);
  revalidateAll(id);
  return { success: true };
}

export async function resendMeetingReminderAction(id: string) {
  const me = await requireAdmin();
  const [meeting, participants] = await Promise.all([getMeetingById(id), listMeetingParticipants(id)]);
  if (!meeting) return { error: "Réunion introuvable." };

  const profiles = await resolveParticipants(participants.map((p) => p.profile_id));
  after(() => notifyMeetingInvite(profiles, meeting, me.full_name));
  return { success: true };
}

function isAllowedAttachment(file: File): boolean {
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  return ALLOWED_EXT.has(ext);
}

export async function uploadMeetingAttachmentAction(formData: FormData, meetingId: string) {
  await requireAdmin();

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Veuillez sélectionner un fichier." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: MAX_UPLOAD_ERROR };
  if (!isAllowedAttachment(file)) return { error: "Type de fichier non autorisé." };

  const buffer = Buffer.from(await file.arrayBuffer());
  await createMeetingAttachment({
    meeting_id: meetingId,
    original_name: file.name,
    mime_type: file.type || "application/octet-stream",
    size: file.size,
    buffer,
  });

  revalidateAll(meetingId);
  return { success: true };
}

export async function removeMeetingAttachmentAction(attachmentId: string, meetingId: string) {
  await requireAdmin();
  const attachment = await getMeetingAttachmentById(attachmentId);
  if (!attachment || attachment.meeting_id !== meetingId) return { error: "Pièce jointe introuvable." };
  await deleteMeetingAttachment(attachmentId);
  revalidateAll(meetingId);
  return { success: true };
}
