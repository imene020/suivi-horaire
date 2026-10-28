"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, Bell, Paperclip, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  updateMeetingAction,
  deleteMeetingAction,
  saveMeetingMinutesAction,
  resendMeetingReminderAction,
  uploadMeetingAttachmentAction,
  removeMeetingAttachmentAction,
} from "@/lib/actions/meetings";
import { Meeting, MeetingAttachment, MeetingParticipant, Profile } from "@/lib/types";
import { uploadTooLarge } from "@/lib/constants";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function MeetingDetail({
  meeting,
  participants,
  attendees,
  attachments,
}: {
  meeting: Meeting;
  participants: MeetingParticipant[];
  attendees: Profile[];
  attachments: MeetingAttachment[];
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState(meeting.title);
  const [description, setDescription] = React.useState(meeting.description ?? "");
  const [location, setLocation] = React.useState(meeting.location ?? "");
  const [link, setLink] = React.useState(meeting.meeting_link ?? "");
  const [startAt, setStartAt] = React.useState(toLocalInput(meeting.start_at));
  const [endAt, setEndAt] = React.useState(toLocalInput(meeting.end_at));
  const [selected, setSelected] = React.useState<string[]>(participants.map((p) => p.profile_id));
  const [notify, setNotify] = React.useState(false);
  const [minutes, setMinutes] = React.useState(meeting.minutes ?? "");
  const [saving, setSaving] = React.useState(false);
  const [savingMinutes, setSavingMinutes] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const result = await updateMeetingAction(meeting.id, {
      title,
      description,
      location,
      meeting_link: link,
      start_at: new Date(startAt).toISOString(),
      end_at: endAt ? new Date(endAt).toISOString() : null,
      participant_ids: selected,
      notifyParticipants: notify,
    });
    setSaving(false);
    setMessage(result?.error ?? "Enregistré.");
    router.refresh();
  }

  async function handleSaveMinutes() {
    setSavingMinutes(true);
    await saveMeetingMinutesAction(meeting.id, minutes);
    setSavingMinutes(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm(`Supprimer la réunion "${meeting.title}" ?`)) return;
    await deleteMeetingAction(meeting.id);
    router.push("/admin/meetings");
  }

  async function handleRemind() {
    await resendMeetingReminderAction(meeting.id);
    setMessage("Rappel envoyé aux participants.");
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    setUploadError(null);
    const tooLarge = uploadTooLarge(formData);
    if (tooLarge) {
      setUploadError(tooLarge);
      return;
    }
    setUploading(true);
    const result = await uploadMeetingAttachmentAction(formData, meeting.id);
    setUploading(false);
    if (result?.error) {
      setUploadError(result.error);
      return;
    }
    form.reset();
    router.refresh();
  }

  async function handleRemoveAttachment(id: string) {
    await removeMeetingAttachmentAction(id, meeting.id);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-slate-900 font-semibold">Détails</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Titre</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Début</Label>
              <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Fin</Label>
              <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Lieu</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Lien visio</Label>
              <Input value={link} onChange={(e) => setLink(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Participants</Label>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {attendees.map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                  <span className="text-slate-900">{p.full_name}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Notifier les participants de ces changements
          </label>

          {message && <p className="text-sm text-slate-600">{message}</p>}

          <div className="flex justify-between pt-2">
            <div className="flex gap-2">
              <Button type="button" variant="destructive" size="sm" onClick={handleDelete}>
                <Trash2 className="h-3.5 w-3.5" /> Supprimer
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleRemind}>
                <Bell className="h-3.5 w-3.5" /> Renvoyer un rappel
              </Button>
            </div>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-slate-900 font-semibold">Compte-rendu</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            rows={6}
            placeholder="Notes et décisions prises pendant la réunion..."
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={handleSaveMinutes} disabled={savingMinutes}>
              {savingMinutes ? "Enregistrement..." : "Enregistrer le compte-rendu"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-slate-900 font-semibold">Pièces jointes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={handleUpload} className="flex items-center gap-2">
            <Input type="file" name="file" required />
            <Button type="submit" size="sm" disabled={uploading}>
              <Paperclip className="h-3.5 w-3.5" />
              {uploading ? "Envoi..." : "Ajouter"}
            </Button>
          </form>
          {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
          {attachments.length > 0 && (
            <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2">
                  <a
                    href={`/api/meeting-attachments/${a.id}`}
                    className="inline-flex items-center gap-1.5 text-sm text-[#545454] hover:underline"
                  >
                    <Download className="h-3.5 w-3.5" /> {a.original_name}
                  </a>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(a.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Supprimer
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
