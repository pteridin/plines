import type { LanePoint } from "../components/elements/lane";

type ProjectWorkloadRecord = {
    projectId: string;
    name: string;
    active: boolean;
    points: LanePoint[];
};

type MockDatabase = Record<string, Record<number, ProjectWorkloadRecord[]>>;

const clonePoints = (points: LanePoint[]): LanePoint[] =>
    points.map((point) => ({ ...point }));

const mockDb: MockDatabase = {
    "user-1": {
        2024: [
            {
                projectId: "lane-atlas",
                name: "Atlas Onboarding",
                active: true,
                points: [
                    { id: "lane-atlas-6", week: 6, hours: 12, year: 2024 },
                    { id: "lane-atlas-18", week: 18, hours: 20, year: 2024 },
                    { id: "lane-atlas-32", week: 32, hours: 17, year: 2024 },
                    { id: "lane-atlas-46", week: 46, hours: 9, year: 2024 },
                ],
            },
            {
                projectId: "lane-beacon",
                name: "Beacon Mobile",
                active: true,
                points: [
                    { id: "lane-beacon-3", week: 3, hours: 6, year: 2024 },
                    { id: "lane-beacon-15", week: 15, hours: 9, year: 2024 },
                    { id: "lane-beacon-27", week: 27, hours: 13, year: 2024 },
                    { id: "lane-beacon-40", week: 40, hours: 11, year: 2024 },
                ],
            },
            {
                projectId: "lane-chroma",
                name: "Chroma Support",
                active: true,
                points: [
                    { id: "lane-chroma-10", week: 10, hours: 4, year: 2024 },
                    { id: "lane-chroma-24", week: 24, hours: 5, year: 2024 },
                    { id: "lane-chroma-38", week: 38, hours: 6, year: 2024 },
                ],
            },
            {
                projectId: "lane-legacy",
                name: "Legacy Maintenance",
                active: false,
                points: [
                    { id: "lane-legacy-5", week: 5, hours: 3, year: 2024 },
                    { id: "lane-legacy-20", week: 20, hours: 5.5, year: 2024 },
                    { id: "lane-legacy-44", week: 44, hours: 2.5, year: 2024 },
                ],
            },
        ],
        2025: [
            {
                projectId: "lane-atlas",
                name: "Atlas Onboarding",
                active: true,
                points: [
                    { id: "lane-atlas-2025-8", week: 8, hours: 10, year: 2025 },
                    { id: "lane-atlas-2025-30", week: 30, hours: 14.5, year: 2025 },
                ],
            },
            {
                projectId: "lane-beacon",
                name: "Beacon Mobile",
                active: false,
                points: [
                    { id: "lane-beacon-2025-12", week: 12, hours: 4, year: 2025 },
                    { id: "lane-beacon-2025-18", week: 18, hours: 6, year: 2025 },
                ],
            },
        ],
        2026: [],
    },
};

const mockProjectsCatalog: Array<{ id: string; name: string; active: boolean }> = [
    { id: "lane-atlas", name: "Atlas Onboarding", active: true },
    { id: "lane-beacon", name: "Beacon Mobile", active: true },
    { id: "lane-chroma", name: "Chroma Support", active: true },
    { id: "lane-legacy", name: "Legacy Maintenance", active: false },
    { id: "lane-orion", name: "Orion Research", active: true },
];

const delay = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));

export const fetchWorkload = async (
    userId: string,
    year: number
): Promise<ProjectWorkloadRecord[]> => {
    await delay();
    const userData = mockDb[userId];
    if (!userData) {
        return [];
    }
    const yearData = userData[year] ?? [];
    return yearData.map((record) => ({
        projectId: record.projectId,
        name: record.name,
        active: record.active,
        points: clonePoints(record.points).map((point) => ({
            ...point,
            year: point.year ?? year,
        })),
    }));
};

export const updateWorkload = async (
    userId: string,
    projectId: string,
    year: number,
    points: LanePoint[]
): Promise<ProjectWorkloadRecord> => {
    await delay(120);
    const sortedPoints = clonePoints(points)
        .map((point) => ({
            ...point,
            year,
        }))
        .sort((a, b) => a.week - b.week);

    if (!mockDb[userId]) {
        mockDb[userId] = {};
    }

    if (!mockDb[userId][year]) {
        mockDb[userId][year] = [];
    }

    const yearEntries = mockDb[userId][year];
    const index = yearEntries.findIndex((entry) => entry.projectId === projectId);

    const projectMeta = mockProjectsCatalog.find((project) => project.id === projectId);
    const projectName = projectMeta?.name ?? projectId;
    const projectActive = projectMeta?.active ?? true;

    if (index === -1) {
        const newRecord: ProjectWorkloadRecord = {
            projectId,
            name: projectName,
            active: projectActive,
            points: sortedPoints,
        };
        yearEntries.push(newRecord);
        return {
            ...newRecord,
            points: clonePoints(newRecord.points),
        };
    }

    const current = yearEntries[index];
    if (!current) {
        const fallbackRecord: ProjectWorkloadRecord = {
            projectId,
            name: projectName,
            active: projectActive,
            points: sortedPoints,
        };
        yearEntries[index] = fallbackRecord;
        return {
            ...fallbackRecord,
            points: clonePoints(fallbackRecord.points),
        };
    }

    yearEntries[index] = {
        ...current,
        points: sortedPoints,
    };

    return {
        ...yearEntries[index]!,
        points: clonePoints(yearEntries[index]!.points),
    };
};

export const fetchProjects = async (
    userId: string
): Promise<Array<{ id: string; name: string; active: boolean }>> => {
    await delay(80);
    void userId;
    return mockProjectsCatalog.map((project) => ({ ...project }));
};

export type { ProjectWorkloadRecord };
