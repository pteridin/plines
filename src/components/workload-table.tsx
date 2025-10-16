import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    fetchProjects,
    fetchWorkload,
    updateWorkload,
    updateWorkloadSuggestions,
    type ProjectSummary,
    type ProjectStatus,
} from "../api/workloadApi";
import { ProjectStatusBadge } from "@/components/project-status-badge";
import { Lane, type LanePoint } from "./elements/lane";

const PLAN_STROKE_COLOR = "#00f5d4";
const PLAN_POINT_FILL = "#f72585";
const PLAN_POINT_STROKE = "#ffe3ff";
const SUGGESTION_STROKE_COLOR = "#38c3a4";
const SUGGESTION_POINT_FILL = "#2d9c8f";
const SUGGESTION_POINT_STROKE = "#a3f0dc";

type ProjectLaneState = {
    id: string;
    name: string;
    active: boolean;
    status: ProjectStatus;
    points: LanePoint[];
    suggestions: LanePoint[];
};

type WorkloadTableProps = {
    employeeName: string;
    userId: string;
    weeklyCapacityHours?: number;
    canEdit?: boolean;
    canSuggest?: boolean;
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

function WorkloadTable({
    employeeName,
    userId,
    weeklyCapacityHours = 40,
    canEdit = false,
    canSuggest = false,
}: WorkloadTableProps) {
    const todayInfo = useMemo(() => getISOWeekInfo(new Date()), []);
    const [displayYear, setDisplayYear] = useState(() => todayInfo.year);
    const currentYearWeeks = useMemo(() => getISOWeeksInYear(displayYear), [displayYear]);
    const activeWeekPosition = useMemo(() => {
        if (displayYear !== todayInfo.year) {
            return null;
        }
        const fractional = todayInfo.week + (todayInfo.weekday - 1) / 7;
        return clamp(fractional, 0, currentYearWeeks);
    }, [todayInfo, currentYearWeeks, displayYear]);

    const [projectLanes, setProjectLanes] = useState<ProjectLaneState[]>([]);
    const [projectsCatalog, setProjectsCatalog] = useState<ProjectSummary[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string>("");
    const [projectFilter, setProjectFilter] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const handleYearStep = useCallback((delta: number) => {
        setDisplayYear((prev) => prev + delta);
    }, []);

    useEffect(() => {
        setDisplayYear(todayInfo.year);
    }, [userId, todayInfo.year]);

    useEffect(() => {
        if (!canEdit) {
            setProjectsCatalog([]);
            setSelectedProjectId("");
            return;
        }

        void (async () => {
            try {
                const projects = await fetchProjects(userId);
                setProjectsCatalog(projects);
            } catch {
                setProjectsCatalog([]);
            }
        })();
    }, [userId, canEdit]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                setIsLoading(true);
                setErrorMessage(null);
                const data = await fetchWorkload(userId, displayYear);
                if (cancelled) return;

                const lanes = data.map((record) => {
                    const meta = projectsCatalog.find((p) => p.id === record.projectId);
                    return {
                        id: record.projectId,
                        name: projectLabelFor(projectsCatalog, record.projectId, record.name),
                        active: meta?.active ?? record.active,
                        status: meta?.status ?? record.status,
                        points: sortPoints(
                            record.points.map((point) => ({
                                ...point,
                                week: clampWeekToIsoRange(point.week ?? 1, currentYearWeeks),
                                year: displayYear,
                            }))
                        ),
                        suggestions: sortPoints(
                            (record.suggestions ?? []).map((point) => ({
                                ...point,
                                week: clampWeekToIsoRange(point.week ?? 1, currentYearWeeks),
                                year: displayYear,
                            }))
                        ),
                    };
                });

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
            if (!canEdit) return;
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

            void updateWorkload(userId, laneId, displayYear, normalizedPoints)
                .then((updated) => {
                    const meta = projectsCatalog.find((p) => p.id === updated.projectId);
                    setProjectLanes((prev) =>
                        prev.map((lane) =>
                            lane.id === updated.projectId
                                ? {
                                      ...lane,
                                      name: projectLabelFor(
                                          projectsCatalog,
                                          updated.projectId,
                                          updated.name
                                      ),
                                      active: meta?.active ?? updated.active,
                                      status: meta?.status ?? updated.status,
                                      points: sortPoints(
                                          updated.points.map((point) => ({
                                              ...point,
                                              week: clampWeekToIsoRange(
                                                  point.week ?? 1,
                                                  currentYearWeeks
                                              ),
                                              year: displayYear,
                                          }))
                                      ),
                                      suggestions: sortPoints(
                                          (updated.suggestions ?? []).map((point) => ({
                                              ...point,
                                              week: clampWeekToIsoRange(
                                                  point.week ?? 1,
                                                  currentYearWeeks
                                              ),
                                              year: displayYear,
                                          }))
                                      ),
                                  }
                                : lane
                        )
                    );
                })
                .catch(() => {
                    setErrorMessage("Saving changes failed. Please retry.");
                });
        },
        [userId, displayYear, currentYearWeeks, projectsCatalog, canEdit]
    );

    const handleSuggestionChange = useCallback(
        (laneId: string, nextPoints: LanePoint[]) => {
            if (!canSuggest) return;

            const normalizedPoints = sortPoints(
                nextPoints.map((point) => ({
                    ...point,
                    week: clampWeekToIsoRange(point.week ?? 1, currentYearWeeks),
                    year: displayYear,
                }))
            );

            setProjectLanes((prev) =>
                prev.map((lane) =>
                    lane.id === laneId
                        ? { ...lane, suggestions: clonePoints(normalizedPoints) }
                        : lane
                )
            );

            setIsSaving(true);

            void updateWorkloadSuggestions(userId, laneId, displayYear, normalizedPoints)
                .then((updated) => {
                    const meta = projectsCatalog.find((p) => p.id === updated.projectId);
                    setProjectLanes((prev) =>
                        prev.map((lane) =>
                            lane.id === updated.projectId
                                ? {
                                      ...lane,
                                      name: projectLabelFor(
                                          projectsCatalog,
                                          updated.projectId,
                                          updated.name
                                      ),
                                      active: meta?.active ?? updated.active,
                                      status: meta?.status ?? updated.status,
                                      points: sortPoints(
                                          updated.points.map((point) => ({
                                              ...point,
                                              week: clampWeekToIsoRange(
                                                  point.week ?? 1,
                                                  currentYearWeeks
                                              ),
                                              year: displayYear,
                                          }))
                                      ),
                                      suggestions: sortPoints(
                                          (updated.suggestions ?? []).map((point) => ({
                                              ...point,
                                              week: clampWeekToIsoRange(
                                                  point.week ?? 1,
                                                  currentYearWeeks
                                              ),
                                              year: displayYear,
                                          }))
                                      ),
                                  }
                                : lane
                        )
                    );
                })
                .catch(() => {
                    setErrorMessage("Saving suggestion failed. Please retry.");
                })
                .finally(() => {
                    setIsSaving(false);
                });
        },
        [canSuggest, userId, displayYear, currentYearWeeks, projectsCatalog]
    );

    const selectableProjects = useMemo(() => {
        const existing = new Set(projectLanes.map((lane) => lane.id));
        return projectsCatalog.filter(
            (project) => project.active && !existing.has(project.id)
        );
    }, [projectLanes, projectsCatalog]);

    const filteredProjectLanes = useMemo(() => {
        const search = projectFilter.trim().toLowerCase();
        if (search.length === 0) return projectLanes;
        return projectLanes.filter((lane) => lane.name.toLowerCase().includes(search));
    }, [projectLanes, projectFilter]);

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
        if (!canEdit || !selectedProjectId) return;
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
            const meta = projectsCatalog.find((p) => p.id === updated.projectId);
            const activeFlag = meta?.active ?? updated.active;
            const statusFlag = meta?.status ?? updated.status;
            const normalizedPoints = sortPoints(
                updated.points.map((point) => ({
                    ...point,
                    week: clampWeekToIsoRange(point.week ?? 1, currentYearWeeks),
                    year: displayYear,
                }))
            );
            const normalizedSuggestions = sortPoints(
                (updated.suggestions ?? []).map((point) => ({
                    ...point,
                    week: clampWeekToIsoRange(point.week ?? 1, currentYearWeeks),
                    year: displayYear,
                }))
            );

            setProjectLanes((prev) => [
                ...prev,
                {
                    id: updated.projectId,
                    name: label,
                    active: activeFlag,
                    status: statusFlag,
                    points: normalizedPoints,
                    suggestions: normalizedSuggestions,
                },
            ]);
        } catch {
            setErrorMessage("Adding project failed. Please retry.");
        } finally {
            setIsSaving(false);
        }
    }, [selectedProjectId, currentYearWeeks, userId, displayYear, projectsCatalog, isLoading, canEdit]);

    const maxHours = (weeklyCapacityHours * 120) / 100;

    const summary = useMemo(() => {
        const weeklyTotals = Array(currentYearWeeks + 1).fill(0) as number[];
        const suggestionTotals = Array(currentYearWeeks + 1).fill(0) as number[];

        const accumulate = (points: LanePoint[], bucket: number[]) => {
            const sorted = sortPoints(points);
            if (sorted.length === 0) return;

            let idx = 0;
            let last = sorted[0];
            for (let week = 1; week <= currentYearWeeks; week++) {
                while (idx < sorted.length && sorted[idx]!.week <= week) {
                    last = sorted[idx]!;
                    idx++;
                }
                if (!last || bucket[week] === undefined) continue;
                bucket[week] += clamp(last.hours, 0, maxHours);
            }
        };

        projectLanes.forEach(({ active, points, suggestions }) => {
            if (!active) return;
            accumulate(points, weeklyTotals);
            accumulate(suggestions, suggestionTotals);
        });

        const relevant = weeklyTotals.slice(1);
        const suggestionRelevant = suggestionTotals.slice(1);
        const peakHours = Math.max(...relevant, 0);
        const peakPercent = Math.round((peakHours / maxHours) * 100);
        const suggestionPeakHours = Math.max(...suggestionRelevant, 0);
        const suggestionPeakPercent = Math.round((suggestionPeakHours / maxHours) * 100);

        const sumPoints: LanePoint[] = relevant.map((hours, i) => ({
            id: `sum-${i + 1}`,
            week: i + 1,
            hours,
            fixed: true,
            year: displayYear,
        }));

        const suggestionPoints: LanePoint[] = suggestionRelevant.map((hours, i) => ({
            id: `sum-suggestion-${i + 1}`,
            week: i + 1,
            hours,
            fixed: true,
            year: displayYear,
        }));

        return {
            sumPoints,
            suggestionPoints,
            peakHours,
            peakPercent,
            suggestionPeakHours,
            suggestionPeakPercent,
        };
    }, [projectLanes, currentYearWeeks, displayYear, maxHours]);

    return (
        <div className="workload-table w-full space-y-5 text-white">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-xl font-semibold">{employeeName}</h2>
                    <p className="text-xs text-slate-300">
                        Weekly capacity: {weeklyCapacityHours}h (120% ceiling: {maxHours.toFixed(1)}h)
                    </p>
                </div>
                <div className="flex flex-col items-start gap-2 text-xs text-slate-300 sm:items-end">
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
                            onClick={() => handleYearStep(-1)}
                            aria-label="Show previous year"
                            className="border border-slate-700/60 bg-slate-900/60 text-slate-200 hover:bg-slate-800/80"
                        >
                            <ChevronLeft className="size-4" />
                        </Button>
                        <span className="text-sm font-semibold text-white">{displayYear}</span>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleYearStep(1)}
                            aria-label="Show next year"
                            className="border border-slate-700/60 bg-slate-900/60 text-slate-200 hover:bg-slate-800/80"
                        >
                            <ChevronRight className="size-4" />
                        </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span>Weeks: {currentYearWeeks}</span>
                        <span>Projects: {projectLanes.length}</span>
                        <span>
                            Peak load: {summary.peakHours.toFixed(1)}h ({summary.peakPercent}%)
                        </span>
                        {summary.suggestionPeakHours > 0 && (
                            <span>
                                Suggested peak: {summary.suggestionPeakHours.toFixed(1)}h (
                                {summary.suggestionPeakPercent}%)
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-3 rounded-md border border-slate-700/60 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                    {canEdit ? (
                        <>
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
                        </>
                    ) : (
                        <p className="text-xs text-slate-400">
                            Project assignments are managed by project managers.
                        </p>
                    )}
                    <Input
                        value={projectFilter}
                        onChange={(event) => setProjectFilter(event.target.value)}
                        placeholder="Filter projects"
                        className="w-full min-w-[200px] flex-1 border-slate-600/70 bg-slate-900/50 text-slate-100 sm:w-64"
                    />
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
                ) : filteredProjectLanes.length === 0 ? (
                    <div className="text-sm text-slate-400">
                        No projects match the current filter.
                    </div>
                ) : (
                    filteredProjectLanes.map((lane) => {
                        const laneMode = canEdit
                            ? "plan"
                            : canSuggest
                            ? "suggestion"
                            : "view";

                        const primaryPoints =
                            laneMode === "plan"
                                ? lane.points
                                : laneMode === "suggestion"
                                ? lane.suggestions
                                : lane.points;

                        const comparisonPoints =
                            laneMode === "plan"
                                ? lane.suggestions
                                : laneMode === "suggestion"
                                ? lane.points
                                : lane.suggestions;

                        const editable = laneMode !== "view";
                        const handleChange =
                            laneMode === "plan"
                                ? handleLaneChange
                                : laneMode === "suggestion"
                                ? handleSuggestionChange
                                : null;

                        const primaryStroke =
                            laneMode === "suggestion"
                                ? SUGGESTION_STROKE_COLOR
                                : PLAN_STROKE_COLOR;

                        const comparisonStroke =
                            comparisonPoints.length === 0
                                ? undefined
                                : laneMode === "suggestion"
                                ? PLAN_STROKE_COLOR
                                : SUGGESTION_STROKE_COLOR;

                        const comparisonDash =
                            comparisonPoints.length === 0
                                ? undefined
                                : laneMode === "plan"
                                ? "6,4"
                                : laneMode === "view"
                                ? "6,4"
                                : undefined;

                        const comparisonOpacity =
                            laneMode === "suggestion" ? 0.9 : laneMode === "plan" ? 0.8 : 0.6;

                        const pointFill =
                            laneMode === "suggestion" ? SUGGESTION_POINT_FILL : PLAN_POINT_FILL;
                        const pointStroke =
                            laneMode === "suggestion"
                                ? SUGGESTION_POINT_STROKE
                                : PLAN_POINT_STROKE;

                        return (
                            <Lane
                                key={lane.id}
                                description={
                                    <div className="flex items-center gap-2">
                                        <span>{lane.name}</span>
                                        <ProjectStatusBadge status={lane.status} />
                                    </div>
                                }
                                points={primaryPoints}
                                comparisonPoints={comparisonPoints}
                                onPointsChange={
                                    handleChange
                                        ? (next) => handleChange(lane.id, next)
                                        : undefined
                                }
                                editable={editable}
                                capacityHours={weeklyCapacityHours}
                                snapStepHours={0.5}
                                totalWeeks={currentYearWeeks}
                                activeWeek={activeWeekPosition}
                                year={displayYear}
                                primaryStroke={primaryStroke}
                                comparisonStroke={comparisonStroke}
                                comparisonStrokeDasharray={comparisonDash}
                                comparisonOpacity={comparisonOpacity}
                                pointFill={pointFill}
                                pointStroke={pointStroke}
                            />
                        );
                    })
                )}

                {!isLoading && summary.sumPoints.length > 0 && (
                    <div className="pt-1">
                        <Lane
                            description="Total workload"
                            points={summary.sumPoints}
                            comparisonPoints={summary.suggestionPoints}
                            editable={false}
                            capacityHours={weeklyCapacityHours}
                            showBands
                            totalWeeks={currentYearWeeks}
                            activeWeek={activeWeekPosition}
                            year={displayYear}
                            primaryStroke={PLAN_STROKE_COLOR}
                            comparisonStroke={
                                summary.suggestionPoints.length > 0
                                    ? SUGGESTION_STROKE_COLOR
                                    : undefined
                            }
                            comparisonStrokeDasharray={
                                summary.suggestionPoints.length > 0 ? "6,4" : undefined
                            }
                            comparisonOpacity={0.65}
                        />
                    </div>
                )}
            </div>
            <div className="text-xs text-slate-400 space-y-1">
                <p>
                    Double-click on a lane to enter edit mode. Add or remove points using Alt + Click. Drag
                    the points to adjust the workload. Employees can propose workload suggestions on the
                    dimmer teal line, while managers adjust the brighter plan line.
                </p>
                <p>The workload data is for planning purposes only and may not reflect actual hours worked.</p>
            </div>
        </div>
    );
}

export { WorkloadTable };
