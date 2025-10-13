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

type HoverInfo = {
    ratioX: number;
    ratioY: number;
    isoWeek: number;
    isoYear: number;
    startLabel: string;
    endLabel: string;
    hours: number;
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
    startValue?: number;
    endValue?: number;
};

const TOTAL_WEEKS = 52;
const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 100;

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
    startValue,
    endValue,
}: LaneProps) {
    const [focused, setFocused] = useState(false);
    const weeks = Math.max(1, Math.round(totalWeeks));
    const svgRef = useRef<SVGSVGElement | null>(null);
    const pointsRef = useRef(points);
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
    const dragStateRef = useRef<
        | null
        | {
              type: "point";
              pointId: string;
              pointerId: number;
              fixed?: boolean;
          }
    >(null);

    pointsRef.current = points;

    const lineHeight = focused ? 260 : 140;

    const canEdit = editable && typeof onPointsChange === "function";
    const safeCapacityHours = Math.max(capacityHours, snapStepHours);
    const maxHours = Math.max((safeCapacityHours * maxLoadPercent) / 100, snapStepHours);

    const sortedPoints = useMemo(
        () =>
            sortPoints(
                points.map((point) => ({
                    ...point,
                    hours: clamp(point.hours, 0, maxHours),
                }))
            ),
        [points, maxHours]
    );

    const boundaryStart = clamp(
        startValue ?? sortedPoints[0]?.hours ?? 0,
        0,
        maxHours
    );
    const boundaryEnd = clamp(
        endValue ?? sortedPoints[sortedPoints.length - 1]?.hours ?? boundaryStart,
        0,
        maxHours
    );

    const displayPoints = useMemo(() => {
        const list: LanePoint[] = [
            { id: "__lane-start", week: 0, hours: boundaryStart, fixed: true },
            ...sortedPoints,
        ];

        if (sortedPoints.length === 0 || sortedPoints[sortedPoints.length - 1]?.week !== weeks) {
            list.push({ id: "__lane-end", week: weeks, hours: boundaryEnd, fixed: true });
        } else {
            list.push({
                id: "__lane-end",
                week: weeks,
                hours: boundaryEnd,
                fixed: true,
            });
        }

        return list;
    }, [sortedPoints, boundaryStart, boundaryEnd, weeks]);

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

    const interpolateDisplayHours = useCallback(
        (week: number) => {
            const clampedWeek = clamp(week, 0, weeks);
            let last = displayPoints[0];
            for (let index = 0; index < displayPoints.length; index += 1) {
                const point = displayPoints[index];
                if (!point) {
                    continue;
                }
                if (point.week > clampedWeek) {
                    break;
                }
                last = point;
            }
            return last?.hours ?? 0;
        },
        [displayPoints, weeks]
    );

    const stepPath = useMemo(() => {
        if (displayPoints.length === 0) {
            return "";
        }

        const commands: string[] = [];
        let currentX = (displayPoints[0].week / weeks) * VIEWBOX_WIDTH;
        let currentY = hoursToY(displayPoints[0].hours);
        commands.push(`M ${currentX} ${currentY}`);

        for (let index = 0; index < displayPoints.length - 1; index += 1) {
            const currentPoint = displayPoints[index];
            const nextPoint = displayPoints[index + 1];
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

        return commands.join(" ");
    }, [displayPoints, hoursToY, weeks]);

    const emitPointsChange = useCallback(
        (mutator: (current: LanePoint[]) => LanePoint[]) => {
            if (!canEdit || !onPointsChange) {
                return;
            }
            const current = pointsRef.current;
            const next = sortPoints(mutator(current)).map((point) => ({
                ...point,
                hours: clamp(point.hours, 0, maxHours),
            }));
            onPointsChange(next);
        },
        [canEdit, onPointsChange, maxHours]
    );

    const handleLaneDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.altKey) {
            return;
        }
        setFocused((prev) => !prev);
    }, []);

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
            const isoWeekValue = clamp(weekIndex + 1, 1, weeks);
            const hours = interpolateDisplayHours(rawWeekPosition);
            const { startLabel, endLabel } = getIsoWeekDateRange(year, isoWeekValue);

            setHoverInfo({
                ratioX,
                ratioY,
                isoWeek: isoWeekValue,
                isoYear: year,
                startLabel,
                endLabel,
                hours,
            });
        },
        [weeks, interpolateDisplayHours, year]
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

                const defaultHours = interpolateDisplayHours(week);
                const snappedHours = roundToStep(defaultHours, snapStepHours);

                const newPoint: LanePoint = {
                    id: createPointId(),
                    week,
                    hours: clamp(snappedHours, 0, maxHours),
                };

                return [...current, newPoint];
            });
        },
        [focused, canEdit, emitPointsChange, interpolateDisplayHours, snapStepHours, maxHours, weeks]
    );

    const handlePointPointerDown = useCallback(
        (event: ReactPointerEvent<SVGCircleElement>, pointId: string) => {
            if (!focused || !event.altKey || !canEdit) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragStateRef.current = {
                type: "point",
                pointId,
                pointerId: event.pointerId,
            };
        },
        [focused, canEdit]
    );

    const handlePointDoubleClick = useCallback(
        (event: ReactMouseEvent<SVGCircleElement>, pointId: string) => {
            if (!canEdit || !event.altKey || !focused) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            emitPointsChange((current) => current.filter((point) => point.id !== pointId));
        },
        [canEdit, focused, emitPointsChange]
    );

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const state = dragStateRef.current;
            const svg = svgRef.current;

            if (!svg || !state || !canEdit || state.type !== "point") {
                return;
            }

            if (event.pointerId !== state.pointerId) {
                return;
            }

            const rect = svg.getBoundingClientRect();
            const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);

            const week = clamp(Math.round(ratioX * weeks), 0, weeks);
            const snappedHours = roundToStep(yToHours(ratioY), snapStepHours);

            emitPointsChange((current) =>
                current
                    .map((point) =>
                        point.id === state.pointId
                            ? {
                                  ...point,
                                  week,
                                  hours: clamp(snappedHours, 0, maxHours),
                              }
                            : point
                    )
                    .filter((point, index, arr) => {
                        if (point.fixed) {
                            return true;
                        }
                        const firstIndex = arr.findIndex((entry) => entry.week === point.week && !entry.fixed);
                        return firstIndex === index;
                    })
            );
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
        if (!hoverInfo || !svgRef.current) {
            return undefined;
        }
        const svgRect = svgRef.current.getBoundingClientRect();
        // Calculate the absolute position relative to the SVG container
        const left = hoverInfo.ratioX * svgRect.width + svgRect.left;
        const top = hoverInfo.ratioY * svgRect.height + svgRect.top;
        return {
            position: "fixed",
            left: `${left}px`,
            top: `${top}px`,
            transform: "translate(-50%, -120%)",
            zIndex: 1000,
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
            className="w-full rounded-md bg-slate-900/40 p-3"
            onDoubleClick={handleLaneDoubleClick}
        >
            <div className="flex items-center gap-3">
                <div className="flex-shrink-0 rounded bg-slate-800 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200">
                    {description}
                </div>
            </div>
            <div className="mt-2">
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
                                Math.min(11, 4 + (point.hours / Math.max(1, capacityHours)) * 8)
                            );
                            return (
                                <circle
                                    key={point.id}
                                    cx={cx}
                                    cy={cy}
                                    r={radius}
                                    fill="#f72585"
                                    stroke="#ffe3ff"
                                    strokeWidth={1}
                                    onPointerDown={(event) => handlePointPointerDown(event, point.id)}
                                    onDoubleClick={(event) => handlePointDoubleClick(event, point.id)}
                                    style={{ cursor: canEdit ? "grab" : "default" }}
                                />
                            );
                        })}
                </svg>
                {hoverInfo && tooltipStyles && (
                    <div
                        className="pointer-events-none -mt-4 rounded border border-slate-700/60 bg-slate-900/95 px-2 py-1 text-[10px] font-medium text-slate-100 shadow-lg backdrop-blur-sm"
                       
                        style={{
                            ...tooltipStyles,
                            minWidth: "auto",
                            maxWidth: "180px",
                            width: "auto",
                            padding: "2px 6px",
                            fontSize: "11px",
                            position: "absolute",
                            pointerEvents: "none",
                        }}
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
