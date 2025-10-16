import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ChevronDown, ClipboardList, LineChart, LogOut, UserCog, Users } from "lucide-react";
import "./index.css";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkloadView } from "@/components/workload-view";
import { useAuth } from "@/context/AuthContext";
import { EmployeeManagementView } from "@/components/employee-management-view";
import { ProjectManagementView } from "@/components/project-management-view";
import { CapacityOverviewView } from "@/components/capacity-overview-view";

type ActiveView = "workload" | "capacity" | "employees" | "projects";

export function App() {
    const { user, isLoading, error, login, logout, clearError } = useAuth();
    const [activeView, setActiveView] = useState<ActiveView>("workload");
    const [workloadRefreshToken, setWorkloadRefreshToken] = useState(0);
    const [loginUsername, setLoginUsername] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [loginError, setLoginError] = useState<string | null>(null);
    const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);

    const canManage = Boolean(user?.canManageWorkload || user?.isAdmin);

    useEffect(() => {
        if (error) {
            setLoginError(error);
        }
    }, [error]);

    useEffect(() => {
        if (!user) {
            setActiveView("workload");
        }
    }, [user]);

    useEffect(() => {
        if (!canManage && activeView !== "workload") {
            setActiveView("workload");
        }
    }, [canManage, activeView]);

    const handleDataChange = useCallback(() => {
        setWorkloadRefreshToken((prev) => prev + 1);
    }, []);

    const handleLoginSubmit = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (isSubmittingLogin) return;
            clearError();
            setLoginError(null);

            const trimmedUsername = loginUsername.trim();
            if (trimmedUsername.length === 0) {
                setLoginError("Enter your username.");
                return;
            }

            if (loginPassword.length === 0) {
                setLoginError("Enter your password.");
                return;
            }

            setIsSubmittingLogin(true);
            try {
                await login(trimmedUsername, loginPassword);
                setLoginUsername("");
                setLoginPassword("");
            } catch (err) {
                setLoginError(err instanceof Error ? err.message : "Login failed.");
            } finally {
                setIsSubmittingLogin(false);
            }
        },
        [clearError, isSubmittingLogin, login, loginPassword, loginUsername]
    );

    const handleLogout = useCallback(async () => {
        await logout();
        setWorkloadRefreshToken((prev) => prev + 1);
    }, [logout]);

    const viewLabel = useMemo(() => {
        switch (activeView) {
            case "workload":
                return "Workload assessment";
            case "capacity":
                return "Capacity overview";
            case "employees":
                return "Employee management";
            case "projects":
                return "Project management";
            default:
                return "Workload assessment";
        }
    }, [activeView]);

    if (isLoading && !user) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
                <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-6 py-4 text-sm text-slate-200">
                    Checking your session…
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
                <form
                    onSubmit={handleLoginSubmit}
                    className="w-full max-w-sm space-y-5 rounded-xl border border-slate-800/80 bg-slate-900/80 p-6 shadow-lg"
                >
                    <div className="space-y-1 text-center">
                        <h1 className="text-xl font-semibold text-white">Pipeline Planner</h1>
                        <p className="text-sm text-slate-400">Sign in to view your workload.</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="login-username" className="text-slate-200">
                            Username
                        </Label>
                        <Input
                            id="login-username"
                            autoComplete="username"
                            value={loginUsername}
                            onChange={(event) => {
                                setLoginUsername(event.target.value);
                                if (loginError) setLoginError(null);
                            }}
                            className="border-slate-700/70 bg-slate-950/70 text-slate-100"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="login-password" className="text-slate-200">
                            Password
                        </Label>
                        <Input
                            id="login-password"
                            type="password"
                            autoComplete="current-password"
                            value={loginPassword}
                            onChange={(event) => {
                                setLoginPassword(event.target.value);
                                if (loginError) setLoginError(null);
                            }}
                            className="border-slate-700/70 bg-slate-950/70 text-slate-100"
                        />
                    </div>
                    {loginError && (
                        <div className="rounded border border-red-600/60 bg-red-900/30 px-3 py-2 text-sm text-red-200">
                            {loginError}
                        </div>
                    )}
                    <Button type="submit" className="w-full" disabled={isSubmittingLogin}>
                        {isSubmittingLogin ? "Signing in…" : "Sign in"}
                    </Button>
                    <p className="text-center text-xs text-slate-400">
                        Use the credentials provided by your administrator.
                    </p>
                </form>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
            <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                    <h1 className="text-2xl font-semibold text-white">Pipeline Planner</h1>
                    <p className="text-sm text-slate-300">
                        Understand capacity and manage your delivery backlog in one place.
                    </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    {canManage ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    className="inline-flex items-center gap-2 border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                                >
                                    {viewLabel}
                                    <ChevronDown className="size-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[14rem]">
                                <DropdownMenuLabel>Navigate to</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    className={cn(
                                        "flex items-center gap-2",
                                        activeView === "workload" && "bg-slate-800/70 text-white"
                                    )}
                                    onSelect={() => setActiveView("workload")}
                                >
                                    <ClipboardList className="size-4" />
                                    Workload assessment
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className={cn(
                                        "flex items-center gap-2",
                                        activeView === "capacity" && "bg-slate-800/70 text-white"
                                    )}
                                    onSelect={() => setActiveView("capacity")}
                                >
                                    <LineChart className="size-4" />
                                    Capacity overview
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className={cn(
                                        "flex items-center gap-2",
                                        activeView === "employees" && "bg-slate-800/70 text-white"
                                    )}
                                    onSelect={() => setActiveView("employees")}
                                >
                                    <Users className="size-4" />
                                    Employee management
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className={cn(
                                        "flex items-center gap-2",
                                        activeView === "projects" && "bg-slate-800/70 text-white"
                                    )}
                                    onSelect={() => setActiveView("projects")}
                                >
                                    <UserCog className="size-4" />
                                    Project management
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : (
                        <div className="rounded-lg border border-slate-700/70 bg-slate-900/60 px-4 py-2 text-sm text-slate-200">
                            Viewing workload
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <div className="text-right text-xs text-slate-300 sm:text-sm">
                            <div className="font-semibold text-white">{user.name}</div>
                            <div className="flex flex-wrap justify-end gap-1 text-[11px] uppercase tracking-wide text-slate-400">
                                <span>@{user.username}</span>
                                <span>·</span>
                                <span>{user.active ? "Active" : "Inactive"}</span>
                                {user.canManageWorkload && <span>· Project manager</span>}
                                {user.isAdmin && <span>· Admin</span>}
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleLogout()}
                            disabled={isLoading}
                            className="inline-flex items-center gap-2 border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                        >
                            <LogOut className="size-4" />
                            Log out
                        </Button>
                    </div>
                </div>
            </header>

            <main>
                {!canManage || activeView === "workload" ? (
                    <WorkloadView
                        refreshSignal={workloadRefreshToken}
                        currentUser={user}
                        isManager={canManage}
                    />
                ) : activeView === "capacity" ? (
                    <CapacityOverviewView
                        currentUser={user}
                        refreshSignal={workloadRefreshToken}
                    />
                ) : activeView === "employees" ? (
                    <EmployeeManagementView
                        currentUser={user}
                        onEmployeesChanged={handleDataChange}
                    />
                ) : activeView === "projects" ? (
                    <ProjectManagementView onProjectsChanged={handleDataChange} />
                ) : null}
            </main>
        </div>
    );
}

export default App;
