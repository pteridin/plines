import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { ApiError, fetchCurrentUser, login as loginApi, logout as logoutApi, type AuthUser } from "@/api/authApi";

type AuthContextValue = {
    user: AuthUser | null;
    isLoading: boolean;
    error: string | null;
    login: (username: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    refresh: () => Promise<AuthUser | null>;
    clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthProviderProps = {
    children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const clearError = useCallback(() => setError(null), []);

    const refresh = useCallback(async (): Promise<AuthUser | null> => {
        setIsLoading(true);
        try {
            const current = await fetchCurrentUser();
            setUser(current);
            setError(null);
            return current;
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                setUser(null);
                setError(null);
                return null;
            }
            setUser(null);
            setError(err instanceof Error ? err.message : "Failed to verify session.");
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const login = useCallback(
        async (username: string, password: string) => {
            setIsLoading(true);
            try {
                const authenticated = await loginApi(username.trim().toLowerCase(), password);
                setUser(authenticated);
                setError(null);
            } catch (err) {
                setUser(null);
                if (err instanceof ApiError && err.status === 401) {
                    setError("Invalid username or password.");
                } else {
                    setError(err instanceof Error ? err.message : "Login failed.");
                }
                throw err;
            } finally {
                setIsLoading(false);
            }
        },
        []
    );

    const logout = useCallback(async () => {
        setIsLoading(true);
        try {
            await logoutApi();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Logout failed.");
        } finally {
            setUser(null);
            setIsLoading(false);
        }
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({
            user,
            isLoading,
            error,
            login,
            logout,
            refresh,
            clearError,
        }),
        [user, isLoading, error, login, logout, refresh, clearError]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
