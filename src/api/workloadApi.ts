import type { LanePoint } from "../components/elements/lane";

export type ProjectStatus = "backlog" | "started" | "finished" | "canceled";

export type ProjectWorkloadRecord = {
    projectId: string;
    name: string;
    active: boolean;
    status: ProjectStatus;
    points: LanePoint[];
    suggestions: LanePoint[];
};

type ApiProject = {
    id: string;
    name: string;
    active: boolean;
    description: string;
    status: ProjectStatus;
};

type ApiWorkloadPoint = {
    id?: string;
    week: number;
    hours: number;
    year?: number;
    absoluteWeek?: number;
};

type ApiWorkloadRecord = {
    projectId: string;
    name: string;
    active: boolean;
    status: ProjectStatus;
    points: ApiWorkloadPoint[];
    suggestions?: ApiWorkloadPoint[];
};

export type ProjectSummary = {
    id: string;
    name: string;
    active: boolean;
    description: string;
    status: ProjectStatus;
};

export type EmployeeSummary = {
    id: string;
    name: string;
    position: string;
    workHours: number;
    active: boolean;
    username: string;
    canManageWorkload: boolean;
    isAdmin: boolean;
    tags: string[];
};

export type EmployeeCapacitySummary = {
    id: string;
    name: string;
    position: string;
    workHours: number;
    active: boolean;
    tags: string[];
    points: LanePoint[];
    suggestions: LanePoint[];
};

const jsonHeaders = {
    "Content-Type": "application/json",
} as const;

const handleResponse = async <T>(response: Response, context: string): Promise<T> => {
    if (!response.ok) {
        throw new Error(`${context} failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
};

const normalizePoint =
    (record: ApiWorkloadRecord, year: number) =>
    (point: ApiWorkloadPoint): LanePoint => ({
        id: point.id ?? `${record.projectId}-${point.week}`,
        week: point.week,
        hours: point.hours,
        year: point.year ?? year,
        absoluteWeek: point.absoluteWeek ?? point.week,
    });

export const fetchProjects = async (
    userId: string
): Promise<ProjectSummary[]> => {
    void userId;
    const response = await fetch("/api/projects");
    const projects = await handleResponse<ApiProject[]>(response, "Fetching projects");

    return projects.map((project) => ({
        id: project.id,
        name: project.name,
        active: project.active,
        description: project.description,
        status: project.status,
    }));
};

export const fetchWorkload = async (
    userId: string,
    year: number
): Promise<ProjectWorkloadRecord[]> => {
    const response = await fetch(
        `/api/workloads/${encodeURIComponent(userId)}/${encodeURIComponent(String(year))}`
    );

    if (response.status === 404) {
        return [];
    }

    const records = await handleResponse<ApiWorkloadRecord[]>(response, "Fetching workload");

    return records.map((record) => ({
        projectId: record.projectId,
        name: record.name,
        active: record.active,
        status: record.status,
        points: record.points.map(normalizePoint(record, year)),
        suggestions: (record.suggestions ?? []).map(normalizePoint(record, year)),
    }));
};

export const updateWorkload = async (
    userId: string,
    projectId: string,
    year: number,
    points: LanePoint[]
): Promise<ProjectWorkloadRecord> => {
    const payload = {
        points: points.map((point) => ({
            week: point.week,
            hours: point.hours,
        })),
    };

    const response = await fetch(
        `/api/workloads/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}/${encodeURIComponent(String(year))}`,
        {
            method: "PUT",
            headers: jsonHeaders,
            body: JSON.stringify(payload),
        }
    );

    const record = await handleResponse<ApiWorkloadRecord>(response, "Updating workload");

    return {
        projectId: record.projectId,
        name: record.name,
        active: record.active,
        status: record.status,
        points: record.points.map(normalizePoint(record, year)),
        suggestions: (record.suggestions ?? []).map(normalizePoint(record, year)),
    };
};

export const updateWorkloadSuggestions = async (
    userId: string,
    projectId: string,
    year: number,
    points: LanePoint[]
): Promise<ProjectWorkloadRecord> => {
    const payload = {
        points: points.map((point) => ({
            week: point.week,
            hours: point.hours,
        })),
    };

    const response = await fetch(
        `/api/workloads/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}/${encodeURIComponent(String(year))}/suggestions`,
        {
            method: "PUT",
            headers: jsonHeaders,
            body: JSON.stringify(payload),
        }
    );

    const record = await handleResponse<ApiWorkloadRecord>(
        response,
        "Updating workload suggestions"
    );

    return {
        projectId: record.projectId,
        name: record.name,
        active: record.active,
        status: record.status,
        points: record.points.map(normalizePoint(record, year)),
        suggestions: (record.suggestions ?? []).map(normalizePoint(record, year)),
    };
};

export const deleteWorkloadProject = async (
    userId: string,
    projectId: string,
    year: number
): Promise<void> => {
    const response = await fetch(
        `/api/workloads/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}/${encodeURIComponent(String(year))}`,
        {
            method: "DELETE",
        }
    );

    if (!response.ok && response.status !== 204) {
        const message = await response.text();
        const detail = message.trim().length > 0 ? message : response.statusText;
        throw new Error(detail || "Removing project failed.");
    }
};

export const fetchEmployees = async (): Promise<EmployeeSummary[]> => {
    const response = await fetch("/api/employees");
    const employees = await handleResponse<EmployeeSummary[]>(response, "Fetching employees");

    return employees.map((employee) => ({
        ...employee,
        position: employee.position ?? "",
        tags: Array.isArray(employee.tags) ? employee.tags : [],
    }));
};

export type CreateEmployeeInput = {
    name: string;
    position?: string;
    workHours?: number;
    active?: boolean;
    username: string;
    password: string;
    canManageWorkload?: boolean;
    isAdmin?: boolean;
    tags?: string[];
};

export const createEmployee = async (input: CreateEmployeeInput): Promise<EmployeeSummary> => {
    const response = await fetch("/api/employees", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
            name: input.name,
            position: input.position ?? "",
            workHours: input.workHours ?? 40,
            active: input.active ?? true,
            username: input.username,
            password: input.password,
            canManageWorkload: input.canManageWorkload ?? false,
            isAdmin: input.isAdmin ?? false,
            tags: input.tags ?? [],
        }),
    });

    return await handleResponse<EmployeeSummary>(response, "Creating employee");
};

export type UpdateEmployeeInput = Partial<
    Pick<
        EmployeeSummary,
        "name" | "position" | "workHours" | "active" | "username" | "canManageWorkload" | "isAdmin"
    >
> & { password?: string; tags?: string[] };

export const updateEmployee = async (
    employeeId: string,
    updates: UpdateEmployeeInput
): Promise<EmployeeSummary> => {
    const response = await fetch(`/api/employees/${encodeURIComponent(employeeId)}`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({
            ...updates,
            tags: updates.tags,
        }),
    });

    return await handleResponse<EmployeeSummary>(response, "Updating employee");
};

export const fetchCapacitySummary = async (
    year: number
): Promise<EmployeeCapacitySummary[]> => {
    const response = await fetch(
        `/api/workloads/summary/${encodeURIComponent(String(year))}`
    );

    const payload = await handleResponse<{
        year: number;
        employees: EmployeeCapacitySummary[];
    }>(response, "Fetching workload summary");

    return payload.employees.map((entry) => ({
        ...entry,
        position: entry.position ?? "",
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        points: entry.points.map((point) => ({
            ...point,
            id: point.id,
            week: point.week,
            hours: point.hours,
            year: point.year ?? payload.year,
        })),
        suggestions: (entry.suggestions ?? []).map((point) => ({
            ...point,
            id: point.id,
            week: point.week,
            hours: point.hours,
            year: point.year ?? payload.year,
        })),
    }));
};

export const createProject = async (input: {
    name: string;
    description?: string;
    status?: ProjectStatus;
    active?: boolean;
}): Promise<ProjectSummary> => {
    const response = await fetch("/api/projects", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
            name: input.name,
            description: input.description ?? "",
            status: input.status ?? "backlog",
            active: input.active ?? true,
        }),
    });

    return await handleResponse<ProjectSummary>(response, "Creating project");
};

export const updateProject = async (
    projectId: string,
    updates: Partial<Pick<ProjectSummary, "name" | "description" | "status" | "active">>
): Promise<ProjectSummary> => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify(updates),
    });

    return await handleResponse<ProjectSummary>(response, "Updating project");
};
