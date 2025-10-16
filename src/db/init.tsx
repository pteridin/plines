import { sql } from "bun";

type EmployeeSeed = {
    externalId: string;
    name: string;
    position: string;
    workHours: number;
    active: boolean;
    username: string;
    password: string;
    canManageWorkload?: boolean;
    isAdmin?: boolean;
    skills?: string[];
};

type ProjectSeed = {
    externalId: string;
    name: string;
    description: string;
    active: boolean;
    status: "backlog" | "started" | "finished" | "canceled";
};

type WorkloadSeed = {
    employeeExternalId: string;
    projectExternalId: string;
    year: number;
    week: number;
    hours: number;
};

const employeeSeeds: EmployeeSeed[] = [
    {
        externalId: "user-1",
        name: "Jordan Phillips",
        position: "Delivery Lead",
        workHours: 40,
        active: true,
        username: "jordan",
        password: "password123",
        canManageWorkload: true,
        skills: ["delivery", "leadership", "planning"],
    },
    {
        externalId: "user-2",
        name: "Alice Johnson",
        position: "Product Manager",
        workHours: 35,
        active: true,
        username: "alice",
        password: "password123",
        canManageWorkload: true,
        skills: ["product", "analysis", "stakeholder"],
    },
    {
        externalId: "user-3",
        name: "Bob Smith",
        position: "Designer",
        workHours: 30,
        active: true,
        username: "bob",
        password: "password123",
        skills: ["design", "ui", "ux"],
    },
];

const projectSeeds: ProjectSeed[] = [
    {
        externalId: "lane-atlas",
        name: "Atlas Onboarding",
        description: "Implementation and rollout of the Atlas platform.",
        active: true,
        status: "started",
    },
    {
        externalId: "lane-beacon",
        name: "Beacon Mobile",
        description: "Cross-platform mobile experience for Beacon.",
        active: true,
        status: "started",
    },
    {
        externalId: "lane-chroma",
        name: "Chroma Support",
        description: "Ongoing customer support and maintenance for Chroma.",
        active: true,
        status: "finished",
    },
    {
        externalId: "lane-legacy",
        name: "Legacy Maintenance",
        description: "Sustaining work for legacy systems.",
        active: false,
        status: "canceled",
    },
    {
        externalId: "lane-orion",
        name: "Orion Research",
        description: "Exploratory research for the Orion initiative.",
        active: true,
        status: "backlog",
    },
];

const workloadSeeds: WorkloadSeed[] = [
    // 2024 workload
    { employeeExternalId: "user-1", projectExternalId: "lane-atlas", year: 2024, week: 6, hours: 12 },
    { employeeExternalId: "user-1", projectExternalId: "lane-atlas", year: 2024, week: 18, hours: 20 },
    { employeeExternalId: "user-1", projectExternalId: "lane-atlas", year: 2024, week: 32, hours: 17 },
    { employeeExternalId: "user-1", projectExternalId: "lane-atlas", year: 2024, week: 46, hours: 9 },

    { employeeExternalId: "user-1", projectExternalId: "lane-beacon", year: 2024, week: 3, hours: 6 },
    { employeeExternalId: "user-1", projectExternalId: "lane-beacon", year: 2024, week: 15, hours: 9 },
    { employeeExternalId: "user-1", projectExternalId: "lane-beacon", year: 2024, week: 27, hours: 13 },
    { employeeExternalId: "user-1", projectExternalId: "lane-beacon", year: 2024, week: 40, hours: 11 },

    { employeeExternalId: "user-1", projectExternalId: "lane-chroma", year: 2024, week: 10, hours: 4 },
    { employeeExternalId: "user-1", projectExternalId: "lane-chroma", year: 2024, week: 24, hours: 5 },
    { employeeExternalId: "user-1", projectExternalId: "lane-chroma", year: 2024, week: 38, hours: 6 },

    { employeeExternalId: "user-1", projectExternalId: "lane-legacy", year: 2024, week: 5, hours: 3 },
    { employeeExternalId: "user-1", projectExternalId: "lane-legacy", year: 2024, week: 20, hours: 5.5 },
    { employeeExternalId: "user-1", projectExternalId: "lane-legacy", year: 2024, week: 44, hours: 2.5 },

    // 2025 workload
    { employeeExternalId: "user-1", projectExternalId: "lane-atlas", year: 2025, week: 8, hours: 10 },
    { employeeExternalId: "user-1", projectExternalId: "lane-atlas", year: 2025, week: 30, hours: 14.5 },
    { employeeExternalId: "user-1", projectExternalId: "lane-beacon", year: 2025, week: 12, hours: 4 },
    { employeeExternalId: "user-1", projectExternalId: "lane-beacon", year: 2025, week: 18, hours: 6 },
];

const dropTables = async (tx: typeof sql) => {
    await tx`DROP TABLE IF EXISTS sessions`;
    await tx`DROP TABLE IF EXISTS workload_suggestions`;
    await tx`DROP TABLE IF EXISTS workloads`;
    await tx`DROP TABLE IF EXISTS projects`;
    await tx`DROP TABLE IF EXISTS employees`;
};

const createSchema = async (tx: typeof sql) => {
    await tx`
        CREATE TABLE IF NOT EXISTS employees (
            id SERIAL PRIMARY KEY,
            external_id VARCHAR(100) NOT NULL UNIQUE,
            name VARCHAR(100) NOT NULL,
            position VARCHAR(100),
            work_hours INTEGER DEFAULT 40,
            active BOOLEAN DEFAULT TRUE,
            username VARCHAR(100) NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            can_manage_workload BOOLEAN DEFAULT FALSE,
            is_admin BOOLEAN DEFAULT FALSE,
            skills TEXT DEFAULT '[]'
        );
    `;

    await tx`
        CREATE TABLE IF NOT EXISTS projects (
            id SERIAL PRIMARY KEY,
            external_id VARCHAR(100) NOT NULL UNIQUE,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            active BOOLEAN DEFAULT TRUE,
            status VARCHAR(32) DEFAULT 'backlog'
        );
    `;

    await tx`
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
    `;

    await tx`
        CREATE TABLE IF NOT EXISTS workloads (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            week INTEGER NOT NULL,
            year INTEGER NOT NULL,
            hours FLOAT NOT NULL,
            UNIQUE(employee_id, project_id, week, year)
        );
    `;

    await tx`
        CREATE TABLE IF NOT EXISTS workload_suggestions (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            week INTEGER NOT NULL,
            year INTEGER NOT NULL,
            hours FLOAT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(employee_id, project_id, week, year)
        );
    `;
};

const seedEmployees = async (
    tx: typeof sql,
    hashedEmployeeSeeds: (EmployeeSeed & { passwordHash: string })[]
) => {
    for (const employee of hashedEmployeeSeeds) {
        await tx`
            INSERT INTO employees (
                external_id,
                name,
                position,
                work_hours,
                active,
                username,
                password_hash,
                can_manage_workload,
                is_admin,
                skills
            )
            VALUES (
                ${employee.externalId},
                ${employee.name},
                ${employee.position},
                ${employee.workHours},
                ${employee.active},
                ${employee.username},
                ${employee.passwordHash},
                ${employee.canManageWorkload ?? false},
                ${employee.isAdmin ?? false},
                ${JSON.stringify(employee.skills ?? [])}
            )
            ON CONFLICT (external_id) DO UPDATE SET
                name = EXCLUDED.name,
                position = EXCLUDED.position,
                work_hours = EXCLUDED.work_hours,
                active = EXCLUDED.active,
                username = EXCLUDED.username,
                can_manage_workload = EXCLUDED.can_manage_workload,
                is_admin = EXCLUDED.is_admin,
                skills = EXCLUDED.skills;
        `;
    }
};

const seedProjects = async (tx: typeof sql) => {
    for (const project of projectSeeds) {
        await tx`
            INSERT INTO projects (external_id, name, description, active, status)
            VALUES (${project.externalId}, ${project.name}, ${project.description}, ${project.active}, ${project.status})
            ON CONFLICT (external_id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                active = EXCLUDED.active,
                status = EXCLUDED.status;
        `;
    }
};

const seedWorkloads = async (tx: typeof sql) => {
    const employeeRows = await tx<{ id: number; external_id: string }[]>`
        SELECT id, external_id FROM employees
    `;
    const projectRows = await tx<{ id: number; external_id: string }[]>`
        SELECT id, external_id FROM projects
    `;

    const employeeIdByExternal = new Map(employeeRows.map((row) => [row.external_id, row.id]));
    const projectIdByExternal = new Map(projectRows.map((row) => [row.external_id, row.id]));

    for (const workload of workloadSeeds) {
        const employeeId = employeeIdByExternal.get(workload.employeeExternalId);
        const projectId = projectIdByExternal.get(workload.projectExternalId);
        if (!employeeId || !projectId) continue;

        await tx`
            INSERT INTO workloads (employee_id, project_id, week, year, hours)
            VALUES (${employeeId}, ${projectId}, ${workload.week}, ${workload.year}, ${workload.hours})
            ON CONFLICT (employee_id, project_id, week, year) DO UPDATE SET
                hours = EXCLUDED.hours;
        `;
    }
};

const schemaExists = async () => {
    const rows = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
            SELECT 1
            FROM pg_tables
            WHERE schemaname = 'public'
              AND tablename = 'employees'
        ) AS exists
    `;
    return rows[0]?.exists ?? false;
};

export async function sql_init() {
    const isProduction = process.env.NODE_ENV === "production";
    const hashedEmployeeSeeds = await Promise.all(
        employeeSeeds.map(async (seed) => ({
            ...seed,
            passwordHash: await Bun.password.hash(seed.password),
        }))
    );

    if (!isProduction) {
        console.log("Development environment detected. Resetting database schema...");
        await sql.begin(async (tx) => {
            await dropTables(tx);
            await createSchema(tx);
            await seedEmployees(tx, hashedEmployeeSeeds);
            await seedProjects(tx);
            await seedWorkloads(tx);
        });
        console.log("Database reset and seeded for development.");
        return { reset: true, seeded: true };
    }

    if (await schemaExists()) {
        console.log("Database schema already present. Skipping initialization.");
        return { reset: false, seeded: false };
    }

    console.log("Production environment first-run detected. Preparing database schema...");
    await sql.begin(async (tx) => {
        await createSchema(tx);
        await seedEmployees(tx, hashedEmployeeSeeds);
        await seedProjects(tx);
        await seedWorkloads(tx);
    });
    console.log("Database schema created and seeded.");
    return { reset: false, seeded: true };
}
