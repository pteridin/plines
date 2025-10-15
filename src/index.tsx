import { serve } from "bun";
import { sql } from "bun";
import index from "./index.html";
import { sql_init } from "./db/init";
import type { LanePoint } from "./components/elements/lane";

type ProjectStatus = "backlog" | "started" | "finished" | "canceled";

type ProjectRecord = {
    external_id: string;
    name: string;
    active: boolean;
    description: string | null;
    status: ProjectStatus | null;
};

type EmployeeRecord = {
    external_id: string;
    name: string;
    position: string | null;
    work_hours: number;
    active: boolean;
};

type WorkloadRow = {
    project_id: string;
    project_name: string;
    project_active: boolean;
    project_status: ProjectStatus | null;
    week: number;
    hours: number;
    year: number;
};

const projectStatusOptions: ProjectStatus[] = ["backlog", "started", "finished", "canceled"];

const isValidProjectStatus = (value: unknown): value is ProjectStatus =>
    typeof value === "string" && projectStatusOptions.includes(value as ProjectStatus);

const randomId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const projectRowToPayload = (project: ProjectRecord) => ({
    id: project.external_id,
    name: project.name,
    description: project.description ?? "",
    active: project.active,
    status: (project.status ?? "backlog") as ProjectStatus,
});

const employeeRowToPayload = (employee: EmployeeRecord) => ({
    id: employee.external_id,
    name: employee.name,
    position: employee.position ?? "",
    workHours: employee.work_hours,
    active: employee.active,
});

await sql_init();

const server = serve({
    routes: {
        "/*": index,

        "/api/projects": {
            async GET() {
                const projects = await sql<ProjectRecord[]>`
                    SELECT external_id, name, active, description, status
                    FROM projects
                    ORDER BY name
                `;

                return Response.json(projects.map((project) => projectRowToPayload(project)));
            },

            async POST(req) {
                let payload: unknown;
                try {
                    payload = await req.json();
                } catch (error) {
                    return new Response(`Invalid JSON payload: ${String(error)}`, { status: 400 });
                }

                if (typeof payload !== "object" || payload === null) {
                    return new Response("Payload must be an object.", { status: 400 });
                }

                const body = payload as {
                    id?: unknown;
                    name?: unknown;
                    description?: unknown;
                    active?: unknown;
                    status?: unknown;
                };

                const name = typeof body.name === "string" && body.name.trim().length > 0 ? body.name.trim() : null;
                if (!name) {
                    return new Response("Project name is required.", { status: 400 });
                }

                const description =
                    typeof body.description === "string" ? body.description.trim() : null;
                const active =
                    typeof body.active === "boolean" ? body.active : true;

                const statusCandidate = body.status;
                const status = isValidProjectStatus(statusCandidate) ? statusCandidate : "backlog";
                const providedId =
                    typeof body.id === "string" && body.id.trim().length > 0
                        ? body.id.trim()
                        : null;
                const externalId = providedId ?? randomId("project");

                try {
                    const inserted = await sql<ProjectRecord[]>`
                        INSERT INTO projects (external_id, name, description, active, status)
                        VALUES (${externalId}, ${name}, ${description}, ${active}, ${status})
                        RETURNING external_id, name, active, description, status
                    `;
                    return Response.json(projectRowToPayload(inserted[0]!));
                } catch (error) {
                    return new Response(`Failed to create project: ${String(error)}`, { status: 500 });
                }
            },
        },

        "/api/projects/:projectExternalId": {
            async PUT(req) {
                const { projectExternalId } = req.params;

                let payload: unknown;
                try {
                    payload = await req.json();
                } catch (error) {
                    return new Response(`Invalid JSON payload: ${String(error)}`, { status: 400 });
                }

                if (typeof payload !== "object" || payload === null) {
                    return new Response("Payload must be an object.", { status: 400 });
                }

                const body = payload as {
                    name?: unknown;
                    description?: unknown;
                    active?: unknown;
                    status?: unknown;
                };

                const updates: Partial<Record<"name" | "description" | "active" | "status", string | boolean>> = {};

                if (typeof body.name === "string") {
                    if (body.name.trim().length === 0) {
                        return new Response("Project name cannot be empty.", { status: 400 });
                    }
                    updates.name = body.name.trim();
                }

                if (typeof body.description === "string") {
                    updates.description = body.description.trim();
                }

                if (typeof body.active === "boolean") {
                    updates.active = body.active;
                }

                if (body.status !== undefined) {
                    if (!isValidProjectStatus(body.status)) {
                        return new Response("Invalid project status supplied.", { status: 400 });
                    }
                    updates.status = body.status;
                }

                if (Object.keys(updates).length === 0) {
                    return new Response("No valid updates supplied.", { status: 400 });
                }

                const existing = await sql<ProjectRecord[]>`
                    SELECT external_id, name, active, description, status
                    FROM projects
                    WHERE external_id = ${projectExternalId}
                    LIMIT 1
                `;

                if (existing.length === 0) {
                    return new Response("Project not found", { status: 404 });
                }

                await sql`
                    UPDATE projects
                    SET
                        name = COALESCE(${updates.name ?? null}, name),
                        description = COALESCE(${updates.description ?? null}, description),
                        active = COALESCE(${updates.active ?? null}, active),
                        status = COALESCE(${updates.status ?? null}, status)
                    WHERE external_id = ${projectExternalId}
                `;

                const refreshed = await sql<ProjectRecord[]>`
                    SELECT external_id, name, active, description, status
                    FROM projects
                    WHERE external_id = ${projectExternalId}
                    LIMIT 1
                `;

                return Response.json(projectRowToPayload(refreshed[0]!));
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
                        p.status AS project_status,
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
                    {
                        projectId: string;
                        name: string;
                        active: boolean;
                        status: ProjectStatus;
                        points: LanePoint[];
                    }
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
                        status: (row.project_status ?? "backlog") as ProjectStatus,
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

                const projectRows = await sql<{ id: number; external_id: string; name: string; active: boolean; status: ProjectStatus | null }[]>`
                    SELECT id, external_id, name, active, status
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
                        p.status AS project_status,
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
                    status: (project.status ?? "backlog") as ProjectStatus,
                    points: responsePoints,
                });
            },
        },

        "/api/employees": {
            async GET() {
                const employees = await sql<EmployeeRecord[]>`
                    SELECT external_id, name, position, work_hours, active
                    FROM employees
                    ORDER BY name
                `;

                return Response.json(employees.map((employee) => employeeRowToPayload(employee)));
            },

            async POST(req) {
                let payload: unknown;
                try {
                    payload = await req.json();
                } catch (error) {
                    return new Response(`Invalid JSON payload: ${String(error)}`, { status: 400 });
                }

                if (typeof payload !== "object" || payload === null) {
                    return new Response("Payload must be an object.", { status: 400 });
                }

                const body = payload as {
                    id?: unknown;
                    name?: unknown;
                    position?: unknown;
                    workHours?: unknown;
                    active?: unknown;
                };

                const name =
                    typeof body.name === "string" && body.name.trim().length > 0
                        ? body.name.trim()
                        : null;
                if (!name) {
                    return new Response("Employee name is required.", { status: 400 });
                }

                const position =
                    typeof body.position === "string" ? body.position.trim() : null;
                const workHoursCandidate =
                    typeof body.workHours === "number" ? body.workHours : Number(body.workHours);
                const workHours =
                    typeof workHoursCandidate === "number" && Number.isFinite(workHoursCandidate)
                        ? Math.max(1, Math.round(workHoursCandidate))
                        : 40;
                const active =
                    typeof body.active === "boolean" ? body.active : true;

                const providedId =
                    typeof body.id === "string" && body.id.trim().length > 0
                        ? body.id.trim()
                        : null;
                const externalId = providedId ?? randomId("employee");

                try {
                    const inserted = await sql<EmployeeRecord[]>`
                        INSERT INTO employees (external_id, name, position, work_hours, active)
                        VALUES (${externalId}, ${name}, ${position}, ${workHours}, ${active})
                        RETURNING external_id, name, position, work_hours, active
                    `;
                    return Response.json(employeeRowToPayload(inserted[0]!));
                } catch (error) {
                    return new Response(`Failed to create employee: ${String(error)}`, { status: 500 });
                }
            },
        },

        "/api/employees/:employeeExternalId": {
            async PUT(req) {
                const { employeeExternalId } = req.params;

                let payload: unknown;
                try {
                    payload = await req.json();
                } catch (error) {
                    return new Response(`Invalid JSON payload: ${String(error)}`, { status: 400 });
                }

                if (typeof payload !== "object" || payload === null) {
                    return new Response("Payload must be an object.", { status: 400 });
                }

                const body = payload as {
                    name?: unknown;
                    position?: unknown;
                    workHours?: unknown;
                    active?: unknown;
                };

                const existing = await sql<EmployeeRecord[]>`
                    SELECT external_id, name, position, work_hours, active
                    FROM employees
                    WHERE external_id = ${employeeExternalId}
                    LIMIT 1
                `;

                if (existing.length === 0) {
                    return new Response("Employee not found", { status: 404 });
                }

                const updates: {
                    name?: string;
                    work_hours?: number;
                    active?: boolean;
                } = {};

                if (typeof body.name === "string") {
                    if (body.name.trim().length === 0) {
                        return new Response("Employee name cannot be empty.", { status: 400 });
                    }
                    updates.name = body.name.trim();
                }

                let updatePosition = false;
                let nextPosition: string | null = existing[0]!.position;
                if (Object.prototype.hasOwnProperty.call(body, "position")) {
                    if (typeof body.position === "string") {
                        nextPosition = body.position.trim();
                        updatePosition = true;
                    } else if (body.position === null) {
                        nextPosition = null;
                        updatePosition = true;
                    } else {
                        return new Response("Position must be a string or null.", { status: 400 });
                    }
                }

                if (body.workHours !== undefined) {
                    const hoursCandidate =
                        typeof body.workHours === "number"
                            ? body.workHours
                            : Number(body.workHours);
                    if (!Number.isFinite(hoursCandidate) || hoursCandidate <= 0) {
                        return new Response("Work hours must be a positive number.", { status: 400 });
                    }
                    updates.work_hours = Math.round(hoursCandidate);
                }

                if (typeof body.active === "boolean") {
                    updates.active = body.active;
                }

                if (
                    Object.keys(updates).length === 0 &&
                    !updatePosition
                ) {
                    return new Response("No valid updates supplied.", { status: 400 });
                }

                await sql`
                    UPDATE employees
                    SET
                        name = COALESCE(${updates.name ?? null}, name),
                        position = CASE ${updatePosition} WHEN true THEN ${nextPosition} ELSE position END,
                        work_hours = COALESCE(${updates.work_hours ?? null}, work_hours),
                        active = COALESCE(${updates.active ?? null}, active)
                    WHERE external_id = ${employeeExternalId}
                `;

                const refreshed = await sql<EmployeeRecord[]>`
                    SELECT external_id, name, position, work_hours, active
                    FROM employees
                    WHERE external_id = ${employeeExternalId}
                    LIMIT 1
                `;

                return Response.json(employeeRowToPayload(refreshed[0]!));
            },
        },
    },

    development: process.env.NODE_ENV !== "production" && {
        hmr: true,
        console: true,
    },
});

console.log(`🚀 Server running at ${server.url}`);
