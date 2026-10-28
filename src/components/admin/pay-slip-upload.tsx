"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadPaySlip, removeDocument } from "@/lib/actions/documents";
import { uploadTooLarge } from "@/lib/constants";

interface PaieDoc {
  id: string;
  original_name: string;
  uploaded_at: string;
  note: string | null;
}

export function PaySlipUpload({ profileId, documents }: { profileId: string; documents: PaieDoc[] }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(false);

    const formData = new FormData(e.currentTarget);
    const tooLarge = uploadTooLarge(formData);
    if (tooLarge) {
      setPending(false);
      setError(tooLarge);
      return;
    }
    const result = await uploadPaySlip(formData, profileId);

    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }

    setSuccess(true);
    router.refresh();
    e.currentTarget.reset();
  }

  async function handleDelete(documentId: string) {
    if (!confirm("Supprimer cette fiche de paie ?")) return;
    const result = await removeDocument(documentId, profileId);
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">Fiches de paie</h2>
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="note">Mois / note</Label>
          <Input id="note" name="note" placeholder="Ex: Avril 2026" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="file">Fichier</Label>
          <Input id="file" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" required />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>}
      {success && <p className="text-sm text-green-600 bg-green-50 rounded-md px-3 py-2">Fiche de paie envoyée.</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Envoi..." : "Uploader la fiche"}
      </Button>

      {documents.length > 0 && (
        <div className="pt-4 border-t border-slate-100 divide-y divide-slate-100">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between py-2">
              <a
                href={`/api/documents/${doc.id}`}
                className="text-sm text-[#545454] hover:underline"
                title={doc.note || undefined}
              >
                {doc.original_name}
                {doc.note ? ` — ${doc.note}` : ""}
              </a>
              <span className="text-xs text-slate-500">
                {new Date(doc.uploaded_at).toLocaleDateString("fr-FR")}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(doc.id)}
                className="text-xs text-red-600 hover:underline"
              >
                Supprimer
              </button>
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
