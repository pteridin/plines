export type AuthUser = {
    id: string;
    name: string;
    username: string;
    canManageWorkload: boolean;
    isAdmin: boolean;
    workHours: number;
    active: boolean;
    position: string | null;
    tags: string[];
};

export class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

const jsonHeaders = {
    "Content-Type": "application/json",
} as const;

const parseResponse = async <T>(response: Response, context: string): Promise<T> => {
    if (!response.ok) {
        const message = await response.text();
        throw new ApiError(
            message || `${context} failed with status ${response.status}`,
            response.status
        );
    }
    if (response.status === 204) {
        return {} as T;
    }
    return (await response.json()) as T;
};

export const login = async (username: string, password: string): Promise<AuthUser> => {
    const response = await fetch("/api/login", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ username, password }),
    });

    return await parseResponse<AuthUser>(response, "Login");
};

export const logout = async (): Promise<void> => {
    const response = await fetch("/api/logout", {
        method: "POST",
        headers: jsonHeaders,
    });

    await parseResponse<{ success: boolean }>(response, "Logout");
};

export const fetchCurrentUser = async (): Promise<AuthUser> => {
    const response = await fetch("/api/me");
    return await parseResponse<AuthUser>(response, "Fetch current user");
};
