import type { LanePoint } from "../components/elements/lane";

export type ProjectWorkloadRecord = {
    projectId: string;
    name: string;
    active: boolean;
    points: LanePoint[];
};

type ApiProject = {
    id: string;
    name: string;
    active: boolean;
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
    points: ApiWorkloadPoint[];
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
): Promise<Array<{ id: string; name: string; active: boolean }>> => {
    void userId;
    const response = await fetch("/api/projects");
    const projects = await handleResponse<ApiProject[]>(response, "Fetching projects");

    return projects.map((project) => ({
        id: project.id,
        name: project.name,
        active: project.active,
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
        points: record.points.map(normalizePoint(record, year)),
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
        points: record.points.map(normalizePoint(record, year)),
    };
};
