import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";

export type LanePoint = {
    id: string;
    week: number;
    hours: number;
    fixed?: boolean;
    year?: number;
};

export type LaneProps = {
    description: string;
    points: LanePoint[];
    onPointsChange?: (next: LanePoint[]) => void;
    editable?: boolean;
    capacityHours: number;
    maxLoadPercent?: number;
    snapStepHours?: number;
    showBands?: boolean;
    totalWeeks?: number;
    activeWeek?: number | null;
    year?: number;
    weekOffset?: number;
    baseYear?: number;
    currentYearWeeks?: number;
    nextYearWeeks?: number;
    onZoomRequest?: (info: { week: number; absoluteWeek: number }) => void;
};

export const TOTAL_WEEKS = 52;
export const VIEWBOX_WIDTH = 1000;
export const VIEWBOX_HEIGHT = 100;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const roundToStep = (value: number, step: number) => {
    if (step <= 0) {
        return value;
    }
    return Math.round(value / step) * step;
};

const createPointId = () => `lane-point-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const sortPoints = (points: LanePoint[]) => [...points].sort((a, b) => a.week - b.week);

const toLocaleDay = (date: Date) =>
    date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

const getIsoWeekDateRange = (isoYear: number, isoWeek: number) => {
    const simple = new Date(Date.UTC(isoYear, 0, 4));
    const simpleDay = simple.getUTCDay() || 7;
    simple.setUTCDate(simple.getUTCDate() - simpleDay + 1 + (isoWeek - 1) * 7);

    const start = new Date(simple);
    const end = new Date(simple);
    end.setUTCDate(start.getUTCDate() + 6);

    return {
        start,
        end,
        startLabel: toLocaleDay(start),
        endLabel: toLocaleDay(end),
    };
};

type HoverInfo = {
    ratioX: number;
    ratioY: number;
    isoWeek: number;
    isoYear: number;
    startLabel: string;
    endLabel: string;
    hours: number;
};

function Lane({
    description,
    points,
    onPointsChange,
    editable = true,
    capacityHours,
    maxLoadPercent = 120,
    snapStepHours = 0.5,
    showBands = false,
    totalWeeks = TOTAL_WEEKS,
    activeWeek = null,
    year = new Date().getFullYear(),
    weekOffset = 0,
    baseYear,
    currentYearWeeks,
    nextYearWeeks,
    onZoomRequest,
}: LaneProps) {
    const [focused, setFocused] = useState(false);
    const lineHeight = focused ? 300 : 100;
    const weeks = Math.max(1, Math.round(totalWeeks));
    const svgRef = useRef<SVGSVGElement | null>(null);
    const pointsRef = useRef(points);
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
    const dragStateRef = useRef<
        | null
        | {
              type: "point";
              pointId: string;
              fixed?: boolean;
              pointerId: number;
          }
        | {
              type: "line";
              pointerId: number;
              pointerStartWeek: number;
              pointerStartHours: number;
              segmentStartIndex: number;
              segmentEndIndex: number;
              originalPoints: LanePoint[];
        }
    >(null);

    pointsRef.current = points;

    const resolvedBaseYear = baseYear ?? year;
    const resolvedCurrentYearWeeks = currentYearWeeks ?? Math.round(totalWeeks);
    const resolvedNextYearWeeks = nextYearWeeks ?? 0;

    const canEdit = editable && typeof onPointsChange === "function";
    const safeCapacityHours = Math.max(capacityHours, snapStepHours);
    const maxHours = Math.max((safeCapacityHours * maxLoadPercent) / 100, snapStepHours);

    const hoursToY = useCallback(
        (hours: number) => {
            const clampedHours = clamp(hours, 0, maxHours);
            const ratio = clampedHours / maxHours;
            return VIEWBOX_HEIGHT - ratio * VIEWBOX_HEIGHT;
        },
        [maxHours]
    );

    const yToHours = useCallback(
        (ratioY: number) => {
            const inverted = 1 - ratioY;
            return clamp(inverted * maxHours, 0, maxHours);
        },
        [maxHours]
    );

    const sortedPoints = useMemo(() => sortPoints(points), [points]);

    const interpolateHoursAtWeek = useCallback(
        (week: number) => {
            if (sortedPoints.length === 0) {
                return 0;
            }

            const clampedWeek = clamp(week, 0, weeks);

            for (let index = sortedPoints.length - 1; index >= 0; index -= 1) {
                const candidate = sortedPoints[index];
                if (candidate && candidate.week <= clampedWeek) {
                    return candidate.hours;
                }
            }

            return 0;
        },
        [sortedPoints, weeks]
    );

    const stepPath = useMemo(() => {
        if (sortedPoints.length < 2) {
            return "";
        }

        const commands: string[] = [];
        const firstPoint = sortedPoints[0];
        if (!firstPoint) {
            return "";
        }
        let currentX = (firstPoint.week / weeks) * VIEWBOX_WIDTH;
        let currentY = hoursToY(firstPoint.hours);

        commands.push(`M ${currentX} ${currentY}`);

        for (let index = 0; index < sortedPoints.length - 1; index += 1) {
            const currentPoint = sortedPoints[index];
            const nextPoint = sortedPoints[index + 1];
            if (!currentPoint || !nextPoint) {
                continue;
            }

            const nextX = (nextPoint.week / weeks) * VIEWBOX_WIDTH;
            const nextY = hoursToY(nextPoint.hours);

            if (nextX !== currentX) {
                commands.push(`H ${nextX}`);
            }
            if (nextY !== currentY) {
                commands.push(`V ${nextY}`);
            }

            currentX = nextX;
            currentY = nextY;
        }

        if (currentX !== VIEWBOX_WIDTH) {
            commands.push(`H ${VIEWBOX_WIDTH}`);
        }

        return commands.join(" ");
    }, [sortedPoints, hoursToY, weeks]);

    const emitPointsChange = useCallback(
        (mutator: (current: LanePoint[]) => LanePoint[]) => {
            if (!canEdit || !onPointsChange) {
                return;
            }
            const current = pointsRef.current;
            const next = sortPoints(mutator(current));
            onPointsChange(next);
        },
        [canEdit, onPointsChange]
    );

    const handleLaneDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.altKey) {
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        const week = clamp(Math.round(ratioX * weeks), 0, weeks);
        const absoluteWeek = weekOffset + week;
        setFocused(true);
        onZoomRequest?.({ week, absoluteWeek });
    }, [weeks, weekOffset, onZoomRequest]);

    const updateHoverInfo = useCallback(
        (event: ReactPointerEvent<SVGSVGElement>) => {
            const svg = svgRef.current;
            if (!svg) {
                return;
            }

            const rect = svg.getBoundingClientRect();
            const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);

            const rawWeekPosition = ratioX * weeks;
            const weekIndex = clamp(Math.round(rawWeekPosition), 0, weeks);
            const absoluteWeek = weekOffset + weekIndex;

            let isoYearValue = resolvedBaseYear;
            let isoWeekValue = Math.round(absoluteWeek <= 0 ? 1 : absoluteWeek);

            if (absoluteWeek > resolvedCurrentYearWeeks && resolvedNextYearWeeks > 0) {
                isoYearValue = resolvedBaseYear + 1;
                isoWeekValue = Math.round(absoluteWeek - resolvedCurrentYearWeeks);
                if (isoWeekValue < 1) {
                    isoWeekValue = 1;
                }
            }

            const hours = interpolateHoursAtWeek(weekIndex);
            const { startLabel, endLabel } = getIsoWeekDateRange(isoYearValue, isoWeekValue);

            setHoverInfo({
                ratioX,
                ratioY,
                isoWeek: isoWeekValue,
                isoYear: isoYearValue,
                startLabel,
                endLabel,
                hours,
            });
        },
        [weeks, interpolateHoursAtWeek, resolvedBaseYear, weekOffset, resolvedCurrentYearWeeks, resolvedNextYearWeeks]
    );

    const clearHoverInfo = useCallback(() => {
        setHoverInfo(null);
    }, []);

    const handleSvgDoubleClick = useCallback(
        (event: ReactMouseEvent<SVGSVGElement>) => {
            if (!focused || !event.altKey || !canEdit) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const svg = svgRef.current;
            if (!svg) {
                return;
            }

            const rect = svg.getBoundingClientRect();
            const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            const week = clamp(Math.round(ratioX * weeks), 0, weeks);

            emitPointsChange((current) => {
                const existing = current.find((point) => point.week === week);
                if (existing) {
                    if (existing.fixed) {
                        return current;
                    }
                    return current.filter((point) => point.week !== week);
                }

                const defaultHours = interpolateHoursAtWeek(week);
                const snappedHours = roundToStep(defaultHours, snapStepHours);

                const newPoint: LanePoint = {
                    id: createPointId(),
                    week,
                    hours: clamp(snappedHours, 0, maxHours),
                };

                return [...current, newPoint];
            });
        },
        [focused, canEdit, emitPointsChange, interpolateHoursAtWeek, snapStepHours, maxHours]
    );

    const handlePointPointerDown = useCallback(
        (event: ReactPointerEvent<SVGCircleElement>, pointId: string, fixed?: boolean) => {
            if (!focused || !event.altKey || !canEdit) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragStateRef.current = {
                type: "point",
                pointId,
                fixed,
                pointerId: event.pointerId,
            };
        },
        [focused, canEdit]
    );

    const handlePointDoubleClick = useCallback(
        (event: ReactMouseEvent<SVGCircleElement>, pointId: string, fixed?: boolean) => {
            if (!canEdit || fixed || !event.altKey) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            emitPointsChange((current) => current.filter((point) => point.id !== pointId));
        },
        [canEdit, emitPointsChange]
    );

    const handleLinePointerDown = useCallback(
        (event: ReactPointerEvent<SVGPathElement>) => {
            if (!focused || !event.altKey || !canEdit) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();

            const svg = svgRef.current;
            if (!svg || sortedPoints.length < 2) {
                return;
            }

            const rect = svg.getBoundingClientRect();
            const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            const pointerStartWeek = clamp(Math.round(ratioX * weeks), 0, weeks);
            const pointerStartHours = roundToStep(
                interpolateHoursAtWeek(pointerStartWeek),
                snapStepHours
            );

            let segmentStartIndex = 0;
            let segmentEndIndex = 1;

            const firstPoint = sortedPoints[0]!;
            const lastPoint = sortedPoints[sortedPoints.length - 1]!;

            if (pointerStartWeek <= firstPoint.week) {
                segmentStartIndex = 0;
                segmentEndIndex = 1;
            } else if (pointerStartWeek >= lastPoint.week) {
                segmentStartIndex = sortedPoints.length - 2;
                segmentEndIndex = sortedPoints.length - 1;
            } else {
                for (let index = 0; index < sortedPoints.length - 1; index += 1) {
                    const current = sortedPoints[index];
                    const next = sortedPoints[index + 1];
                    if (
                        current &&
                        next &&
                        pointerStartWeek >= current.week &&
                        pointerStartWeek <= next.week
                    ) {
                        segmentStartIndex = index;
                        segmentEndIndex = index + 1;
                        break;
                    }
                }
            }

            const originalPoints = sortPoints(pointsRef.current.map((point) => ({ ...point })));
            if (!originalPoints[segmentStartIndex] || !originalPoints[segmentEndIndex]) {
                return;
            }

            event.currentTarget.setPointerCapture(event.pointerId);
            dragStateRef.current = {
                type: "line",
                pointerId: event.pointerId,
                pointerStartWeek,
                pointerStartHours,
                segmentStartIndex,
                segmentEndIndex,
                originalPoints,
            };
        },
        [focused, canEdit, sortedPoints, weeks, interpolateHoursAtWeek, snapStepHours]
    );

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const state = dragStateRef.current;
            const svg = svgRef.current;

            if (!svg || !state || !canEdit) {
                return;
            }

            if (event.pointerId !== state.pointerId) {
                return;
            }

            const rect = svg.getBoundingClientRect();

            if (state.type === "point") {
                const targetPoint = pointsRef.current.find((point) => point.id === state.pointId);
                if (!targetPoint) {
                    return;
                }

                const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
                const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);

                const week = state.fixed
                    ? targetPoint.week
                    : clamp(Math.round(ratioX * weeks), 0, weeks);

                const snappedHours = roundToStep(yToHours(ratioY), snapStepHours);

                emitPointsChange((current) =>
                    current.map((point) =>
                        point.id === state.pointId
                            ? {
                                  ...point,
                                  week,
                                  hours: clamp(snappedHours, 0, maxHours),
                              }
                            : point
                    )
                );
            } else if (state.type === "line") {
                const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
                const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
                const targetWeek = clamp(Math.round(ratioX * weeks), 0, weeks);

                const originalPoints = state.originalPoints;
                const segmentStartIndex = state.segmentStartIndex;
                const segmentEndIndex = state.segmentEndIndex;

                const segmentStartPoint = originalPoints[segmentStartIndex];
                const segmentEndPoint = originalPoints[segmentEndIndex];
                if (!segmentStartPoint || !segmentEndPoint) {
                    return;
                }

                const prevWeek =
                    segmentStartIndex > 0
                        ? originalPoints[segmentStartIndex - 1]?.week ?? segmentStartPoint.week
                        : 0;
                const nextWeek =
                    segmentEndIndex < originalPoints.length - 1
                        ? originalPoints[segmentEndIndex + 1]?.week ?? segmentEndPoint.week
                        : weeks;

                let deltaWeek = targetWeek - state.pointerStartWeek;
                const minDeltaWeek = prevWeek - segmentStartPoint.week;
                const maxDeltaWeek = nextWeek - segmentEndPoint.week;
                deltaWeek = clamp(deltaWeek, minDeltaWeek, maxDeltaWeek);

                const targetHours = roundToStep(yToHours(ratioY), snapStepHours);
                let deltaHours = targetHours - state.pointerStartHours;
                if (snapStepHours > 0) {
                    deltaHours = Math.round(deltaHours / snapStepHours) * snapStepHours;
                }

                const segmentOriginalHours = originalPoints
                    .slice(segmentStartIndex, segmentEndIndex + 1)
                    .map((point) => point.hours);

                const maxIncrease = Math.min(
                    ...segmentOriginalHours.map((hours) => maxHours - hours)
                );
                const maxDecrease = Math.min(...segmentOriginalHours.map((hours) => hours));
                deltaHours = clamp(deltaHours, -maxDecrease, maxIncrease);

                if (deltaWeek === 0 && deltaHours === 0) {
                    return;
                }

                const newPoints = originalPoints.map((point, index) => {
                    if (index < segmentStartIndex || index > segmentEndIndex) {
                        return { ...point };
                    }

                    const updatedPoint: LanePoint = { ...point };

                    if (deltaWeek !== 0 && !point.fixed) {
                        updatedPoint.week = clamp(point.week + deltaWeek, 0, weeks);
                    }

                    if (deltaHours !== 0) {
                        const nextHours = clamp(
                            roundToStep(point.hours + deltaHours, snapStepHours),
                            0,
                            maxHours
                        );
                        updatedPoint.hours = nextHours;
                    }

                    return updatedPoint;
                });

                emitPointsChange(() => newPoints);
            }
        };

        const handlePointerUp = (event: PointerEvent) => {
            const state = dragStateRef.current;
            if (state && event.pointerId === state.pointerId) {
                dragStateRef.current = null;
            }
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);

        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        };
    }, [canEdit, emitPointsChange, maxHours, snapStepHours, weeks, yToHours]);

    const tooltipStyles: CSSProperties | undefined = useMemo(() => {
        if (!hoverInfo) {
            return undefined;
        }
        return {
            left: `${hoverInfo.ratioX * 100}%`,
            top: `${Math.min(hoverInfo.ratioY * 100, 92)}%`,
            transform: "translate(-50%, -120%)",
        };
    }, [hoverInfo]);

    const workloadBands = useMemo(() => {
        if (!showBands) {
            return null;
        }

        const bandDefinitions: Array<{
            from: number;
            to: number;
            color: string;
            opacity: number;
        }> = [
            { from: 0, to: 0.5, color: "#4dabf7", opacity: 0.18 },
            { from: 0.5, to: 0.75, color: "#2ecc71", opacity: 0.16 },
            { from: 0.75, to: 0.9, color: "#f1c40f", opacity: 0.18 },
            { from: 0.9, to: 1.2, color: "#e74c3c", opacity: 0.15 },
        ];

        return bandDefinitions
            .map(({ from, to, color, opacity }) => {
                const clampedFrom = clamp(from, 0, 1.2);
                const clampedTo = clamp(to, 0, 1.2);
                if (clampedTo <= clampedFrom) {
                    return null;
                }
                const fromHours = clamp(clampedFrom * maxHours, 0, maxHours);
                const toHours = clamp(clampedTo * maxHours, 0, maxHours);

                if (toHours <= fromHours) {
                    return null;
                }

                const y = hoursToY(toHours);
                const height = hoursToY(fromHours) - y;

                return (
                    <rect
                        key={`${color}-${from}-${to}`}
                        x={0}
                        y={y}
                        width={VIEWBOX_WIDTH}
                        height={height}
                        fill={color}
                        fillOpacity={opacity}
                    />
                );
            })
            .filter(Boolean);
    }, [showBands, maxHours, hoursToY]);

    return (
        <div
            className="lane w-full p-4 flex flex-row items-center space-x-4 overflow-hidden cursor-pointer transition-all"
            onDoubleClick={handleLaneDoubleClick}
        >
            <div className="description text-xl font-bold text-center color-secondary text-white min-w-[220px] max-w-[220px] whitespace-normal break-words">
                {description}
            </div>
            <div className="line relative flex-1" style={{ height: `${lineHeight}px` }}>
                <svg
                    ref={svgRef}
                    width="100%"
                    height={lineHeight}
                    viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
                    xmlns="http://www.w3.org/2000/svg"
                    preserveAspectRatio="none"
                    style={{ display: "block", width: "100%", height: `${lineHeight}px` }}
                    onDoubleClick={handleSvgDoubleClick}
                    onPointerMove={updateHoverInfo}
                    onPointerLeave={clearHoverInfo}
                >
                    {workloadBands}
                    {Array.from({ length: weeks }, (_, index) => {
                        const x = ((index + 1) * VIEWBOX_WIDTH) / weeks;
                        return (
                            <line
                                key={`grid-${index + 1}`}
                                x1={x}
                                y1={0}
                                x2={x}
                                y2={VIEWBOX_HEIGHT}
                                stroke="#415564"
                                strokeWidth={0.4}
                                strokeDasharray="2,2"
                            />
                        );
                    })}
                    <line
                        x1={0}
                        y1={VIEWBOX_HEIGHT}
                        x2={VIEWBOX_WIDTH}
                        y2={VIEWBOX_HEIGHT}
                        stroke="#193139"
                        strokeWidth={1}
                    />
                    {stepPath && (
                        <path
                            d={stepPath}
                            stroke="#00f5d4"
                            strokeWidth={4}
                            fill="none"
                            onPointerDown={handleLinePointerDown}
                            style={{ cursor: canEdit && focused ? "grab" : "default" }}
                        />
                    )}
                    {typeof activeWeek === "number" &&
                        Number.isFinite(activeWeek) &&
                        activeWeek >= 0 &&
                        activeWeek <= weeks && (
                            <line
                                x1={(activeWeek / weeks) * VIEWBOX_WIDTH}
                                y1={0}
                                x2={(activeWeek / weeks) * VIEWBOX_WIDTH}
                                y2={VIEWBOX_HEIGHT}
                                stroke="#ff4d6d"
                                strokeWidth={2}
                                strokeDasharray="4,4"
                                pointerEvents="none"
                            />
                        )}
                    {focused &&
                        sortedPoints.map((point) => {
                            const cx = (point.week / weeks) * VIEWBOX_WIDTH;
                            const cy = hoursToY(point.hours);
                            const radius = Math.max(
                                4,
                                Math.min(
                                    11,
                                    4 + (point.hours / Math.max(1, capacityHours)) * 8
                                )
                            );
                            return (
                                <circle
                                    key={point.id}
                                    cx={cx}
                                    cy={cy}
                                    r={point.fixed ? radius + 1 : radius}
                                    fill="#f72585"
                                    stroke="#ffe3ff"
                                    strokeWidth={1}
                                    onPointerDown={(event) =>
                                        handlePointPointerDown(event, point.id, point.fixed)
                                    }
                                    onDoubleClick={(event) =>
                                        handlePointDoubleClick(event, point.id, point.fixed)
                                    }
                                    style={{ cursor: canEdit ? "grab" : "default" }}
                                />
                            );
                        })}
                </svg>
                {hoverInfo && tooltipStyles && (
                    <div
                        className="pointer-events-none absolute z-20 rounded border border-slate-700/60 bg-slate-900/95 px-2 py-1 text-[10px] font-medium text-slate-100 shadow-lg backdrop-blur-sm"
                        style={tooltipStyles}
                    >
                        <div>
                            {hoverInfo.isoYear} • W{hoverInfo.isoWeek.toString().padStart(2, "0")}
                        </div>
                        <div>
                            {hoverInfo.startLabel} → {hoverInfo.endLabel}
                        </div>
                        <div>{hoverInfo.hours.toFixed(1)}h</div>
                    </div>
                )}
            </div>
        </div>
    );
}

export { Lane };
