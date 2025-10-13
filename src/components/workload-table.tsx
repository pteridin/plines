import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import { fetchProjects, fetchWorkload, updateWorkload } from "../api/mockWorkloadApi";
import { Lane, type LanePoint } from "./elements/lane";

type LaneYearMap = Record<number, LanePoint[]>;

type ProjectLaneState = {
    id: string;
    name: string;
    active: boolean;
    pointsByYear: LaneYearMap;
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

    return {
        year: isoYear,
        week,
        weekday: dayNumber,
    };
};

const getISOWeeksInYear = (year: number) => getISOWeekInfo(new Date(Date.UTC(year, 11, 28))).week;

const sortPoints = (points: LanePoint[]) =>
    [...points].sort((a, b) => a.week - b.week || a.id.localeCompare(b.id));

const clonePoints = (points: LanePoint[]) => points.map((point) => ({ ...point }));

const projectLabelFor = (
    catalog: ProjectSummary[],
    projectId: string,
    fallback?: string
) => {
    const meta = catalog.find((project) => project.id === projectId);
    if (meta) {
        return meta.name;
    }
    if (fallback && fallback.trim().length > 0) {
        return fallback;
    }
    return projectId;
};

const collectAbsolutePoints = (
    lane: ProjectLaneState,
    baseYear: number,
    prevYearWeeks: number,
    currentYearWeeks: number,
    nextYearWeeks: number
) => {
    const absolutePoints: Array<{ absoluteWeek: number; hours: number }> = [];

    const previousYearPoints = lane.pointsByYear[baseYear - 1] ?? [];
    previousYearPoints.forEach((point) => {
        absolutePoints.push({
            absoluteWeek: point.absoluteWeek ?? point.week - prevYearWeeks,
            hours: point.hours,
        });
    });

    const currentYearPoints = lane.pointsByYear[baseYear] ?? [];
    currentYearPoints.forEach((point) => {
        absolutePoints.push({
            absoluteWeek: point.absoluteWeek ?? point.week,
            hours: point.hours,
        });
    });

    const nextYearPoints = lane.pointsByYear[baseYear + 1] ?? [];
    nextYearPoints.forEach((point) => {
        absolutePoints.push({
            absoluteWeek: point.absoluteWeek ?? currentYearWeeks + point.week,
            hours: point.hours,
        });
    });

    return absolutePoints.sort((a, b) => a.absoluteWeek - b.absoluteWeek);
};

const valueAtAbsoluteWeek = (
    sortedPoints: Array<{ absoluteWeek: number; hours: number }>,
    absoluteWeek: number
) => {
    let value = 0;
    for (let index = 0; index < sortedPoints.length; index += 1) {
        const point = sortedPoints[index];
        if (!point) {
            continue;
        }
        if (point.absoluteWeek > absoluteWeek) {
            break;
        }
        value = point.hours;
    }
    return value;
};

function WorkloadTable({ employeeName, userId, weeklyCapacityHours = 40 }: WorkloadTableProps) {
    const todayInfo = useMemo(() => getISOWeekInfo(new Date()), []);
    const [displayYear, setDisplayYear] = useState(todayInfo.year);
    const currentYearWeeks = useMemo(() => getISOWeeksInYear(displayYear), [displayYear]);
    const prevYearWeeks = useMemo(() => getISOWeeksInYear(displayYear - 1), [displayYear]);
    const nextYearWeeks = useMemo(() => getISOWeeksInYear(displayYear + 1), [displayYear]);
    const activeWeekPosition = useMemo(() => {
        if (todayInfo.year !== displayYear) {
            return null;
        }
        const fractional = todayInfo.week + (todayInfo.weekday - 1) / 7;
        return clamp(fractional, 0, currentYearWeeks);
    }, [todayInfo, displayYear, currentYearWeeks]);

    const [projectLanes, setProjectLanes] = useState<ProjectLaneState[]>([]);
    const [projectsCatalog, setProjectsCatalog] = useState<ProjectSummary[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        const loadProjects = async () => {
            const projects = await fetchProjects(userId);
            setProjectsCatalog(projects);
        };
        void loadProjects();
    }, [userId]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                setIsLoading(true);
                setErrorMessage(null);
                const [prevData, currentData, nextData] = await Promise.all([
                    fetchWorkload(userId, displayYear - 1),
                    fetchWorkload(userId, displayYear),
                    fetchWorkload(userId, displayYear + 1),
                ]);

                if (cancelled) {
                    return;
                }

                const lanes = new Map<string, ProjectLaneState>();
                const ingest = (records: typeof currentData, year: number) => {
                    records.forEach((record) => {
                        const existing = lanes.get(record.projectId) ?? {
                            id: record.projectId,
                            name: record.name,
                            active: record.active,
                            pointsByYear: {} as LaneYearMap,
                        };
                        existing.name = projectLabelFor(projectsCatalog, record.projectId, record.name);
                        const catalogActive = projectsCatalog.find(
                            (project) => project.id === record.projectId
                        )?.active;
                        existing.active = catalogActive ?? record.active;
                        existing.pointsByYear[year] = sortPoints(
                            record.points.map((point) => ({
                                ...point,
                                year,
                                absoluteWeek: point.absoluteWeek ?? point.week,
                            }))
                        );
                        lanes.set(record.projectId, existing);
                    });
                };

                ingest(prevData, displayYear - 1);
                ingest(currentData, displayYear);
                ingest(nextData, displayYear + 1);

                setProjectLanes(Array.from(lanes.values()));
            } catch (error) {
                if (!cancelled) {
                    setErrorMessage("Failed to load workload data. Please try again.");
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [userId, displayYear, projectsCatalog]);

    const goToPreviousYear = useCallback(() => setDisplayYear((year) => year - 1), []);
    const goToNextYear = useCallback(() => setDisplayYear((year) => year + 1), []);

    const handleLaneChange = useCallback(
        (laneId: string, year: number, nextPoints: LanePoint[]) => {
            const normalizedPoints = sortPoints(
                nextPoints.map((point) => ({
                    ...point,
                    year,
                }))
            );

            setProjectLanes((prev) =>
                prev.map((lane) =>
                    lane.id === laneId
                        ? {
                              ...lane,
                              pointsByYear: {
                                  ...lane.pointsByYear,
                                  [year]: clonePoints(normalizedPoints),
                              },
                          }
                        : lane
                )
            );

            void updateWorkload(userId, laneId, year, normalizedPoints).catch(() => {
                setErrorMessage("Saving changes failed. Please retry.");
            });
        },
        [userId]
    );

    const selectableProjects = useMemo(() => {
        const existingCurrentYear = new Set(
            projectLanes
                .filter((lane) => (lane.pointsByYear[displayYear]?.length ?? 0) > 0)
                .map((lane) => lane.id)
        );

        return projectsCatalog.filter(
            (project) => project.active && !existingCurrentYear.has(project.id)
        );
    }, [projectLanes, projectsCatalog, displayYear]);

    useEffect(() => {
        if (selectableProjects.length === 0) {
            setSelectedProjectId("");
        } else if (
            selectedProjectId === "" ||
            !selectableProjects.some((project) => project.id === selectedProjectId)
        ) {
            const first = selectableProjects[0];
            if (first) {
                setSelectedProjectId(first.id);
            }
        }
    }, [selectableProjects, selectedProjectId]);

    const handleAddProject = useCallback(async () => {
        if (!selectedProjectId) {
            return;
        }

        setIsSaving(true);
        setErrorMessage(null);

        const startWeek = Math.max(1, todayInfo.week - 2);
        const endWeek = clamp(todayInfo.week + 2, startWeek + 1, currentYearWeeks);

        const defaultPoints: LanePoint[] = [
            {
                id: `${selectedProjectId}-${displayYear}-start`,
                week: startWeek,
                hours: 0,
                year: displayYear,
            },
            {
                id: `${selectedProjectId}-${displayYear}-end`,
                week: endWeek,
                hours: 0,
                year: displayYear,
            },
        ];

        try {
            const updated = await updateWorkload(userId, selectedProjectId, displayYear, defaultPoints);
            const label = projectLabelFor(projectsCatalog, updated.projectId, updated.name);
            const activeFlag =
                projectsCatalog.find((project) => project.id === updated.projectId)?.active ??
                updated.active;

            setProjectLanes((prev) => {
                const existing = prev.find((lane) => lane.id === updated.projectId);
                if (existing) {
                    return prev.map((lane) =>
                        lane.id === updated.projectId
                            ? {
                                  ...lane,
                                  name: label,
                                  active: activeFlag,
                                  pointsByYear: {
                                      ...lane.pointsByYear,
                                      [displayYear]: sortPoints(
                                          updated.points.map((point) => ({ ...point, year: displayYear }))
                                      ),
                                  },
                              }
                            : lane
                    );
                }

                return [
                    ...prev,
                    {
                        id: updated.projectId,
                        name: label,
                        active: activeFlag,
                        pointsByYear: {
                            [displayYear]: sortPoints(
                                updated.points.map((point) => ({ ...point, year: displayYear }))
                            ),
                        },
                    },
                ];
            });
        } catch (error) {
            setErrorMessage("Adding project failed. Please retry.");
        } finally {
            setIsSaving(false);
        }
    }, [selectedProjectId, todayInfo.week, currentYearWeeks, userId, displayYear, projectsCatalog]);

    const lanesForDisplay = useMemo(() => {
        if (projectLanes.length === 0) {
            return [];
        }

        return projectLanes
            .filter((lane) => {
                const prevPoints = lane.pointsByYear[displayYear - 1] ?? [];
                const currentPoints = lane.pointsByYear[displayYear] ?? [];
                const nextPoints = lane.pointsByYear[displayYear + 1] ?? [];
                return prevPoints.length + currentPoints.length + nextPoints.length > 0;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [projectLanes, displayYear]);

    const maxHours = (weeklyCapacityHours * 120) / 100;

    const summary = useMemo(() => {
        if (lanesForDisplay.length === 0) {
            return {
                sumPoints: [] as LanePoint[],
                peakHours: 0,
                peakPercent: 0,
            };
        }

        const weeklyTotals = Array(currentYearWeeks + 1).fill(0) as number[];

        lanesForDisplay.forEach((lane) => {
            const absolutePoints = collectAbsolutePoints(
                lane,
                displayYear,
                prevYearWeeks,
                currentYearWeeks,
                nextYearWeeks
            );
            if (absolutePoints.length === 0) {
                return;
            }

            for (let week = 0; week <= currentYearWeeks; week += 1) {
                weeklyTotals[week] += valueAtAbsoluteWeek(absolutePoints, week);
            }
        });

        const clampedTotals = weeklyTotals.map((value) => clamp(value, 0, maxHours));
        const peakHours = Math.max(...clampedTotals, 0);
        const peakPercent = peakHours === 0 ? 0 : Math.round((peakHours / maxHours) * 100);

        const sumPoints: LanePoint[] = clampedTotals.map((hours, week) => ({
            id: `sum-${week}`,
            week,
            hours,
            fixed: true,
            year: displayYear,
        }));

        return {
            sumPoints,
            peakHours,
            peakPercent,
        };
    }, [lanesForDisplay, displayYear, prevYearWeeks, currentYearWeeks, nextYearWeeks, maxHours]);

    const renderLane = useCallback(
        (lane: ProjectLaneState) => {
            const absolutePoints = collectAbsolutePoints(
                lane,
                displayYear,
                prevYearWeeks,
                currentYearWeeks,
                nextYearWeeks
            );

            const startValue = valueAtAbsoluteWeek(absolutePoints, 0);
            const endValue = valueAtAbsoluteWeek(absolutePoints, currentYearWeeks);

            const actualPoints = sortPoints(
                clonePoints(lane.pointsByYear[displayYear] ?? []).map((point) => ({
                    ...point,
                    hours: clamp(point.hours, 0, maxHours),
                }))
            );

            const handlePointsChange = (next: LanePoint[]) => {
                const actualNext = next.filter((point) => !point.fixed);
                handleLaneChange(lane.id, displayYear, actualNext);
            };

            return (
                <Lane
                    key={lane.id}
                    description={lane.name}
                    points={actualPoints}
                    onPointsChange={handlePointsChange}
                    editable
                    capacityHours={weeklyCapacityHours}
                    snapStepHours={0.5}
                    totalWeeks={currentYearWeeks}
                    activeWeek={activeWeekPosition}
                    year={displayYear}
                    startValue={startValue}
                    endValue={endValue}
                />
            );
        },
        [
            displayYear,
            activeWeekPosition,
            weeklyCapacityHours,
            currentYearWeeks,
            prevYearWeeks,
            nextYearWeeks,
            maxHours,
            handleLaneChange,
        ]
    );

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
                    <button
                        type="button"
                        onClick={goToPreviousYear}
                        className="rounded border border-slate-600/70 px-2 py-1 font-semibold uppercase tracking-wide text-slate-200 transition hover:bg-slate-700/60"
                    >
                        Prev
                    </button>
                    <span className="text-sm font-semibold text-white">{displayYear}</span>
                    <button
                        type="button"
                        onClick={goToNextYear}
                        className="rounded border border-slate-600/70 px-2 py-1 font-semibold uppercase tracking-wide text-slate-200 transition hover:bg-slate-700/60"
                    >
                        Next
                    </button>
                    <span className="ml-2 text-slate-400">
                        Weeks: {currentYearWeeks} (prev {prevYearWeeks} / next {nextYearWeeks})
                    </span>
                    <span>Projects: {lanesForDisplay.length}</span>
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
                        disabled={!selectedProjectId || isSaving}
                        className="bg-slate-100 text-slate-900 hover:bg-white/80"
                    >
                        Add
                    </Button>
                    {selectableProjects.length === 0 && (
                        <span className="text-xs text-slate-400">
                            All active projects already have workload entries this year.
                        </span>
                    )}
                </div>

                {errorMessage && (
                    <div className="rounded border border-red-600/60 bg-red-900/30 px-3 py-2 text-sm text-red-200">
                        {errorMessage}
                    </div>
                )}

                {isLoading ? (
                    <div className="text-sm text-slate-400">Loading workload data…</div>
                ) : lanesForDisplay.length === 0 ? (
                    <div className="text-sm text-slate-400">
                        No workload recorded around {displayYear}.
                    </div>
                ) : (
                    lanesForDisplay.map((lane) => renderLane(lane))
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
                            startValue={summary.sumPoints[0]?.hours ?? 0}
                            endValue={summary.sumPoints[summary.sumPoints.length - 1]?.hours ?? 0}
                        />
                    </div>
                )}
            </div>

            <p className="text-xs text-slate-400">
                Double-click a lane to focus it, then use Alt + double-click to add or remove control points, or
                Alt + drag points to fine-tune workload in 0.5h steps. The total workload lane aggregates every
                project across the year.
            </p>
        </div>
    );
}

export { WorkloadTable };
