"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { uploadEmployeeDocument } from "@/lib/actions/documents";
import { uploadTooLarge } from "@/lib/constants";

export function EmployeeUploadForm() {
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
    const result = await uploadEmployeeDocument(formData);

    setPending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }

    setSuccess(true);
    router.refresh();
    e.currentTarget.reset();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">Envoyer un document</h2>
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="category">Type de document</Label>
          <Select id="category" name="category" defaultValue="employe" required>
            <option value="employe">Autre</option>
            <option value="maladie">Certificat de maladie</option>
            <option value="cv">CV</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note">Note (optionnel)</Label>
          <Input id="note" name="note" placeholder="Ex: semaine du 12 avril" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="file">Fichier</Label>
          <Input
            id="file"
            name="file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            required
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>}
      {success && <p className="text-sm text-green-600 bg-green-50 rounded-md px-3 py-2">Document envoyé.</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Envoi..." : "Envoyer"}
      </Button>
    </form>
  );
}
