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

type ZoomState = {
    laneId: string;
    windowStart: number;
    windowEnd: number;
    currentYearWeeks: number;
    prevYearWeeks: number;
    nextYearWeeks: number;
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

const buildStepSeries = (points: LanePoint[], startWeek: number, span: number) => {
    const sorted = sortPoints(points);
    const result = Array(span + 1).fill(0) as number[];
    let index = 0;
    let currentValue = 0;

    for (let offset = 0; offset <= span; offset += 1) {
        const targetWeek = startWeek + offset;
        while (index < sorted.length) {
            const candidate = sorted[index];
            if (!candidate || candidate.week > targetWeek) {
                break;
            }
            currentValue = candidate.hours;
            index += 1;
        }
        result[offset] = currentValue;
    }

    return result;
};

const buildWindowSeries = (
    points: Array<{ absoluteWeek: number; hours: number }>,
    windowStart: number,
    span: number
) => {
    const sorted = [...points].sort((a, b) => a.absoluteWeek - b.absoluteWeek);
    const result = Array(span + 1).fill(0) as number[];
    let index = 0;
    let currentValue = 0;

    for (let offset = 0; offset <= span; offset += 1) {
        const target = windowStart + offset;
        while (index < sorted.length) {
            const candidate = sorted[index];
            if (!candidate || candidate.absoluteWeek > target) {
                break;
            }
            currentValue = candidate.hours;
            index += 1;
        }
        result[offset] = currentValue;
    }

    return result;
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
            absoluteWeek: point.week - prevYearWeeks,
            hours: point.hours,
        });
    });

    const currentYearPoints = lane.pointsByYear[baseYear] ?? [];
    currentYearPoints.forEach((point) => {
        absolutePoints.push({
            absoluteWeek: point.week,
            hours: point.hours,
        });
    });

    const nextYearPoints = lane.pointsByYear[baseYear + 1] ?? [];
    nextYearPoints.forEach((point) => {
        absolutePoints.push({
            absoluteWeek: currentYearWeeks + point.week,
            hours: point.hours,
        });
    });

    return absolutePoints;
};

function WorkloadTable({ employeeName, userId, weeklyCapacityHours = 40 }: WorkloadTableProps) {
    const todayInfo = useMemo(() => getISOWeekInfo(new Date()), []);
    const [displayYear, setDisplayYear] = useState(todayInfo.year);
    const currentYearWeeks = useMemo(() => getISOWeeksInYear(displayYear), [displayYear]);
    const prevYearWeeks = useMemo(
        () => getISOWeeksInYear(displayYear - 1),
        [displayYear]
    );
    const nextYearWeeks = useMemo(
        () => getISOWeeksInYear(displayYear + 1),
        [displayYear]
    );
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
    const [zoomState, setZoomState] = useState<ZoomState | null>(null);

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
                        if (record.points.length === 0) {
                            return;
                        }
                        const existing = lanes.get(record.projectId) ?? {
                            id: record.projectId,
                            name: record.name,
                            active: record.active,
                            pointsByYear: {} as LaneYearMap,
                        };
                        existing.name = record.name;
                        existing.active = record.active;
                        existing.pointsByYear[year] = sortPoints(
                            record.points.map((point) => ({ ...point, year }))
                        );
                        lanes.set(record.projectId, existing);
                    });
                };

                ingest(prevData, displayYear - 1);
                ingest(currentData, displayYear);
                ingest(nextData, displayYear + 1);

                setProjectLanes(Array.from(lanes.values()));
                setZoomState(null);
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
    }, [userId, displayYear]);

    useEffect(() => {
        setZoomState(null);
    }, [displayYear]);

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
                              pointsByYear: (() => {
                                  const updated: LaneYearMap = { ...lane.pointsByYear };
                                  if (normalizedPoints.length === 0) {
                                      delete updated[year];
                                  } else {
                                      updated[year] = clonePoints(normalizedPoints);
                                  }
                                  return updated;
                              })(),
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

    const handleZoomLaneChange = useCallback(
        (laneId: string, nextPoints: LanePoint[]) => {
            if (!zoomState) {
                return;
            }

            const byYear = new Map<number, LanePoint[]>();

            nextPoints.forEach((point) => {
                const absoluteWeek = zoomState.windowStart + point.week;
                let targetYear = displayYear;
                let weekInYear = absoluteWeek;

                if (absoluteWeek < 0) {
                    targetYear = displayYear - 1;
                    weekInYear = absoluteWeek + zoomState.prevYearWeeks;
                } else if (absoluteWeek > zoomState.currentYearWeeks) {
                    targetYear = displayYear + 1;
                    weekInYear = absoluteWeek - zoomState.currentYearWeeks;
                }

                if (targetYear < displayYear - 1 || targetYear > displayYear + 1) {
                    return;
                }

                const maxWeekForYear =
                    targetYear === displayYear - 1
                        ? zoomState.prevYearWeeks
                        : targetYear === displayYear + 1
                        ? zoomState.nextYearWeeks
                        : zoomState.currentYearWeeks;

                const bucket = byYear.get(targetYear) ?? [];
                bucket.push({
                    ...point,
                    week: clamp(Math.round(weekInYear), 0, maxWeekForYear),
                    year: targetYear,
                });
                byYear.set(targetYear, bucket);
            });

            if (!byYear.size) {
                return;
            }

            byYear.forEach((points, year) => {
                handleLaneChange(laneId, year, points);
            });
        },
        [displayYear, handleLaneChange, zoomState]
    );

    const handleZoomRequest = useCallback(
        (laneId: string, info: { absoluteWeek: number }) => {
            const spanBefore = 10;
            const spanAfter = 10;
            const minStart = -prevYearWeeks;
            const maxEnd = currentYearWeeks + nextYearWeeks;

            const proposedStart = Math.round(info.absoluteWeek) - spanBefore;
            const proposedEnd = Math.round(info.absoluteWeek) + spanAfter;

            let windowStart = clamp(proposedStart, minStart, maxEnd);
            let windowEnd = clamp(proposedEnd, minStart, maxEnd);

            if (windowEnd <= windowStart) {
                windowEnd = Math.min(maxEnd, windowStart + 1);
            }

            setZoomState({
                laneId,
                windowStart,
                windowEnd,
                currentYearWeeks,
                prevYearWeeks,
                nextYearWeeks,
            });
        },
        [currentYearWeeks, nextYearWeeks, prevYearWeeks]
    );

    const clearZoom = useCallback(() => setZoomState(null), []);

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

            setProjectLanes((prev) => {
                const existing = prev.find((lane) => lane.id === updated.projectId);
                if (existing) {
                    return prev.map((lane) =>
                        lane.id === updated.projectId
                            ? {
                                  ...lane,
                                  name: updated.name,
                                  active: updated.active,
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
                        name: updated.name,
                        active: updated.active,
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
    }, [selectedProjectId, todayInfo.week, currentYearWeeks, userId, displayYear]);

    const lanesForDisplay = useMemo(
        () =>
            projectLanes
                .filter((lane) => (lane.pointsByYear[displayYear]?.length ?? 0) > 0)
                .sort((a, b) => a.name.localeCompare(b.name)),
        [projectLanes, displayYear]
    );

    const maxHours = (weeklyCapacityHours * 120) / 100;

    const summary = useMemo(() => {
        if (projectLanes.length === 0) {
            return {
                sumPoints: [] as LanePoint[],
                peakHours: 0,
                peakPercent: 0,
            };
        }

        if (!zoomState) {
            const span = currentYearWeeks;
            const weeklyTotals = Array(span + 1).fill(0) as number[];

            projectLanes.forEach((lane) => {
                const points = lane.pointsByYear[displayYear] ?? [];
                if (points.length === 0) {
                    return;
                }
                const series = buildStepSeries(points, 0, span);
                series.forEach((value, index) => {
                    if (typeof weeklyTotals[index] === "number") {
                        weeklyTotals[index] += value;
                    }
                });
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
        }

        const span = Math.max(1, zoomState.windowEnd - zoomState.windowStart);
        const weeklyTotals = Array(span + 1).fill(0) as number[];

        projectLanes.forEach((lane) => {
            const absolutePoints = collectAbsolutePoints(
                lane,
                displayYear,
                zoomState.prevYearWeeks,
                zoomState.currentYearWeeks,
                zoomState.nextYearWeeks
            );
            if (absolutePoints.length === 0) {
                return;
            }
            const series = buildWindowSeries(absolutePoints, zoomState.windowStart, span);
            series.forEach((value, index) => {
                if (typeof weeklyTotals[index] === "number") {
                    weeklyTotals[index] += value;
                }
            });
        });

        const clampedTotals = weeklyTotals.map((value) => clamp(value, 0, maxHours));
        const peakHours = Math.max(...clampedTotals, 0);
        const peakPercent = peakHours === 0 ? 0 : Math.round((peakHours / maxHours) * 100);

        const sumPoints: LanePoint[] = clampedTotals.map((hours, offset) => ({
            id: `sum-zoom-${offset}`,
            week: offset,
            hours,
            fixed: true,
            year: displayYear,
        }));

        return {
            sumPoints,
            peakHours,
            peakPercent,
        };
    }, [projectLanes, displayYear, zoomState, currentYearWeeks, maxHours]);

    const renderLane = useCallback(
        (lane: ProjectLaneState) => {
            const basePoints = lane.pointsByYear[displayYear] ?? [];

            const isHidden = zoomState !== null && zoomState.laneId !== lane.id;

            if (isHidden) {
                return null;
            }

            if (!zoomState) {
                return (
                    <Lane
                        key={lane.id}
                        description={lane.name}
                        points={clonePoints(basePoints)}
                        onPointsChange={(next) => handleLaneChange(lane.id, displayYear, next)}
                        editable
                        capacityHours={weeklyCapacityHours}
                        snapStepHours={0.5}
                        totalWeeks={currentYearWeeks}
                        activeWeek={activeWeekPosition}
                        year={displayYear}
                        onZoomRequest={(info) => handleZoomRequest(lane.id, info)}
                    />
                );
            }

            const span = Math.max(1, zoomState.windowEnd - zoomState.windowStart);
            const windowPoints: LanePoint[] = [];

            const previousYearPoints = lane.pointsByYear[displayYear - 1] ?? [];
            previousYearPoints.forEach((point) => {
                const absoluteWeek = point.week - zoomState.prevYearWeeks;
                if (
                    absoluteWeek >= zoomState.windowStart &&
                    absoluteWeek <= zoomState.windowEnd
                ) {
                    windowPoints.push({
                        ...point,
                        week: absoluteWeek - zoomState.windowStart,
                    });
                }
            });

            basePoints.forEach((point) => {
                const absoluteWeek = point.week;
                if (
                    absoluteWeek >= zoomState.windowStart &&
                    absoluteWeek <= zoomState.windowEnd
                ) {
                    windowPoints.push({
                        ...point,
                        week: absoluteWeek - zoomState.windowStart,
                    });
                }
            });

            const nextYearPoints = lane.pointsByYear[displayYear + 1] ?? [];
            nextYearPoints.forEach((point) => {
                const absoluteWeek = zoomState.currentYearWeeks + point.week;
                if (
                    absoluteWeek >= zoomState.windowStart &&
                    absoluteWeek <= zoomState.windowEnd
                ) {
                    windowPoints.push({
                        ...point,
                        week: absoluteWeek - zoomState.windowStart,
                    });
                }
            });

            if (windowPoints.length === 0) {
                return null;
            }

            return (
                <Lane
                    key={`${lane.id}-zoom`}
                    description={`${lane.name} (zoom)`}
                    points={sortPoints(windowPoints)}
                    onPointsChange={(next) => handleZoomLaneChange(lane.id, next)}
                    editable
                    capacityHours={weeklyCapacityHours}
                    snapStepHours={0.5}
                    totalWeeks={span}
                    activeWeek={
                        typeof activeWeekPosition === "number"
                            ? activeWeekPosition - zoomState.windowStart
                            : null
                    }
                    year={displayYear}
                    weekOffset={zoomState.windowStart}
                    baseYear={displayYear}
                    currentYearWeeks={zoomState.currentYearWeeks}
                    nextYearWeeks={zoomState.nextYearWeeks}
                    onZoomRequest={(info) => handleZoomRequest(lane.id, info)}
                />
            );
        },
        [
            displayYear,
            activeWeekPosition,
            weeklyCapacityHours,
            currentYearWeeks,
            handleLaneChange,
            handleZoomLaneChange,
            handleZoomRequest,
            zoomState,
        ]
    );

    return (
        <div className="workload-table w-full space-y-6 text-white">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-2xl font-semibold">{employeeName}</h2>
                    <p className="text-sm text-slate-300">
                        Weekly capacity: {weeklyCapacityHours}h (120% ceiling: {maxHours.toFixed(1)}h)
                    </p>
                </div>
                <div className="flex flex-col items-end gap-2 text-sm text-slate-300">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={goToPreviousYear}
                            className="rounded border border-slate-600/70 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:bg-slate-700/60"
                        >
                            Prev
                        </button>
                        <span className="text-base font-semibold text-white">{displayYear}</span>
                        <button
                            type="button"
                            onClick={goToNextYear}
                            className="rounded border border-slate-600/70 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:bg-slate-700/60"
                        >
                            Next
                        </button>
                        {zoomState && (
                            <Button
                                variant="outline"
                                size="sm"
                                className="border-slate-600/70 bg-slate-800/60 text-xs"
                                onClick={clearZoom}
                            >
                                Reset Zoom
                            </Button>
                        )}
                    </div>
                    <div className="text-xs text-slate-400">
                        Weeks in year: {currentYearWeeks} (± next year {nextYearWeeks})
                    </div>
                    <div>Projects shown: {lanesForDisplay.length}</div>
                    <div>
                        Peak load: {summary.peakHours.toFixed(1)}h ({summary.peakPercent}%)
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-3 rounded-md border border-slate-700/60 bg-slate-900/40 p-4">
                <div className="flex flex-wrap items-center gap-3">
                    <Select
                        value={selectedProjectId}
                        onValueChange={setSelectedProjectId}
                        disabled={selectableProjects.length === 0 || isSaving}
                    >
                        <SelectTrigger className="w-[220px] border-slate-600/70 bg-slate-800/50 text-left text-slate-100">
                            <SelectValue placeholder="Select project to add" />
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
                        Add Project
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
                        No projects with workload recorded for {displayYear}.
                    </div>
                ) : (
                    lanesForDisplay.map((lane) => renderLane(lane))
                )}

                {!isLoading && summary.sumPoints.length > 0 && (
                    <div className="pt-2">
                        <Lane
                            description="Total workload"
                            points={summary.sumPoints}
                            editable={false}
                            capacityHours={weeklyCapacityHours}
                            showBands
                            totalWeeks={
                                zoomState
                                    ? Math.max(1, zoomState.windowEnd - zoomState.windowStart)
                                    : currentYearWeeks
                            }
                            activeWeek={
                                zoomState
                                    ? typeof activeWeekPosition === "number"
                                        ? activeWeekPosition - zoomState.windowStart
                                        : null
                                    : activeWeekPosition
                            }
                            year={displayYear}
                            weekOffset={zoomState ? zoomState.windowStart : 0}
                            baseYear={displayYear}
                            currentYearWeeks={currentYearWeeks}
                            nextYearWeeks={nextYearWeeks}
                        />
                    </div>
                )}
            </div>

            <p className="text-xs text-slate-400">
                Double-click a lane to zoom around that week (±10 weeks across year boundaries). While focused,
                hold Alt and double-click to add/remove control points, or Alt-drag points/lines to adjust
                workload in 0.5h steps. Inactive projects now appear whenever workload exists, and every edit is
                persisted through the mock API.
            </p>
        </div>
    );
}

export { WorkloadTable };
