import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { fetchProjects, fetchWorkload, updateWorkload } from "../api/workloadApi";
import { Lane, type LanePoint } from "./elements/lane";

type ProjectLaneState = {
    id: string;
    name: string;
    active: boolean;
    points: LanePoint[];
};

type ProjectSummary = {
    id: string;
    name: string;
    active: boolean;
};

type WorkloadTableProps = {
    employeeName: string;
    userId: string;
    weeklyCapacityHours?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

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

const sortPoints = (points: LanePoint[]) =>
    [...points].sort((a, b) => a.week - b.week || a.id.localeCompare(b.id));

const clonePoints = (points: LanePoint[]) => points.map((point) => ({ ...point }));

const clampWeekToIsoRange = (week: number, maxWeeks: number) =>
    clamp(Math.round(week), 1, Math.max(1, maxWeeks));

const projectLabelFor = (
    catalog: ProjectSummary[],
    projectId: string,
    fallback?: string
) => {
    const meta = catalog.find((project) => project.id === projectId);
    if (meta) return meta.name;
    if (fallback && fallback.trim().length > 0) return fallback;
    return projectId;
};

function WorkloadTable({ employeeName, userId, weeklyCapacityHours = 40 }: WorkloadTableProps) {
    const todayInfo = useMemo(() => getISOWeekInfo(new Date()), []);
    const displayYear = todayInfo.year;
    const currentYearWeeks = useMemo(() => getISOWeeksInYear(displayYear), [displayYear]);
    const activeWeekPosition = useMemo(() => {
        const fractional = todayInfo.week + (todayInfo.weekday - 1) / 7;
        return clamp(fractional, 0, currentYearWeeks);
    }, [todayInfo, currentYearWeeks]);

    const [projectLanes, setProjectLanes] = useState<ProjectLaneState[]>([]);
    const [projectsCatalog, setProjectsCatalog] = useState<ProjectSummary[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        void (async () => {
            const projects = await fetchProjects(userId);
            setProjectsCatalog(projects);
        })();
    }, [userId]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                setIsLoading(true);
                setErrorMessage(null);
                const data = await fetchWorkload(userId, displayYear);
                if (cancelled) return;

                const lanes = data.map((record) => ({
                    id: record.projectId,
                    name: projectLabelFor(projectsCatalog, record.projectId, record.name),
                    active:
                        projectsCatalog.find((p) => p.id === record.projectId)?.active ??
                        record.active,
                    points: sortPoints(
                        record.points.map((point) => ({
                            ...point,
                            week: clampWeekToIsoRange(point.week ?? 1, currentYearWeeks),
                            year: displayYear,
                        }))
                    ),
                }));

                setProjectLanes(lanes);
            } catch {
                if (!cancelled) setErrorMessage("Failed to load workload data. Please try again.");
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [userId, displayYear, projectsCatalog, currentYearWeeks]);

    const handleLaneChange = useCallback(
        (laneId: string, nextPoints: LanePoint[]) => {
            const normalizedPoints = sortPoints(
                nextPoints.map((point) => ({
                    ...point,
                    week: clampWeekToIsoRange(point.week ?? 1, currentYearWeeks),
                    year: displayYear,
                }))
            );

            setProjectLanes((prev) =>
                prev.map((lane) =>
                    lane.id === laneId ? { ...lane, points: clonePoints(normalizedPoints) } : lane
                )
            );

            void updateWorkload(userId, laneId, displayYear, normalizedPoints).catch(() => {
                setErrorMessage("Saving changes failed. Please retry.");
            });
        },
        [userId, displayYear, currentYearWeeks]
    );

    const selectableProjects = useMemo(() => {
        const existing = new Set(projectLanes.map((lane) => lane.id));
        return projectsCatalog.filter(
            (project) => project.active && !existing.has(project.id)
        );
    }, [projectLanes, projectsCatalog]);

    useEffect(() => {
        if (selectableProjects.length === 0) setSelectedProjectId("");
        else if (
            selectedProjectId === "" ||
            !selectableProjects.some((project) => project.id === selectedProjectId)
        ) {
            setSelectedProjectId(selectableProjects[0]?.id ?? "");
        }
    }, [selectableProjects, selectedProjectId]);

    const handleAddProject = useCallback(async () => {
        if (!selectedProjectId) return;
        if (isLoading) {
            setErrorMessage("Workload data is still loading. Please wait a moment.");
            return;
        }

        setIsSaving(true);
        setErrorMessage(null);

        const startWeek = 1;
        const endWeek = clampWeekToIsoRange(currentYearWeeks, currentYearWeeks);
        const defaultPoints: LanePoint[] = [
            { id: `${selectedProjectId}-start`, week: startWeek, hours: 0, year: displayYear },
            { id: `${selectedProjectId}-end`, week: endWeek, hours: 0, year: displayYear },
        ];

        try {
            const updated = await updateWorkload(userId, selectedProjectId, displayYear, defaultPoints);
            const label = projectLabelFor(projectsCatalog, updated.projectId, updated.name);
            const activeFlag =
                projectsCatalog.find((p) => p.id === updated.projectId)?.active ?? updated.active;

            setProjectLanes((prev) => [
                ...prev,
                {
                    id: updated.projectId,
                    name: label,
                    active: activeFlag,
                    points: sortPoints(updated.points),
                },
            ]);
        } catch {
            setErrorMessage("Adding project failed. Please retry.");
        } finally {
            setIsSaving(false);
        }
    }, [selectedProjectId, currentYearWeeks, userId, displayYear, projectsCatalog, isLoading]);

    const maxHours = (weeklyCapacityHours * 120) / 100;

    const summary = useMemo(() => {
        const weeklyTotals = Array(currentYearWeeks + 1).fill(0) as number[];

        projectLanes.forEach(({ active, points }) => {
            if (!active) return;
            const sorted = sortPoints(points);
            if (sorted.length === 0) return;

            let idx = 0;
            let last = sorted[0];
            for (let week = 1; week <= currentYearWeeks; week++) {
                while (idx < sorted.length && sorted[idx]!.week <= week) {
                    last = sorted[idx]!;
                    idx++;
                }
                if(weeklyTotals[week] === undefined) continue;
                if(last === undefined) continue;
                weeklyTotals[week] += clamp(last.hours, 0, maxHours);
            }
        });

        const relevant = weeklyTotals.slice(1);
        const peakHours = Math.max(...relevant, 0);
        const peakPercent = Math.round((peakHours / maxHours) * 100);

        const sumPoints: LanePoint[] = relevant.map((hours, i) => ({
            id: `sum-${i + 1}`,
            week: i + 1,
            hours,
            fixed: true,
            year: displayYear,
        }));

        return { sumPoints, peakHours, peakPercent };
    }, [projectLanes, currentYearWeeks, displayYear, maxHours]);

    return (
        <div className="workload-table w-full space-y-5 text-white">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold">{employeeName}</h2>
                    <p className="text-xs text-slate-300">
                        Weekly capacity: {weeklyCapacityHours}h (120% ceiling: {maxHours.toFixed(1)}h)
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                    <span className="text-sm font-semibold text-white">{displayYear}</span>
                    <span>Weeks: {currentYearWeeks}</span>
                    <span>Projects: {projectLanes.length}</span>
                    <span>
                        Peak load: {summary.peakHours.toFixed(1)}h ({summary.peakPercent}%)
                    </span>
                </div>
            </div>

            <div className="flex flex-col gap-3 rounded-md border border-slate-700/60 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={selectedProjectId}
                        onValueChange={setSelectedProjectId}
                        disabled={selectableProjects.length === 0 || isSaving}
                    >
                        <SelectTrigger className="w-[200px] border-slate-600/70 bg-slate-800/50 text-left text-slate-100">
                            <SelectValue placeholder="Add project" />
                        </SelectTrigger>
                        <SelectContent className="border-slate-600/70 bg-slate-800 text-slate-100">
                            {selectableProjects.map((project) => (
                                <SelectItem key={project.id} value={project.id}>
                                    {project.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        onClick={handleAddProject}
                        disabled={!selectedProjectId || isSaving || isLoading}
                        className="bg-slate-100 text-slate-900 hover:bg-white/80"
                    >
                        Add
                    </Button>
                </div>

                {errorMessage && (
                    <div className="rounded border border-red-600/60 bg-red-900/30 px-3 py-2 text-sm text-red-200">
                        {errorMessage}
                    </div>
                )}

                {isLoading ? (
                    <div className="text-sm text-slate-400">Loading workload data…</div>
                ) : projectLanes.length === 0 ? (
                    <div className="text-sm text-slate-400">
                        No workload recorded for {displayYear}.
                    </div>
                ) : (
                    projectLanes.map((lane) => (
                        <Lane
                            key={lane.id}
                            description={lane.name}
                            points={lane.points}
                            onPointsChange={(next) => handleLaneChange(lane.id, next)}
                            editable
                            capacityHours={weeklyCapacityHours}
                            snapStepHours={0.5}
                            totalWeeks={currentYearWeeks}
                            activeWeek={activeWeekPosition}
                            year={displayYear}
                        />
                    ))
                )}

                {!isLoading && summary.sumPoints.length > 0 && (
                    <div className="pt-1">
                        <Lane
                            description="Total workload"
                            points={summary.sumPoints}
                            editable={false}
                            capacityHours={weeklyCapacityHours}
                            showBands
                            totalWeeks={currentYearWeeks}
                            activeWeek={activeWeekPosition}
                            year={displayYear}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

export { WorkloadTable };
