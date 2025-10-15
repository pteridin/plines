import { serve } from "bun";
import { sql } from "bun";
import index from "./index.html";
import { sql_init } from "./db/init";
import type { LanePoint } from "./components/elements/lane";

type ProjectRecord = {
    external_id: string;
    name: string;
    active: boolean;
};

type WorkloadRow = {
    project_id: string;
    project_name: string;
    project_active: boolean;
    week: number;
    hours: number;
    year: number;
};

await sql_init();

const server = serve({
    routes: {
        "/*": index,

        "/api/projects": {
            async GET() {
                const projects = await sql<ProjectRecord[]>`
                    SELECT external_id, name, active
                    FROM projects
                    ORDER BY name
                `;

                return Response.json(
                    projects.map((project) => ({
                        id: project.external_id,
                        name: project.name,
                        active: project.active,
                    }))
                );
            },
        },

        "/api/workloads/:employeeExternalId/:year": {
            async GET(req) {
                const { employeeExternalId, year } = req.params;
                const parsedYear = Number(year);
                if (!Number.isFinite(parsedYear)) {
                    return new Response("Invalid year", { status: 400 });
                }

                const employeeRows = await sql<{ id: number }[]>`
                    SELECT id
                    FROM employees
                    WHERE external_id = ${employeeExternalId}
                    LIMIT 1
                `;

                if (employeeRows.length === 0) {
                    return new Response("Employee not found", { status: 404 });
                }

                const employeeId = employeeRows[0]!.id;

                const workloadRows = await sql<WorkloadRow[]>`
                    SELECT
                        p.external_id AS project_id,
                        p.name AS project_name,
                        p.active AS project_active,
                        w.week,
                        w.hours,
                        w.year
                    FROM workloads w
                    INNER JOIN projects p ON w.project_id = p.id
                    WHERE w.employee_id = ${employeeId} AND w.year = ${parsedYear}
                    ORDER BY p.name, w.week
                `;

                const lanes = new Map<
                    string,
                    { projectId: string; name: string; active: boolean; points: LanePoint[] }
                >();

                for (const row of workloadRows) {
                    const existing = lanes.get(row.project_id);
                    const point: LanePoint = {
                        id: `${row.project_id}-${row.week}`,
                        week: row.week,
                        hours: row.hours,
                        year: row.year,
                        absoluteWeek: row.week,
                    };

                    if (existing) {
                        existing.points.push(point);
                        continue;
                    }

                    lanes.set(row.project_id, {
                        projectId: row.project_id,
                        name: row.project_name,
                        active: row.project_active,
                        points: [point],
                    });
                }

                const payload = Array.from(lanes.values()).map((lane) => ({
                    ...lane,
                    points: lane.points.sort((a, b) => a.week - b.week),
                }));

                return Response.json(payload);
            },
        },

        "/api/workloads/:employeeExternalId/:projectExternalId/:year": {
            async PUT(req) {
                const { employeeExternalId, projectExternalId, year } = req.params;
                const parsedYear = Number(year);
                if (!Number.isFinite(parsedYear)) {
                    return new Response("Invalid year", { status: 400 });
                }

                let payload: unknown;
                try {
                    payload = await req.json();
                } catch (error) {
                    return new Response(`Invalid JSON payload: ${String(error)}`, { status: 400 });
                }

                if (
                    typeof payload !== "object" ||
                    payload === null ||
                    !Array.isArray((payload as { points?: unknown }).points)
                ) {
                    return new Response("Payload must include a points array.", { status: 400 });
                }

                const rawPoints = (payload as { points: Array<Record<string, unknown>> }).points;
                const sanitizedPoints = rawPoints
                    .map((raw) => ({
                        week: Number(raw.week),
                        hours: Number(raw.hours),
                    }))
                    .filter(
                        (point) =>
                            Number.isFinite(point.week) &&
                            Number.isFinite(point.hours) &&
                            point.week >= 1 &&
                            point.week <= 53
                    )
                    .map((point) => ({
                        week: Math.round(point.week),
                        hours: point.hours,
                    }))
                    .sort((a, b) => a.week - b.week);

                const uniquePoints = Array.from(
                    new Map<number, { week: number; hours: number }>(
                        sanitizedPoints.map((point) => [point.week, point])
                    ).values()
                );

                const employeeRows = await sql<{ id: number }[]>`
                    SELECT id
                    FROM employees
                    WHERE external_id = ${employeeExternalId}
                    LIMIT 1
                `;

                if (employeeRows.length === 0) {
                    return new Response("Employee not found", { status: 404 });
                }

                const projectRows = await sql<{ id: number; external_id: string; name: string; active: boolean }[]>`
                    SELECT id, external_id, name, active
                    FROM projects
                    WHERE external_id = ${projectExternalId}
                    LIMIT 1
                `;

                if (projectRows.length === 0) {
                    return new Response("Project not found", { status: 404 });
                }

                const employeeId = employeeRows[0]!.id;
                const project = projectRows[0]!;

                await sql.begin(async (tx) => {
                    await tx`
                        DELETE FROM workloads
                        WHERE employee_id = ${employeeId}
                          AND project_id = ${project.id}
                          AND year = ${parsedYear}
                    `;

                    for (const point of uniquePoints) {
                        await tx`
                            INSERT INTO workloads (employee_id, project_id, week, year, hours)
                            VALUES (${employeeId}, ${project.id}, ${point.week}, ${parsedYear}, ${point.hours})
                            ON CONFLICT (employee_id, project_id, week, year)
                            DO UPDATE SET hours = EXCLUDED.hours
                        `;
                    }
                });

                const updatedRows = await sql<WorkloadRow[]>`
                    SELECT
                        p.external_id AS project_id,
                        p.name AS project_name,
                        p.active AS project_active,
                        w.week,
                        w.hours,
                        w.year
                    FROM workloads w
                    INNER JOIN projects p ON w.project_id = p.id
                    WHERE w.employee_id = ${employeeId}
                      AND w.project_id = ${project.id}
                      AND w.year = ${parsedYear}
                    ORDER BY w.week
                `;

                const responsePoints: LanePoint[] = updatedRows.map((row) => ({
                    id: `${row.project_id}-${row.week}`,
                    week: row.week,
                    hours: row.hours,
                    year: row.year,
                    absoluteWeek: row.week,
                }));

                return Response.json({
                    projectId: project.external_id,
                    name: project.name,
                    active: project.active,
                    points: responsePoints,
                });
            },
        },
    },

    development: process.env.NODE_ENV !== "production" && {
        hmr: true,
        console: true,
    },
});

console.log(`🚀 Server running at ${server.url}`);
