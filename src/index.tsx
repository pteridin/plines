import { serve } from "bun";
import { sql } from "bun";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
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
    username: string;
    can_manage_workload: boolean;
    is_admin: boolean;
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
    username: employee.username,
    canManageWorkload: employee.can_manage_workload,
    isAdmin: employee.is_admin,
});

const SECRET_KEY = process.env.SECRET_KEY;
if (!SECRET_KEY) {
    throw new Error("SECRET_KEY environment variable is required for session management.");
}

const SESSION_COOKIE_NAME = "session_token";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const IS_PRODUCTION = process.env.NODE_ENV === "production";

type AuthenticatedEmployee = {
    id: number;
    externalId: string;
    username: string;
    name: string;
    canManageWorkload: boolean;
    isAdmin: boolean;
    workHours: number;
    active: boolean;
    position: string | null;
};

type AuthSession = {
    token: string;
    user: AuthenticatedEmployee;
    expiresAt: number;
};

const signSessionToken = (token: string) =>
    createHmac("sha256", SECRET_KEY).update(token).digest("hex");

const verifySignature = (token: string, signature: string): boolean => {
    try {
        const expected = Buffer.from(signSessionToken(token), "hex");
        const provided = Buffer.from(signature, "hex");
        return expected.length === provided.length && timingSafeEqual(expected, provided);
    } catch {
        return false;
    }
};

const serializeSessionCookie = (token: string) => {
    const signedValue = `${token}.${signSessionToken(token)}`;
    const parts = [
        `${SESSION_COOKIE_NAME}=${signedValue}`,
        "Path=/",
        `Max-Age=${SESSION_TTL_SECONDS}`,
        "HttpOnly",
        "SameSite=Strict",
    ];
    if (IS_PRODUCTION) {
        parts.push("Secure");
    }
    return parts.join("; ");
};

const clearSessionCookie = () => {
    const parts = [`${SESSION_COOKIE_NAME}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Strict"];
    if (IS_PRODUCTION) {
        parts.push("Secure");
    }
    return parts.join("; ");
};

const parseCookies = (header: string | null): Record<string, string> => {
    if (!header) return {};
    return header.split(";").reduce<Record<string, string>>((acc, part) => {
        const [name, ...rest] = part.trim().split("=");
        if (!name) return acc;
        acc[name] = rest.join("=");
        return acc;
    }, {});
};

const extractSessionToken = (req: Request): string | null => {
    const cookies = parseCookies(req.headers.get("cookie"));
    const raw = cookies[SESSION_COOKIE_NAME];
    if (!raw) return null;
    const [token, signature] = raw.split(".");
    if (!token || !signature) return null;
    if (!verifySignature(token, signature)) return null;
    return token;
};

const getSessionFromRequest = async (req: Request): Promise<AuthSession | null> => {
    const token = extractSessionToken(req);
    if (!token) return null;

    const rows = await sql<{
        token: string;
        expires_at: number;
        employee_id: number;
        external_id: string;
        username: string;
        name: string;
        can_manage_workload: boolean;
        is_admin: boolean;
        work_hours: number;
        active: boolean;
        position: string | null;
    }[]>`
        SELECT
            s.token,
            s.expires_at,
            s.employee_id,
            e.external_id,
            e.username,
            e.name,
            e.can_manage_workload,
            e.is_admin,
            e.work_hours,
            e.active,
            e.position
        FROM sessions s
        INNER JOIN employees e ON s.employee_id = e.id
        WHERE s.token = ${token}
        LIMIT 1
    `;

    if (rows.length === 0) {
        return null;
    }

    const sessionRow = rows[0]!;
    const now = Math.floor(Date.now() / 1000);
    if (sessionRow.expires_at <= now) {
        await sql`DELETE FROM sessions WHERE token = ${token}`;
        return null;
    }

    return {
        token,
        expiresAt: sessionRow.expires_at,
        user: {
            id: sessionRow.employee_id,
            externalId: sessionRow.external_id,
            username: sessionRow.username,
            name: sessionRow.name,
            canManageWorkload: sessionRow.can_manage_workload,
            isAdmin: sessionRow.is_admin,
            workHours: sessionRow.work_hours,
            active: sessionRow.active,
            position: sessionRow.position,
        },
    };
};

const requireAuth = async (
    req: Request,
    options: { requireManager?: boolean; requireAdmin?: boolean } = {}
): Promise<AuthSession | Response> => {
    const session = await getSessionFromRequest(req);
    if (!session) {
        return new Response("Authentication required.", { status: 401 });
    }

    if (options.requireAdmin && !session.user.isAdmin) {
        return new Response("Administrator permission required.", { status: 403 });
    }

    if (options.requireManager && !(session.user.canManageWorkload || session.user.isAdmin)) {
        return new Response("Project manager permission required.", { status: 403 });
    }

    return session;
};

const deleteSessionByToken = async (token: string) => {
    await sql`DELETE FROM sessions WHERE token = ${token}`;
};

const ensureAdminUser = async () => {
    const adminUsername = process.env.ADMIN_USERNAME?.trim();
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminUsername || !adminPassword) {
        console.warn("ADMIN_USERNAME or ADMIN_PASSWORD is not set. Skipping admin bootstrap.");
        return;
    }

    const normalizedUsername = adminUsername.toLowerCase();

    const existing = await sql<{ id: number }[]>`
        SELECT id
        FROM employees
        WHERE username = ${normalizedUsername}
        LIMIT 1
    `;

    const passwordHash = await Bun.password.hash(adminPassword);

    if (existing.length > 0) {
        await sql`
            UPDATE employees
            SET
                password_hash = ${passwordHash},
                is_admin = TRUE,
                can_manage_workload = TRUE,
                active = TRUE
            WHERE id = ${existing[0]!.id}
        `;
        console.log(`Admin user '${normalizedUsername}' ensured.`);
        return;
    }

    const externalId = randomId("admin");
    await sql`
        INSERT INTO employees (
            external_id,
            name,
            position,
            work_hours,
            active,
            username,
            password_hash,
            can_manage_workload,
            is_admin
        )
        VALUES (
            ${externalId},
            'Admin User',
            'Administrator',
            40,
            TRUE,
            ${normalizedUsername},
            ${passwordHash},
            TRUE,
            TRUE
        )
    `;

    console.log(`Admin user '${normalizedUsername}' created with external id '${externalId}'.`);
};

await sql_init();
await ensureAdminUser();

const server = serve({
    routes: {
        "/*": index,

        "/api/login": {
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

                const body = payload as { username?: unknown; password?: unknown };
                const username =
                    typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
                const password = typeof body.password === "string" ? body.password : "";

                if (!username || password.length === 0) {
                    return new Response("Username and password are required.", { status: 400 });
                }

                const rows = await sql<{
                    id: number;
                    external_id: string;
                    username: string;
                    name: string;
                    password_hash: string;
                    can_manage_workload: boolean;
                    is_admin: boolean;
                    work_hours: number;
                    active: boolean;
                    position: string | null;
                }[]>`
                    SELECT id, external_id, username, name, password_hash, can_manage_workload, is_admin, work_hours, active, position
                    FROM employees
                    WHERE LOWER(username) = ${username}
                    LIMIT 1
                `;

                if (rows.length === 0) {
                    await Bun.sleep(150); // mitigate timing attacks
                    return new Response("Invalid credentials.", { status: 401 });
                }

                const employee = rows[0]!;
                const isValid = await Bun.password.verify(password, employee.password_hash);
                if (!isValid) {
                    await Bun.sleep(150);
                    return new Response("Invalid credentials.", { status: 401 });
                }

                const token = randomBytes(32).toString("hex");
                const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

                await sql.begin(async (tx) => {
                    await tx`DELETE FROM sessions WHERE employee_id = ${employee.id}`;
                    await tx`
                        INSERT INTO sessions (token, employee_id, expires_at)
                        VALUES (${token}, ${employee.id}, ${expiresAt})
                    `;
                });

                const responseHeaders = new Headers({
                    "Content-Type": "application/json",
                    "Set-Cookie": serializeSessionCookie(token),
                });

                const payloadBody = {
                    id: employee.external_id,
                    name: employee.name,
                    username: employee.username,
                    canManageWorkload: employee.can_manage_workload,
                    isAdmin: employee.is_admin,
                    workHours: employee.work_hours,
                    active: employee.active,
                    position: employee.position,
                };

                return new Response(JSON.stringify(payloadBody), {
                    status: 200,
                    headers: responseHeaders,
                });
            },
        },

        "/api/logout": {
            async POST(req) {
                const token = extractSessionToken(req);
                if (token) {
                    await deleteSessionByToken(token);
                }

                const headers = new Headers({
                    "Content-Type": "application/json",
                    "Set-Cookie": clearSessionCookie(),
                });

                return new Response(JSON.stringify({ success: true }), {
                    status: 200,
                    headers,
                });
            },
        },

        "/api/me": {
            async GET(req) {
                const session = await requireAuth(req);
                if (session instanceof Response) {
                    const headers = new Headers({
                        "Content-Type": "application/json",
                        "Set-Cookie": clearSessionCookie(),
                    });
                    return new Response(JSON.stringify({ error: "Unauthorized" }), {
                        status: session.status,
                        headers,
                    });
                }

                const headers = new Headers({ "Content-Type": "application/json" });
                return new Response(
                    JSON.stringify({
                        id: session.user.externalId,
                        name: session.user.name,
                        username: session.user.username,
                        canManageWorkload: session.user.canManageWorkload,
                        isAdmin: session.user.isAdmin,
                        workHours: session.user.workHours,
                        active: session.user.active,
                        position: session.user.position,
                    }),
                    { status: 200, headers }
                );
            },
        },

        "/api/projects": {
            async GET(req) {
                const session = await requireAuth(req, { requireManager: true });
                if (session instanceof Response) return session;

                const projects = await sql<ProjectRecord[]>`
                    SELECT external_id, name, active, description, status
                    FROM projects
                    ORDER BY name
                `;

                return Response.json(projects.map((project) => projectRowToPayload(project)));
            },

            async POST(req) {
                const session = await requireAuth(req, { requireManager: true });
                if (session instanceof Response) return session;

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
                const session = await requireAuth(req, { requireManager: true });
                if (session instanceof Response) return session;

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
                const session = await requireAuth(req);
                if (session instanceof Response) return session;
                if (
                    session.user.externalId !== employeeExternalId &&
                    !(session.user.canManageWorkload || session.user.isAdmin)
                ) {
                    return new Response("Forbidden.", { status: 403 });
                }

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
                const session = await requireAuth(req, { requireManager: true });
                if (session instanceof Response) return session;

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
            async GET(req) {
                const session = await requireAuth(req, { requireManager: true });
                if (session instanceof Response) return session;

                const employees = await sql<EmployeeRecord[]>`
                    SELECT external_id, name, position, work_hours, active, username, can_manage_workload, is_admin
                    FROM employees
                    ORDER BY name
                `;

                return Response.json(employees.map((employee) => employeeRowToPayload(employee)));
            },

            async POST(req) {
                const session = await requireAuth(req, { requireManager: true });
                if (session instanceof Response) return session;

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
                    username?: unknown;
                    password?: unknown;
                    canManageWorkload?: unknown;
                    isAdmin?: unknown;
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
                const usernameCandidate =
                    typeof body.username === "string" ? body.username.trim().toLowerCase() : "";

                if (usernameCandidate.length === 0) {
                    return new Response("Username is required.", { status: 400 });
                }

                const password =
                    typeof body.password === "string" ? body.password : "";
                if (password.length < 6) {
                    return new Response("Password must be at least 6 characters.", { status: 400 });
                }

                const requestedManager =
                    typeof body.canManageWorkload === "boolean" ? body.canManageWorkload : false;
                const canManageWorkload = session.user.isAdmin ? requestedManager : false;

                const requestedAdmin =
                    typeof body.isAdmin === "boolean" ? body.isAdmin : false;
                const isAdmin = session.user.isAdmin ? requestedAdmin : false;

                const providedId =
                    typeof body.id === "string" && body.id.trim().length > 0
                        ? body.id.trim()
                        : null;
                const externalId = providedId ?? randomId("employee");

                try {
                    const passwordHash = await Bun.password.hash(password);

                    const inserted = await sql<EmployeeRecord[]>`
                        INSERT INTO employees (
                            external_id,
                            name,
                            position,
                            work_hours,
                            active,
                            username,
                            password_hash,
                            can_manage_workload,
                            is_admin
                        )
                        VALUES (
                            ${externalId},
                            ${name},
                            ${position},
                            ${workHours},
                            ${active},
                            ${usernameCandidate},
                            ${passwordHash},
                            ${canManageWorkload},
                            ${isAdmin}
                        )
                        RETURNING external_id, name, position, work_hours, active, username, can_manage_workload, is_admin
                    `;
                    return Response.json(employeeRowToPayload(inserted[0]!));
                } catch (error) {
                    if (
                        error instanceof Error &&
                        error.message.toLowerCase().includes("unique")
                    ) {
                        return new Response("Username already exists.", { status: 409 });
                    }
                    return new Response(`Failed to create employee: ${String(error)}`, { status: 500 });
                }
            },
        },

        "/api/employees/:employeeExternalId": {
            async PUT(req) {
                const { employeeExternalId } = req.params;
                const session = await requireAuth(req, { requireManager: true });
                if (session instanceof Response) return session;

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
                    username?: unknown;
                    password?: unknown;
                    canManageWorkload?: unknown;
                    isAdmin?: unknown;
                };

                const existing = await sql<EmployeeRecord[]>`
                    SELECT external_id, name, position, work_hours, active, username, can_manage_workload, is_admin
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
                    username?: string;
                    can_manage_workload?: boolean;
                    is_admin?: boolean;
                    password_hash?: string;
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

                if (Object.prototype.hasOwnProperty.call(body, "username")) {
                    if (!session.user.isAdmin) {
                        return new Response("Only administrators can update usernames.", { status: 403 });
                    }
                    if (typeof body.username !== "string" || body.username.trim().length === 0) {
                        return new Response("Username must be a non-empty string.", { status: 400 });
                    }
                    updates.username = body.username.trim().toLowerCase();
                }

                if (Object.prototype.hasOwnProperty.call(body, "canManageWorkload")) {
                    if (!session.user.isAdmin) {
                        return new Response("Only administrators can update project manager status.", {
                            status: 403,
                        });
                    }
                    if (typeof body.canManageWorkload !== "boolean") {
                        return new Response("canManageWorkload must be a boolean.", { status: 400 });
                    }
                    updates.can_manage_workload = body.canManageWorkload;
                }

                if (Object.prototype.hasOwnProperty.call(body, "isAdmin")) {
                    if (!session.user.isAdmin) {
                        return new Response("Only administrators can update admin status.", {
                            status: 403,
                        });
                    }
                    if (typeof body.isAdmin !== "boolean") {
                        return new Response("isAdmin must be a boolean.", { status: 400 });
                    }
                    updates.is_admin = body.isAdmin;
                }

                if (Object.prototype.hasOwnProperty.call(body, "password")) {
                    if (!session.user.isAdmin) {
                        return new Response("Only administrators can reset passwords.", { status: 403 });
                    }
                    if (typeof body.password !== "string" || body.password.length < 6) {
                        return new Response("Password must be at least 6 characters.", { status: 400 });
                    }
                    updates.password_hash = await Bun.password.hash(body.password);
                }

                if (
                    Object.keys(updates).length === 0 &&
                    !updatePosition
                ) {
                    return new Response("No valid updates supplied.", { status: 400 });
                }

                try {
                    await sql`
                        UPDATE employees
                        SET
                            name = COALESCE(${updates.name ?? null}, name),
                            position = CASE ${updatePosition} WHEN true THEN ${nextPosition} ELSE position END,
                            work_hours = COALESCE(${updates.work_hours ?? null}, work_hours),
                            active = COALESCE(${updates.active ?? null}, active),
                            username = COALESCE(${updates.username ?? null}, username),
                            can_manage_workload = COALESCE(${updates.can_manage_workload ?? null}, can_manage_workload),
                            is_admin = COALESCE(${updates.is_admin ?? null}, is_admin),
                            password_hash = COALESCE(${updates.password_hash ?? null}, password_hash)
                        WHERE external_id = ${employeeExternalId}
                    `;
                } catch (error) {
                    if (
                        error instanceof Error &&
                        error.message.toLowerCase().includes("unique")
                    ) {
                        return new Response("Username already exists.", { status: 409 });
                    }
                    return new Response(`Failed to update employee: ${String(error)}`, { status: 500 });
                }

                const refreshed = await sql<EmployeeRecord[]>`
                    SELECT external_id, name, position, work_hours, active, username, can_manage_workload, is_admin
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
