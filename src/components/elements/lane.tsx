import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type RefObject,
} from "react";

type ViewBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type SvgPoint = {
    x: number;
    y: number;
};

const createPointId = () =>
    `lane-point-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
    clientX: number;
    clientY: number;
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
const DEFAULT_VIEW_BOX: ViewBox = {
    x: 0,
    y: 0,
    width: VIEWBOX_WIDTH,
    height: VIEWBOX_HEIGHT,
};
const DEFAULT_LINE_HEIGHT = 140;
const EDIT_LINE_HEIGHT = 260;
const ZOOM_WIDTH = VIEWBOX_WIDTH / 3;
const EDGE_PADDING = 30;
const DATA_WIDTH = VIEWBOX_WIDTH - EDGE_PADDING * 2;
const POINT_RADIUS = 5;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const roundToStep = (value: number, step: number) => {
    if (step <= 0) {
        return value;
    }
    return Math.round(value / step) * step;
};

const sortPoints = (points: LanePoint[]) => [...points].sort((a, b) => a.week - b.week);

const pointsAreEqual = (left: LanePoint[], right: LanePoint[]) => {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        const a = left[index];
        const b = right[index];
        if (!a || !b) {
            return false;
        }
        if (
            a.id !== b.id ||
            a.week !== b.week ||
            a.hours !== b.hours ||
            Boolean(a.fixed) !== Boolean(b.fixed) ||
            (a.year ?? null) !== (b.year ?? null)
        ) {
            return false;
        }
    }
    return true;
};

const toLocaleDay = (date: Date) =>
    date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

const weekToX = (week: number, totalWeeks: number) => {
    if (totalWeeks <= 0) {
        return EDGE_PADDING;
    }
    return EDGE_PADDING + (week / totalWeeks) * DATA_WIDTH;
};

const xToWeek = (x: number, totalWeeks: number) => {
    if (totalWeeks <= 0) {
        return 0;
    }
    const normalized = (x - EDGE_PADDING) / DATA_WIDTH;
    return clamp(normalized, 0, 1) * totalWeeks;
};

const getIsoWeekDateRange = (isoYear: number, isoWeek: number) => {
    const simple = new Date(Date.UTC(isoYear, 0, 4));
    const simpleDay = simple.getUTCDay() || 7;
    simple.setUTCDate(simple.getUTCDate() - simpleDay + 1 + (isoWeek - 1) * 7);

    const start = new Date(simple);
    const end = new Date(simple);
    end.setUTCDate(start.getUTCDate() + 6);

    return {
        startLabel: toLocaleDay(start),
        endLabel: toLocaleDay(end),
    };
};

const useSvgPoint = (svgRef: RefObject<SVGSVGElement>) =>
    useCallback(
        (clientX: number, clientY: number): SvgPoint | null => {
            const svg = svgRef.current;
            if (!svg) {
                return null;
            }
            const ctm = svg.getScreenCTM();
            if (!ctm) {
                return null;
            }
            const pointer = svg.createSVGPoint();
            pointer.x = clientX;
            pointer.y = clientY;
            const transformed = pointer.matrixTransform(ctm.inverse());
            return { x: transformed.x, y: transformed.y };
        },
        [svgRef]
    );

const useZoomableViewBox = (svgRef: RefObject<SVGSVGElement>) => {
    const [isEditing, setIsEditing] = useState(false);
    const [viewBox, setViewBox] = useState<ViewBox>({ ...DEFAULT_VIEW_BOX });
    const toSvgPoint = useSvgPoint(svgRef);

    const resetView = useCallback(() => {
        setViewBox({ ...DEFAULT_VIEW_BOX });
        setIsEditing(false);
    }, []);

    const zoomToPoint = useCallback((point: SvgPoint) => {
        const width = clamp(ZOOM_WIDTH, VIEWBOX_WIDTH / 6, VIEWBOX_WIDTH);
        const x = clamp(point.x - width / 2, 0, VIEWBOX_WIDTH - width);
        setViewBox({
            x,
            y: DEFAULT_VIEW_BOX.y,
            width,
            height: DEFAULT_VIEW_BOX.height,
        });
        setIsEditing(true);
    }, []);

    const enterAtPoint = useCallback(
        (point: SvgPoint) => {
            zoomToPoint(point);
        },
        [zoomToPoint]
    );

    const toggleAt = useCallback(
        (clientX: number, clientY: number) => {
            if (isEditing) {
                resetView();
                return;
            }
            const point = toSvgPoint(clientX, clientY);
            if (!point) {
                return;
            }
            zoomToPoint(point);
        },
        [isEditing, resetView, toSvgPoint, zoomToPoint]
    );

    useEffect(() => {
        if (!isEditing) {
            setViewBox({ ...DEFAULT_VIEW_BOX });
        }
    }, [isEditing]);

    return {
        isEditing,
        viewBox,
        toggleAt,
        toSvgPoint,
        resetView,
        enterAtPoint,
    };
};

const useLaneMetrics = ({
    points,
    weeks,
    capacityHours,
    maxLoadPercent,
    snapStepHours,
    startValue,
    endValue,
}: {
    points: LanePoint[];
    weeks: number;
    capacityHours: number;
    maxLoadPercent: number;
    snapStepHours: number;
    startValue?: number;
    endValue?: number;
}) => {
    const safeCapacityHours = useMemo(
        () => Math.max(capacityHours, snapStepHours),
        [capacityHours, snapStepHours]
    );

    const maxHours = useMemo(
        () => Math.max((safeCapacityHours * maxLoadPercent) / 100, snapStepHours),
        [safeCapacityHours, maxLoadPercent, snapStepHours]
    );

    const sanitizedPoints = useMemo(
        () =>
            sortPoints(
                points.map((point) => {
                    const normalizedWeek = clamp(Math.round(point.week), 1, weeks);
                    return {
                        ...point,
                        week: normalizedWeek,
                        hours: clamp(point.hours, 0, maxHours),
                    };
                })
            ),
        [points, maxHours, weeks]
    );

    const interiorPoints = useMemo(
        () => sanitizedPoints.filter((point) => point.week > 1 && point.week < weeks),
        [sanitizedPoints, weeks]
    );

    const boundaryStart = useMemo(
        () =>
            clamp(
                startValue ??
                    sanitizedPoints.find((point) => point.week === 1)?.hours ??
                    interiorPoints[0]?.hours ??
                    0,
                0,
                maxHours
            ),
        [startValue, sanitizedPoints, interiorPoints, maxHours]
    );

    const explicitEnd = typeof endValue === "number" ? endValue : null;

    const boundaryEnd = useMemo(() => {
        if (explicitEnd !== null) {
            return clamp(explicitEnd, 0, maxHours);
        }
        const providedEnd = sanitizedPoints
            .slice()
            .reverse()
            .find((point) => point.week === weeks);
        if (providedEnd) {
            return clamp(providedEnd.hours, 0, maxHours);
        }
        return 0;
    }, [explicitEnd, sanitizedPoints, maxHours, weeks]);

    const displayPoints = useMemo(() => {
        const startPoint =
            sanitizedPoints.find((point) => point.week === 1) ??
            ({
                id: "__lane-start",
                week: 1,
                hours: boundaryStart,
                fixed: true,
            } as LanePoint);

        const endPoint =
            sanitizedPoints.find((point) => point.week === weeks) ??
            ({
                id: "__lane-end",
                week: weeks,
                hours: boundaryEnd,
                fixed: true,
            } as LanePoint);

        const middlePoints = sanitizedPoints.filter(
            (point) => point.week > 1 && point.week < weeks
        );

        const combined = [
            { ...startPoint, hours: clamp(startPoint.hours, 0, maxHours), fixed: true },
            ...middlePoints.map((point) => ({
                ...point,
                hours: clamp(point.hours, 0, maxHours),
            })),
            { ...endPoint, hours: clamp(endPoint.hours, 0, maxHours), fixed: true },
        ];

        const uniqueByWeek = combined.reduce((acc, point) => {
            const existingIndex = acc.findIndex((entry) => entry.week === point.week);
            if (existingIndex === -1) {
                acc.push(point);
                return acc;
            }

            const existing = acc[existingIndex];
            if (existing.fixed && !point.fixed) {
                return acc;
            }
            if (!existing.fixed && point.fixed) {
                acc[existingIndex] = point;
                return acc;
            }

            acc[existingIndex] = point;
            return acc;
        }, [] as LanePoint[]);

        return sortPoints(uniqueByWeek);
    }, [sanitizedPoints, boundaryStart, boundaryEnd, weeks, maxHours]);

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
        let currentX = weekToX(displayPoints[0].week, weeks);
        let currentY = hoursToY(displayPoints[0].hours);
        commands.push(`M ${currentX} ${currentY}`);

        for (let index = 0; index < displayPoints.length - 1; index += 1) {
            const currentPoint = displayPoints[index];
            const nextPoint = displayPoints[index + 1];
            if (!currentPoint || !nextPoint) {
                continue;
            }

            const nextX = weekToX(nextPoint.week, weeks);
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

    return {
        safeCapacityHours,
        maxHours,
        sortedPoints: interiorPoints,
        displayPoints,
        hoursToY,
        yToHours,
        interpolateDisplayHours,
        stepPath,
        boundaryStart,
        boundaryEnd,
    };
};

const LaneGrid = ({ weeks }: { weeks: number }) => {
    return (
        <>
            {Array.from({ length: weeks }, (_, index) => {
                const x = weekToX(index + 1, weeks);
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
        </>
    );
};

const LanePoints = ({
    points,
    weeks,
    hoursToY,
    onPointerDown,
    pointScale,
    editable,
}: {
    points: LanePoint[];
    weeks: number;
    hoursToY: (hours: number) => number;
    onPointerDown: (event: ReactPointerEvent<SVGEllipseElement>, pointId: string) => void;
    pointScale: { scaleX: number; scaleY: number };
    editable: boolean;
}) => (
    <>
        {points
            .filter((point) => point.week > 0 && point.week < weeks && !point.fixed)
            .map((point) => {
                const cx = weekToX(point.week, weeks);
                const cy = hoursToY(point.hours);
                const scaleX = pointScale.scaleX > 0 ? pointScale.scaleX : 1;
                const scaleY = pointScale.scaleY > 0 ? pointScale.scaleY : 1;
                const rx = POINT_RADIUS / scaleX;
                const ry = POINT_RADIUS / scaleY;
                return (
                    <ellipse
                        key={point.id}
                        cx={cx}
                        cy={cy}
                        rx={rx}
                        ry={ry}
                        fill="#f72585"
                        stroke="#ffe3ff"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                        onPointerDown={(event) => onPointerDown(event, point.id)}
                        style={{ cursor: editable ? "grab" : "default" }}
                    />
                );
            })}
    </>
);

const LaneTooltip = ({ hoverInfo }: { hoverInfo: HoverInfo | null }) => {
    const tooltipStyles: CSSProperties | undefined = useMemo(() => {
        if (!hoverInfo) {
            return undefined;
        }
        const left = hoverInfo.clientX;
        const top = hoverInfo.clientY;
        const viewportWidth =
            typeof window !== "undefined" && typeof window.innerWidth === "number"
                ? window.innerWidth
                : 0;
        const distanceToLeft = left;
        const distanceToRight = viewportWidth - left;

        let translateX = "-50%";
        if (distanceToLeft < 160) {
            translateX = "-5%";
        } else if (distanceToRight < 160) {
            translateX = "-95%";
        }

        return {
            position: "fixed",
            left,
            top,
            transform: `translate(${translateX}, -120%)`,
            pointerEvents: "none",
            zIndex: 1000,
            maxWidth: "200px",
        };
    }, [hoverInfo]);

    if (!hoverInfo || !tooltipStyles) {
        return null;
    }

    return (
        <div
            className="pointer-events-none rounded border border-slate-700/60 bg-slate-900/95 px-2 py-1 text-[10px] font-medium text-slate-100 shadow-lg backdrop-blur-sm"
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
    );
};

const ZoomableLaneSvg = ({
    svgRef,
    viewBox,
    weeks,
    stepPath,
    activeWeek,
    showPoints,
    sortedPoints,
    hoursToY,
    workloadBands,
    onDoubleClick,
    onPointerMove,
    onPointerLeave,
    onPointerDown,
    onPointPointerDown,
    pointScale,
    editable,
}: {
    svgRef: RefObject<SVGSVGElement>;
    viewBox: ViewBox;
    weeks: number;
    stepPath: string;
    activeWeek?: number | null;
    showPoints: boolean;
    sortedPoints: LanePoint[];
    hoursToY: (hours: number) => number;
    workloadBands: React.ReactNode;
    onDoubleClick: (event: ReactMouseEvent<SVGSVGElement>) => void;
    onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
    onPointerLeave: () => void;
    onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
    onPointPointerDown: (event: ReactPointerEvent<SVGEllipseElement>, pointId: string) => void;
    pointScale: { scaleX: number; scaleY: number };
    editable: boolean;
}) => (
    <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height: "100%" }}
        onDoubleClick={onDoubleClick}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
    >
        {workloadBands}
        <LaneGrid weeks={weeks} />
        <line
            x1={EDGE_PADDING}
            y1={VIEWBOX_HEIGHT}
            x2={VIEWBOX_WIDTH - EDGE_PADDING}
            y2={VIEWBOX_HEIGHT}
            stroke="#193139"
            strokeWidth={1}
        />
        {stepPath && (
            <path d={stepPath} stroke="#00f5d4" strokeWidth={4} fill="none" />
        )}
        {typeof activeWeek === "number" &&
            Number.isFinite(activeWeek) &&
            activeWeek >= 0 &&
            activeWeek <= weeks && (
                <line
                    x1={weekToX(activeWeek, weeks)}
                    y1={0}
                    x2={weekToX(activeWeek, weeks)}
                    y2={VIEWBOX_HEIGHT}
                    stroke="#ff4d6d"
                    strokeWidth={2}
                    strokeDasharray="4,4"
                    pointerEvents="none"
                />
            )}
        {showPoints && (
            <LanePoints
                points={sortedPoints}
                weeks={weeks}
                hoursToY={hoursToY}
                onPointerDown={onPointPointerDown}
                pointScale={pointScale}
                editable={editable}
            />
        )}
    </svg>
);

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
    const svgRef = useRef<SVGSVGElement | null>(null);
    const pointsRef = useRef(points);
    const dragStateRef = useRef<
        | null
        | {
              type: "point";
              pointId: string;
              pointerId: number;
              fixed?: boolean;
          }
    >(null);
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
    const [pointScale, setPointScale] = useState<{ scaleX: number; scaleY: number }>({
        scaleX: 1,
        scaleY: 1,
    });

    const weeks = Math.max(1, Math.round(totalWeeks));
    const { isEditing, viewBox, toggleAt, toSvgPoint, enterAtPoint } = useZoomableViewBox(svgRef);

    pointsRef.current = points;

    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) {
            return;
        }

        const updateScale = () => {
            const rect = svg.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) {
                setPointScale({ scaleX: 1, scaleY: 1 });
                return;
            }
            setPointScale({
                scaleX: rect.width / viewBox.width,
                scaleY: rect.height / viewBox.height,
            });
        };

        updateScale();

        if (typeof ResizeObserver !== "undefined") {
            const observer = new ResizeObserver(() => updateScale());
            observer.observe(svg);
            return () => observer.disconnect();
        }

        const handleResize = () => updateScale();
        if (typeof window !== "undefined") {
            window.addEventListener("resize", handleResize);
        }

        return () => {
            if (typeof window !== "undefined") {
                window.removeEventListener("resize", handleResize);
            }
        };
    }, [viewBox]);

    const canEdit = editable && typeof onPointsChange === "function";
    const {
        maxHours,
        sortedPoints,
        displayPoints,
        hoursToY,
        yToHours,
        interpolateDisplayHours,
        stepPath,
        boundaryStart,
        boundaryEnd,
    } = useLaneMetrics({
        points,
        weeks,
        capacityHours,
        maxLoadPercent,
        snapStepHours,
        startValue,
        endValue,
    });

    const ensureBoundaryPoints = useCallback(
        (candidate: LanePoint[]) => {
            const normalized = candidate.map((point) => ({
                ...point,
                hours: clamp(point.hours, 0, maxHours),
            }));

            const startIndex = normalized.findIndex((point) => point.week === 0);
            if (startIndex === -1) {
                normalized.push({
                    id: createPointId(),
                    week: 0,
                    hours: boundaryStart,
                    fixed: true,
                    year,
                });
            } else {
                const existing = normalized[startIndex];
                normalized[startIndex] = {
                    ...existing,
                    hours: clamp(existing.hours ?? boundaryStart, 0, maxHours),
                    fixed: true,
                    year: existing.year ?? year,
                };
            }

            const endIndex = normalized.findIndex((point) => point.week === weeks);
            if (endIndex === -1) {
                normalized.push({
                    id: createPointId(),
                    week: weeks,
                    hours: boundaryEnd,
                    fixed: true,
                    year,
                });
            } else {
                const existingEnd = normalized[endIndex];
                normalized[endIndex] = {
                    ...existingEnd,
                    hours: clamp(existingEnd.hours ?? boundaryEnd, 0, maxHours),
                    fixed: true,
                    year: existingEnd.year ?? year,
                };
            }

            return normalized;
        },
        [boundaryStart, boundaryEnd, maxHours, weeks, year]
    );

    const normalizePoints = useCallback(
        (candidate: LanePoint[]) => {
            const withBoundaries = ensureBoundaryPoints(candidate);
            return sortPoints(withBoundaries).reduce((acc, point) => {
                const existingIndex = acc.findIndex((entry) => entry.week === point.week);
                if (existingIndex === -1) {
                    acc.push(point);
                    return acc;
                }

                const existing = acc[existingIndex];
                if (existing.fixed && !point.fixed) {
                    return acc;
                }
                if (!existing.fixed && point.fixed) {
                    acc[existingIndex] = point;
                    return acc;
                }

                acc[existingIndex] = point;
                return acc;
            }, [] as LanePoint[]);
        },
        [ensureBoundaryPoints]
    );

    const emitPointsChange = useCallback(
        (mutator: (current: LanePoint[]) => LanePoint[]) => {
            if (!canEdit || !onPointsChange) {
                return;
            }
            const current = pointsRef.current;
            const mutated = mutator(current);
            const normalized = normalizePoints(mutated);
            const currentNormalized = normalizePoints(current);
            if (pointsAreEqual(currentNormalized, normalized)) {
                pointsRef.current = currentNormalized;
                return;
            }
            pointsRef.current = normalized;
            onPointsChange(normalized);
        },
        [canEdit, normalizePoints, onPointsChange]
    );

    const updateHoverInfo = useCallback(
        (event: ReactPointerEvent<SVGSVGElement>) => {
            const svgElement = svgRef.current;
            if (!svgElement) {
                return;
            }
            const svgPoint = toSvgPoint(event.clientX, event.clientY);
            if (!svgPoint) {
                return;
            }

            const rect = svgElement.getBoundingClientRect();
            const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
            const dataRatioX = clamp((svgPoint.x - EDGE_PADDING) / DATA_WIDTH, 0, 1);
            const ratioYForData = clamp(svgPoint.y / VIEWBOX_HEIGHT, 0, 1);

            const rawWeekPosition = dataRatioX * weeks;
            const weekIndex = clamp(Math.round(rawWeekPosition), 0, weeks);
            const isoWeekValue = clamp(weekIndex + 1, 1, weeks);
            const hours = interpolateDisplayHours(rawWeekPosition) ?? yToHours(ratioYForData);
            const { startLabel, endLabel } = getIsoWeekDateRange(year, isoWeekValue);

            setHoverInfo({
                ratioX,
                ratioY,
                clientX: event.clientX,
                clientY: event.clientY,
                isoWeek: isoWeekValue,
                isoYear: year,
                startLabel,
                endLabel,
                hours,
            });
        },
        [interpolateDisplayHours, toSvgPoint, weeks, year, yToHours]
    );

    const clearHoverInfo = useCallback(() => {
        setHoverInfo(null);
    }, []);

    const addPointAt = useCallback(
        (svgPoint: SvgPoint) => {
            if (!canEdit) {
                return;
            }

            if (!isEditing) {
                enterAtPoint(svgPoint);
            }

            const week = clamp(Math.round(xToWeek(svgPoint.x, weeks)), 0, weeks);
            const ratioY = clamp(svgPoint.y / VIEWBOX_HEIGHT, 0, 1);
            const hours = clamp(roundToStep(yToHours(ratioY), snapStepHours), 0, maxHours);

            emitPointsChange((current) => {
                const filtered = current.filter(
                    (point) => !(point.week === week && !point.fixed)
                );
                return [
                    ...filtered,
                    {
                        id: createPointId(),
                        week,
                        hours,
                    },
                ];
            });
        },
        [
            canEdit,
            emitPointsChange,
            enterAtPoint,
            isEditing,
            maxHours,
            snapStepHours,
            weeks,
            yToHours,
        ]
    );

    const handleSvgPointerDown = useCallback(
        (event: ReactPointerEvent<SVGSVGElement>) => {
            if (!event.altKey || event.button !== 0) {
                return;
            }
            if (!canEdit) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const svgPoint = toSvgPoint(event.clientX, event.clientY);
            if (!svgPoint) {
                return;
            }
            addPointAt(svgPoint);
        },
        [addPointAt, canEdit, toSvgPoint]
    );

    const handleSvgDoubleClick = useCallback(
        (event: ReactMouseEvent<SVGSVGElement>) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.altKey) {
                return;
            }
            if (!isEditing && !canEdit) {
                return;
            }

            toggleAt(event.clientX, event.clientY);
        },
        [canEdit, isEditing, toggleAt]
    );

    const handlePointPointerDown = useCallback(
        (event: ReactPointerEvent<SVGEllipseElement>, pointId: string) => {
            if (!canEdit) {
                return;
            }

            if (event.altKey) {
                if (!isEditing) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                emitPointsChange((current) => current.filter((point) => point.id !== pointId));
                return;
            }

            if (!isEditing) {
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
        [canEdit, emitPointsChange, isEditing]
    );

    useEffect(() => {
        if (!canEdit) {
            return;
        }

        const handlePointerMove = (event: PointerEvent) => {
            const state = dragStateRef.current;
            if (!state || state.type !== "point" || event.pointerId !== state.pointerId) {
                return;
            }

            const svgPoint = toSvgPoint(event.clientX, event.clientY);
            if (!svgPoint) {
                return;
            }

            const ratioY = clamp(svgPoint.y / VIEWBOX_HEIGHT, 0, 1);
            const rawWeekPosition = xToWeek(svgPoint.x, weeks);
            const week = clamp(Math.round(rawWeekPosition), 0, weeks);
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
                        const firstIndex = arr.findIndex(
                            (entry) => entry.week === point.week && !entry.fixed
                        );
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
    }, [canEdit, emitPointsChange, maxHours, snapStepHours, toSvgPoint, weeks, yToHours]);

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
                        x={EDGE_PADDING}
                        y={y}
                        width={DATA_WIDTH}
                        height={height}
                        fill={color}
                        fillOpacity={opacity}
                    />
                );
            })
            .filter(Boolean);
    }, [showBands, maxHours, hoursToY]);

    const lineHeight = isEditing ? EDIT_LINE_HEIGHT : DEFAULT_LINE_HEIGHT;

    return (
        <div className="w-full rounded-md bg-slate-900/40 p-3">
            <div className="flex items-center gap-3">
                <div className="flex-shrink-0 rounded bg-slate-800 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200">
                    {description}
                </div>
            </div>
            <div
                className="relative mt-2"
                style={{ height: `${lineHeight}px`, transition: "height 0.3s ease" }}
            >
                <ZoomableLaneSvg
                    svgRef={svgRef}
                    viewBox={viewBox}
                    weeks={weeks}
                    stepPath={stepPath}
                    activeWeek={activeWeek}
                    showPoints={isEditing}
                    sortedPoints={sortedPoints}
                    hoursToY={hoursToY}
                    workloadBands={workloadBands}
                    onDoubleClick={handleSvgDoubleClick}
                    onPointerMove={updateHoverInfo}
                    onPointerLeave={clearHoverInfo}
                    onPointerDown={handleSvgPointerDown}
                    onPointPointerDown={handlePointPointerDown}
                    pointScale={pointScale}
                    editable={canEdit && isEditing}
                />
                <LaneTooltip hoverInfo={hoverInfo} />
            </div>
        </div>
    );
}

export { Lane };
