import { OcrImportForm } from "@/components/admin/ocr-import-form";
import { listEmployees, listOcrDrafts } from "@/lib/queries";
import { isAiReadingEnabled } from "@/lib/ai-timesheet";

// La lecture d'une feuille (IA ou OCR local) peut prendre plusieurs dizaines de secondes.
export const maxDuration = 60;

export default async function AdminOcrImportPage() {
  const [employees, drafts] = await Promise.all([listEmployees(), listOcrDrafts("pending")]);

  return (
    <div className="max-w-6xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Import par scan</h1>
        <p className="text-sm text-slate-500">
          Prenez en photo ou scannez une feuille de présence papier : les heures sont extraites automatiquement,
          puis additionnées à l&apos;historique existant après votre validation.
        </p>
      </div>
      <OcrImportForm
        employees={employees.map((e) => ({ id: e.id, full_name: e.full_name, email: e.email }))}
        initialDrafts={drafts}
        aiEnabled={isAiReadingEnabled()}
      />
    </div>
  );
}
