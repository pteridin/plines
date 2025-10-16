import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthUser } from "@/api/authApi";
import {
    fetchCapacitySummary,
    type EmployeeCapacitySummary,
} from "@/api/workloadApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lane, type LanePoint } from "@/components/elements/lane";

type CapacityOverviewViewProps = {
    currentUser: AuthUser;
    refreshSignal?: number;
};

const getISOWeekInfo = (date: Date) => {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNumber = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
    const isoYear = target.getUTCFullYear();

    const firstThursday = new Date(Date.UTC(isoYear, 0, 1));
    const firstThursdayDay = firstThursday.getUTCDay() || 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstThursdayDay);

    const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604800000);

    return { year: isoYear, week, weekday: dayNumber };
};

const getISOWeeksInYear = (year: number) => getISOWeekInfo(new Date(Date.UTC(year, 11, 28))).week;

const normalizeCapacityPoints = (
    basePoints: LanePoint[],
    year: number,
    totalWeeks: number
): LanePoint[] => {
    const totals = Array(totalWeeks).fill(0) as number[];
    for (const point of basePoints) {
        const week = Math.min(Math.max(1, Math.round(point.week ?? 1)), totalWeeks);
        totals[week - 1] = point.hours;
    }
    return totals.map((hours, index) => ({
        id: `sum-${index + 1}`,
        week: index + 1,
        hours,
        year,
        fixed: true,
    }));
};

const filterEmployees = (
    employees: EmployeeCapacitySummary[],
    nameFilter: string,
    selectedTags: string[]
) => {
    const search = nameFilter.trim().toLowerCase();
    const requireTags = selectedTags.map((tag) => tag.toLowerCase());
    return employees.filter((employee) => {
        const matchesName =
            search.length === 0 ||
            employee.name.toLowerCase().includes(search) ||
            employee.position.toLowerCase().includes(search) ||
            employee.tags.some((tag) => tag.toLowerCase().includes(search));

        const matchesTags =
            requireTags.length === 0 ||
            requireTags.every((tag) =>
                employee.tags.some((entry) => entry.toLowerCase() === tag)
            );

        return matchesName && matchesTags;
    });
};

export function CapacityOverviewView({
    currentUser,
    refreshSignal = 0,
}: CapacityOverviewViewProps) {
    const todayInfo = useMemo(() => getISOWeekInfo(new Date()), []);
    const [displayYear, setDisplayYear] = useState(() => todayInfo.year);
    const totalWeeks = useMemo(() => getISOWeeksInYear(displayYear), [displayYear]);
    const activeWeekPosition = useMemo(() => {
        if (displayYear !== todayInfo.year) return null;
        const fractional = todayInfo.week + (todayInfo.weekday - 1) / 7;
        return Math.min(Math.max(fractional, 0), totalWeeks);
    }, [displayYear, todayInfo, totalWeeks]);

    const [summaries, setSummaries] = useState<EmployeeCapacitySummary[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const [nameFilter, setNameFilter] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);

    const loadSummary = useCallback(async () => {
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const results = await fetchCapacitySummary(displayYear);
            setSummaries(results);
        } catch {
            setSummaries([]);
            setErrorMessage("Failed to load capacity overview. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }, [displayYear]);

    useEffect(() => {
        void loadSummary();
    }, [loadSummary, refreshSignal]);

    const availableTags = useMemo(() => {
        const tags = new Set<string>();
        summaries.forEach((employee) => {
            employee.tags.forEach((tag) => {
                tags.add(tag);
            });
        });
        return Array.from(tags).sort((a, b) => a.localeCompare(b));
    }, [summaries]);

    useEffect(() => {
        setSelectedTags((prev) => prev.filter((tag) => availableTags.includes(tag)));
    }, [availableTags]);

    const toggleTag = useCallback((tag: string) => {
        setSelectedTags((prev) => {
            if (prev.includes(tag)) {
                return prev.filter((entry) => entry !== tag);
            }
            return [...prev, tag];
        });
    }, []);

    const filteredSummaries = useMemo(
        () => filterEmployees(summaries, nameFilter, selectedTags),
        [summaries, nameFilter, selectedTags]
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                    <h1 className="text-xl font-semibold text-white">Capacity overview</h1>
                    <p className="text-sm text-slate-300">
                        Review each employee&apos;s summed workload for {displayYear}. Filters help locate
                        specific roles or skills.
                    </p>
                </div>
                <div className="flex flex-col gap-3 text-sm text-slate-200 sm:items-end">
                    <div className="flex items-center gap-2">
                        {displayYear !== todayInfo.year && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDisplayYear(todayInfo.year)}
                                className="border-slate-600/60 bg-slate-900/60 text-white hover:bg-slate-800/80"
                            >
                                Current year
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDisplayYear((prev) => prev - 1)}
                            aria-label="Previous year"
                            className="border border-slate-700/60 bg-slate-900/60 text-slate-200 hover:bg-slate-800/80"
                        >
                            ‹
                        </Button>
                        <span className="text-base font-semibold text-white">{displayYear}</span>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDisplayYear((prev) => prev + 1)}
                            aria-label="Next year"
                            className="border border-slate-700/60 bg-slate-900/60 text-slate-200 hover:bg-slate-800/80"
                        >
                            ›
                        </Button>
                    </div>
                    <div className="text-xs text-slate-400">
                        Viewing {filteredSummaries.length} of {summaries.length} employees.
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-slate-700/60 bg-slate-900/50 p-4 md:flex-row md:items-center md:justify-between">
                <Input
                    value={nameFilter}
                    onChange={(event) => setNameFilter(event.target.value)}
                    placeholder="Search by name, role, or tag"
                    className="border-slate-600/70 bg-slate-950/40 text-slate-100 md:max-w-sm"
                />
                <div className="flex flex-wrap gap-2">
                    {availableTags.length === 0 ? (
                        <span className="text-xs text-slate-500">No tags available.</span>
                    ) : (
                        availableTags.map((tag) => {
                            const isActive = selectedTags.includes(tag);
                            return (
                                <Button
                                    key={tag}
                                    size="sm"
                                    variant={isActive ? "default" : "outline"}
                                    onClick={() => toggleTag(tag)}
                                    className={
                                        isActive
                                            ? "bg-slate-100 text-slate-900 hover:bg-white/80"
                                            : "border-slate-600/70 bg-slate-900/60 text-slate-200 hover:bg-slate-800/70"
                                    }
                                >
                                    {tag}
                                </Button>
                            );
                        })
                    )}
                </div>
            </div>

            {errorMessage && (
                <div className="rounded border border-red-600/70 bg-red-900/30 px-3 py-2 text-sm text-red-200">
                    {errorMessage}
                </div>
            )}

            {isLoading ? (
                <div className="rounded border border-slate-700/60 bg-slate-900/50 px-4 py-6 text-sm text-slate-300">
                    Loading capacity data…
                </div>
            ) : filteredSummaries.length === 0 ? (
                <div className="rounded border border-slate-700/60 bg-slate-900/50 px-4 py-6 text-sm text-slate-300">
                    {summaries.length === 0
                        ? "No workload data available for this year."
                        : "No employees match the current filters."}
                </div>
            ) : (
                <div className="space-y-4">
            {filteredSummaries.map((employee) => {
                const normalizedPoints = normalizeCapacityPoints(
                    employee.points,
                    displayYear,
                    totalWeeks
                );
                const weeklyTotals = normalizedPoints.map((point) => point.hours);
                const peakHours = Math.max(...weeklyTotals, 0);
                const maxHours = (employee.workHours * 120) / 100;
                const peakPercent = maxHours > 0 ? Math.round((peakHours / maxHours) * 100) : 0;
                return (
                    <div
                        key={employee.id}
                        className="space-y-3 rounded-xl border border-slate-700/60 bg-slate-900/60 p-4 shadow-md"
                    >
                        <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                                {employee.name}
                                {!employee.active && (
                                    <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                                        Inactive
                                    </span>
                                )}
                            </div>
                            {employee.position && (
                                <div className="text-xs text-slate-300">{employee.position}</div>
                            )}
                            <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                                {employee.tags.length === 0 ? (
                                    <span className="text-slate-500">No tags</span>
                                ) : (
                                    employee.tags.map((tag) => (
                                        <span
                                            key={tag}
                                            className="rounded-full bg-slate-800/80 px-2 py-0.5 text-slate-200"
                                        >
                                            {tag}
                                        </span>
                                    ))
                                )}
                            </div>
                            <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                                <span>Capacity: {employee.workHours}h/week</span>
                                <span>
                                    Peak load: {peakHours.toFixed(1)}h ({peakPercent}% of 120%)
                                </span>
                            </div>
                        </div>
                        <Lane
                            description="Total workload"
                            points={normalizedPoints}
                            editable={false}
                            capacityHours={employee.workHours}
                            showBands
                            totalWeeks={totalWeeks}
                            activeWeek={activeWeekPosition}
                            year={displayYear}
                        />
                    </div>
                );
            })}
        </div>
    )}
</div>
    );
}
