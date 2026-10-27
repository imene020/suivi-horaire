import { listEmployees, getAllEntriesInRange } from "@/lib/queries";
import { EmployeesTable } from "@/components/admin/employees-table";
import { getMonthRange, nowInAppTimeZone } from "@/lib/date";
import { sumHours } from "@/lib/hours";

export default async function AdminEmployeesPage() {
  const now = nowInAppTimeZone();
  const { start, end } = getMonthRange(now.year, now.month);

  const [profiles, monthEntries] = await Promise.all([
    listEmployees(),
    getAllEntriesInRange(start, end),
  ]);
  const employees = profiles.map((p) => ({
    ...p,
    monthHours: sumHours(monthEntries.filter((e) => e.profile_id === p.id)),
  }));

  return (
    <div className="max-w-6xl">
      <EmployeesTable employees={employees} />
    </div>
  );
}
