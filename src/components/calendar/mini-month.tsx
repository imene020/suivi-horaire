"use client";

import { getMonthGrid, todayStr as getTodayStr } from "@/lib/date";
import { DAY_TYPE_COLORS, MONTH_NAMES_FR } from "@/lib/constants";
import { DayType } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];

/** Marqueur libre pour une date (ex : absence d'un employé, couleur par employé). */
export interface DayMarker {
  className: string;
  title?: string;
  /** Nombre d'éléments regroupés sur ce jour (affiche un compteur si > 1). */
  count?: number;
}

interface MiniMonthProps {
  year: number;
  month: number;
  dayTypeByDate: Record<string, DayType>;
  markersByDate?: Record<string, DayMarker>;
  onDayClick?: (date: string) => void;
}

export function MiniMonth({ year, month, dayTypeByDate, markersByDate, onDayClick }: MiniMonthProps) {
  const weeks = getMonthGrid(year, month);
  const todayStr = getTodayStr();

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-sm font-medium text-slate-900 mb-2 text-center">{MONTH_NAMES_FR[month]}</p>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_LETTERS.map((l, i) => (
          <span key={i} className="text-[10px] text-slate-400 text-center">
            {l}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((date, di) => {
              if (!date) return <div key={di} className="h-6" />;
              const dayType = dayTypeByDate[date];
              const marker = dayType ? undefined : markersByDate?.[date];
              const day = Number(date.slice(-2));
              const isToday = date === todayStr;
              return (
                <button
                  type="button"
                  key={di}
                  disabled={!onDayClick}
                  onClick={() => onDayClick?.(date)}
                  title={marker?.title}
                  className={cn(
                    "relative h-6 rounded text-[11px] flex items-center justify-center transition-colors",
                    dayType
                      ? DAY_TYPE_COLORS[dayType]
                      : marker
                        ? marker.className
                        : "text-slate-500 hover:bg-slate-100",
                    isToday && "ring-1 ring-[#736d6c]",
                    onDayClick && "cursor-pointer"
                  )}
                >
                  {day}
                  {marker && (marker.count ?? 1) > 1 && (
                    <span className="absolute -top-1 -right-1 h-3.5 min-w-[14px] px-0.5 rounded-full bg-slate-800 text-white text-[9px] leading-[14px] text-center">
                      {marker.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
