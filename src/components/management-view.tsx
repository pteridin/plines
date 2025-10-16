import { useCallback, useEffect, useState } from "react";
import {
    fetchEmployees,
    fetchProjects,
    createEmployee,
    updateEmployee,
    createProject,
    updateProject,
    type EmployeeSummary,
    type ProjectStatus,
    type ProjectSummary,
} from "@/api/workloadApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ProjectStatusBadge } from "./project-status-badge";
import type { AuthUser } from "@/api/authApi";

type ActiveDraft = Record<string, string>;

const projectStatuses: Array<{ value: ProjectStatus; label: string }> = [
    { value: "backlog", label: "Backlog" },
    { value: "started", label: "Started" },
    { value: "finished", label: "Finished" },
    { value: "canceled", label: "Canceled" },
];

const makeHoursDraft = (employees: EmployeeSummary[]): ActiveDraft =>
    employees.reduce<ActiveDraft>((acc, employee) => {
        acc[employee.id] = employee.workHours?.toString() ?? "40";
        return acc;
    }, {});

type ManagementViewProps = {
    onDataChange?: () => void;
    currentUser: AuthUser;
};

function ManagementView({ onDataChange, currentUser }: ManagementViewProps) {
    const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
    const [employeeHoursDraft, setEmployeeHoursDraft] = useState<ActiveDraft>({});
    const [employeesLoading, setEmployeesLoading] = useState(false);
    const [employeesError, setEmployeesError] = useState<string | null>(null);
    const [pendingEmployeeIds, setPendingEmployeeIds] = useState<Set<string>>(new Set());

    const [projects, setProjects] = useState<ProjectSummary[]>([]);
    const [projectsLoading, setProjectsLoading] = useState(false);
    const [projectsError, setProjectsError] = useState<string | null>(null);
    const [pendingProjectIds, setPendingProjectIds] = useState<Set<string>>(new Set());

    const [createEmployeeName, setCreateEmployeeName] = useState("");
    const [createEmployeePosition, setCreateEmployeePosition] = useState("");
    const [createEmployeeHours, setCreateEmployeeHours] = useState("40");
    const [createEmployeeUsername, setCreateEmployeeUsername] = useState("");
    const [createEmployeePassword, setCreateEmployeePassword] = useState("");
    const [createEmployeeManager, setCreateEmployeeManager] = useState(false);
    const [createEmployeeAdmin, setCreateEmployeeAdmin] = useState(false);
    const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);
    const [createEmployeeError, setCreateEmployeeError] = useState<string | null>(null);
    const [employeesNotice, setEmployeesNotice] = useState<string | null>(null);

    const [createProjectName, setCreateProjectName] = useState("");
    const [createProjectDescription, setCreateProjectDescription] = useState("");
    const [createProjectStatus, setCreateProjectStatus] = useState<ProjectStatus>("backlog");
    const [isCreatingProject, setIsCreatingProject] = useState(false);
    const [createProjectError, setCreateProjectError] = useState<string | null>(null);

    const loadEmployees = useCallback(async () => {
        setEmployeesLoading(true);
        setEmployeesError(null);
        setEmployeesNotice(null);
        try {
            const data = await fetchEmployees();
            setEmployees(data);
            setEmployeeHoursDraft(makeHoursDraft(data));
        } catch {
            setEmployeesError("Unable to load employees. Please refresh.");
        } finally {
            setEmployeesLoading(false);
        }
    }, []);

    const loadProjects = useCallback(async () => {
        setProjectsLoading(true);
        setProjectsError(null);
        try {
            const data = await fetchProjects("");
            setProjects(data);
        } catch {
            setProjectsError("Unable to load projects. Please refresh.");
        } finally {
            setProjectsLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadEmployees();
        void loadProjects();
    }, [loadEmployees, loadProjects]);

    const handleCreateEmployee = useCallback(
        async (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (isCreatingEmployee) return;
            setCreateEmployeeError(null);
            setEmployeesNotice(null);

            const trimmedName = createEmployeeName.trim();
            if (trimmedName.length === 0) {
                setCreateEmployeeError("Employee name is required.");
                return;
            }

            const trimmedUsername = createEmployeeUsername.trim();
            if (trimmedUsername.length === 0) {
                setCreateEmployeeError("Username is required.");
                return;
            }

            if (createEmployeePassword.length < 6) {
                setCreateEmployeeError("Password must be at least 6 characters.");
                return;
            }

            const hoursNumber = Number(createEmployeeHours);
            if (!Number.isFinite(hoursNumber) || hoursNumber <= 0) {
                setCreateEmployeeError("Weekly hours must be a positive number.");
                return;
            }

            setIsCreatingEmployee(true);
            try {
                await createEmployee({
                    name: trimmedName,
                    position: createEmployeePosition.trim(),
                    workHours: Math.round(hoursNumber),
                    username: trimmedUsername.toLowerCase(),
                    password: createEmployeePassword,
                    canManageWorkload: currentUser.isAdmin ? createEmployeeManager : false,
                    isAdmin: currentUser.isAdmin ? createEmployeeAdmin : false,
                });
                setCreateEmployeeName("");
                setCreateEmployeePosition("");
                setCreateEmployeeHours("40");
                setCreateEmployeeUsername("");
                setCreateEmployeePassword("");
                setCreateEmployeeManager(false);
                setCreateEmployeeAdmin(false);
                await loadEmployees();
                onDataChange?.();
                setEmployeesNotice(`${trimmedName} has been added.`);
            } catch {
                setCreateEmployeeError("Could not create employee. Please try again.");
            } finally {
                setIsCreatingEmployee(false);
            }
        },
        [
            createEmployeeHours,
            createEmployeeName,
            createEmployeePosition,
            createEmployeePassword,
            createEmployeeUsername,
            createEmployeeManager,
            createEmployeeAdmin,
            currentUser.isAdmin,
            isCreatingEmployee,
            loadEmployees,
            onDataChange,
        ]
    );

    const mutateEmployeePending = useCallback((id: string, enable: boolean) => {
        setPendingEmployeeIds((prev) => {
            const next = new Set(prev);
            if (enable) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    const handleSaveEmployeeHours = useCallback(
        async (employee: EmployeeSummary) => {
            const draft = employeeHoursDraft[employee.id];
            const parsed = Number(draft);
            if (!Number.isFinite(parsed) || parsed <= 0) {
                setEmployeesError("Enter a positive number of hours before saving.");
                return;
            }

            setEmployeesNotice(null);
            mutateEmployeePending(employee.id, true);
            try {
                const updated = await updateEmployee(employee.id, {
                    workHours: Math.round(parsed),
                });
                setEmployees((prev) =>
                    prev.map((entry) => (entry.id === employee.id ? updated : entry))
                );
                setEmployeeHoursDraft((prev) => ({
                    ...prev,
                    [employee.id]: updated.workHours.toString(),
                }));
                onDataChange?.();
                setEmployeesNotice(`${updated.name}'s capacity updated.`);
            } catch {
                setEmployeesError("Failed to update employee hours. Please retry.");
            } finally {
                mutateEmployeePending(employee.id, false);
            }
        },
        [employeeHoursDraft, mutateEmployeePending, onDataChange]
    );

    const handleToggleEmployeeActive = useCallback(
        async (employee: EmployeeSummary) => {
            setEmployeesNotice(null);
            mutateEmployeePending(employee.id, true);
            try {
                const updated = await updateEmployee(employee.id, {
                    active: !employee.active,
                });
                setEmployees((prev) =>
                    prev.map((entry) => (entry.id === employee.id ? updated : entry))
                );
                onDataChange?.();
                setEmployeesNotice(
                    `${updated.name} is now ${updated.active ? "active" : "inactive"}.`
                );
            } catch {
                setEmployeesError("Failed to update employee state. Please retry.");
            } finally {
                mutateEmployeePending(employee.id, false);
            }
        },
        [mutateEmployeePending, onDataChange]
    );

    const handleToggleManagerFlag = useCallback(
        async (employee: EmployeeSummary) => {
            if (!currentUser.isAdmin) return;
            setEmployeesError(null);
            setEmployeesNotice(null);
            mutateEmployeePending(employee.id, true);
            try {
                const updated = await updateEmployee(employee.id, {
                    canManageWorkload: !employee.canManageWorkload,
                });
                setEmployees((prev) =>
                    prev.map((entry) => (entry.id === employee.id ? updated : entry))
                );
                setEmployeesNotice(
                    `${updated.name} ${
                        updated.canManageWorkload ? "granted project manager access." : "project manager access revoked."
                    }`
                );
                onDataChange?.();
            } catch {
                setEmployeesError("Failed to update project manager access. Please retry.");
            } finally {
                mutateEmployeePending(employee.id, false);
            }
        },
        [currentUser.isAdmin, mutateEmployeePending, onDataChange]
    );

    const handleToggleAdminFlag = useCallback(
        async (employee: EmployeeSummary) => {
            if (!currentUser.isAdmin) return;
            setEmployeesError(null);
            setEmployeesNotice(null);
            mutateEmployeePending(employee.id, true);
            try {
                const updated = await updateEmployee(employee.id, {
                    isAdmin: !employee.isAdmin,
                });
                setEmployees((prev) =>
                    prev.map((entry) => (entry.id === employee.id ? updated : entry))
                );
                setEmployeesNotice(
                    `${updated.name} ${updated.isAdmin ? "promoted to admin." : "admin access removed."}`
                );
                onDataChange?.();
            } catch {
                setEmployeesError("Failed to update admin access. Please retry.");
            } finally {
                mutateEmployeePending(employee.id, false);
            }
        },
        [currentUser.isAdmin, mutateEmployeePending, onDataChange]
    );

    const handleResetEmployeePassword = useCallback(
        async (employee: EmployeeSummary) => {
            if (!currentUser.isAdmin) return;
            const nextPassword = window.prompt(
                `Enter a new password for ${employee.name}`,
                ""
            );
            if (nextPassword === null) return;
            const trimmed = nextPassword.trim();
            if (trimmed.length < 6) {
                setEmployeesError("Password must be at least 6 characters.");
                return;
            }

            setEmployeesError(null);
            setEmployeesNotice(null);
            mutateEmployeePending(employee.id, true);
            try {
                await updateEmployee(employee.id, { password: trimmed });
                setEmployeesNotice(`Password updated for ${employee.name}.`);
            } catch {
                setEmployeesError("Failed to reset password. Please retry.");
            } finally {
                mutateEmployeePending(employee.id, false);
            }
        },
        [currentUser.isAdmin, mutateEmployeePending]
    );

    const mutateProjectPending = useCallback((id: string, enable: boolean) => {
        setPendingProjectIds((prev) => {
            const next = new Set(prev);
            if (enable) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    const handleCreateProject = useCallback(
        async (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (isCreatingProject) return;
            setCreateProjectError(null);

            const trimmedName = createProjectName.trim();
            if (trimmedName.length === 0) {
                setCreateProjectError("Project name is required.");
                return;
            }

            setIsCreatingProject(true);
            try {
                await createProject({
                    name: trimmedName,
                    description: createProjectDescription.trim(),
                    status: createProjectStatus,
                });
                setCreateProjectName("");
                setCreateProjectDescription("");
                setCreateProjectStatus("backlog");
                await loadProjects();
                onDataChange?.();
            } catch {
                setCreateProjectError("Could not create project. Please try again.");
            } finally {
                setIsCreatingProject(false);
            }
        },
        [
            createProjectDescription,
            createProjectName,
            createProjectStatus,
            isCreatingProject,
            loadProjects,
            onDataChange,
        ]
    );

    const handleUpdateProjectStatus = useCallback(
        async (project: ProjectSummary, status: ProjectStatus) => {
            mutateProjectPending(project.id, true);
            try {
                const updated = await updateProject(project.id, { status });
                setProjects((prev) =>
                    prev.map((entry) => (entry.id === project.id ? updated : entry))
                );
                onDataChange?.();
            } catch {
                setProjectsError("Failed to update project status.");
            } finally {
                mutateProjectPending(project.id, false);
            }
        },
        [mutateProjectPending, onDataChange]
    );

    const handleToggleProjectActive = useCallback(
        async (project: ProjectSummary) => {
            mutateProjectPending(project.id, true);
            try {
                const updated = await updateProject(project.id, { active: !project.active });
                setProjects((prev) =>
                    prev.map((entry) => (entry.id === project.id ? updated : entry))
                );
                onDataChange?.();
            } catch {
                setProjectsError("Failed to update project state.");
            } finally {
                mutateProjectPending(project.id, false);
            }
        },
        [mutateProjectPending, onDataChange]
    );

    return (
        <div className="space-y-8">
            <section className="space-y-4 rounded-xl border border-slate-700/60 bg-slate-900/50 p-5 shadow-md">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-white">Employees</h2>
                        <p className="text-sm text-slate-300">
                            Add new employees, adjust capacity, and toggle availability.
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void loadEmployees()}
                        disabled={employeesLoading}
                        className="border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                    >
                        {employeesLoading ? "Refreshing…" : "Refresh"}
                    </Button>
                </div>

                <form
                    onSubmit={handleCreateEmployee}
                    className="grid gap-3 rounded-lg border border-slate-700/60 bg-slate-900/50 p-4 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_0.6fr_0.8fr_auto]"
                >
                    <Input
                        value={createEmployeeName}
                        onChange={(event) => setCreateEmployeeName(event.target.value)}
                        placeholder="Name"
                        className="bg-slate-900/60"
                    />
                    <Input
                        value={createEmployeePosition}
                        onChange={(event) => setCreateEmployeePosition(event.target.value)}
                        placeholder="Role / Position"
                        className="bg-slate-900/60"
                    />
                    <Input
                        type="number"
                        min={1}
                        value={createEmployeeHours}
                        onChange={(event) => setCreateEmployeeHours(event.target.value)}
                        placeholder="Hours"
                        className="bg-slate-900/60"
                    />
                    <Input
                        value={createEmployeeUsername}
                        onChange={(event) => setCreateEmployeeUsername(event.target.value)}
                        placeholder="Username"
                        className="bg-slate-900/60"
                    />
                    <Input
                        type="password"
                        value={createEmployeePassword}
                        onChange={(event) => setCreateEmployeePassword(event.target.value)}
                        placeholder="Temporary password"
                        className="bg-slate-900/60 sm:col-span-2 lg:col-span-1"
                    />
                    <div className="flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-4">
                        <label className="flex items-center gap-2 text-xs text-slate-200">
                            <input
                                type="checkbox"
                                className="h-4 w-4 rounded-sm border border-slate-500 bg-slate-900/80"
                                checked={createEmployeeManager}
                                onChange={(event) => setCreateEmployeeManager(event.target.checked)}
                                disabled={!currentUser.isAdmin}
                            />
                            Project manager
                        </label>
                        <label className="flex items-center gap-2 text-xs text-slate-200">
                            <input
                                type="checkbox"
                                className="h-4 w-4 rounded-sm border border-slate-500 bg-slate-900/80"
                                checked={createEmployeeAdmin}
                                onChange={(event) => setCreateEmployeeAdmin(event.target.checked)}
                                disabled={!currentUser.isAdmin}
                            />
                            Admin
                        </label>
                        {!currentUser.isAdmin && (
                            <span className="text-xs text-slate-400">
                                Only administrators can assign manager or admin access.
                            </span>
                        )}
                    </div>
                    <Button
                        type="submit"
                        disabled={isCreatingEmployee}
                        className="sm:col-span-2 lg:col-span-1 justify-self-start lg:justify-self-end"
                    >
                        {isCreatingEmployee ? "Adding…" : "Add employee"}
                    </Button>
                    {createEmployeeError && (
                        <div className="sm:col-span-full text-sm text-red-300">{createEmployeeError}</div>
                    )}
                </form>

                {employeesError && (
                    <div className="rounded border border-red-600/60 bg-red-900/30 px-3 py-2 text-sm text-red-200">
                        {employeesError}
                    </div>
                )}

                {employeesNotice && (
                    <div className="rounded border border-emerald-600/60 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-200">
                        {employeesNotice}
                    </div>
                )}

                <div className="space-y-3">
                    {employees.length === 0 ? (
                        <div className="rounded border border-slate-700/60 bg-slate-900/50 px-4 py-5 text-sm text-slate-300">
                            {employeesLoading ? "Loading employees…" : "No employees found."}
                        </div>
                    ) : (
                        employees.map((employee) => {
                            const isPending = pendingEmployeeIds.has(employee.id);
                            return (
                                <div
                                    key={employee.id}
                                    className="flex flex-col gap-3 rounded-lg border border-slate-700/60 bg-slate-900/60 p-4 sm:flex-row sm:items-start sm:justify-between"
                                >
                                    <div className="space-y-2">
                                        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                                            {employee.name}
                                            <span
                                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                    employee.active
                                                        ? "bg-emerald-500/20 text-emerald-200"
                                                        : "bg-slate-700/60 text-slate-300"
                                                }`}
                                            >
                                                {employee.active ? "Active" : "Inactive"}
                                            </span>
                                            {employee.canManageWorkload && (
                                                <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold text-blue-200">
                                                    Project manager
                                                </span>
                                            )}
                                            {employee.isAdmin && (
                                                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                                                    Admin
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                                            <span>Username:</span>
                                            <span className="font-semibold text-slate-200">@{employee.username}</span>
                                        </div>
                                        {employee.position && (
                                            <div className="text-xs text-slate-300">{employee.position}</div>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-3 sm:items-end sm:text-right">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                            <div className="flex items-center gap-2">
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    value={employeeHoursDraft[employee.id] ?? ""}
                                                    onChange={(event) =>
                                                        setEmployeeHoursDraft((prev) => ({
                                                            ...prev,
                                                            [employee.id]: event.target.value,
                                                        }))
                                                    }
                                                    className="w-24 bg-slate-950/40"
                                                />
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => void handleSaveEmployeeHours(employee)}
                                                    disabled={isPending}
                                                    className="border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                                                >
                                                    Save hours
                                                </Button>
                                            </div>
                                            <Button
                                                variant={employee.active ? "ghost" : "secondary"}
                                                size="sm"
                                                onClick={() => void handleToggleEmployeeActive(employee)}
                                                disabled={isPending}
                                                className="border border-transparent bg-slate-900/60 text-white hover:bg-slate-800/80"
                                            >
                                                {employee.active ? "Set inactive" : "Activate"}
                                            </Button>
                                        </div>
                                        {currentUser.isAdmin && (
                                            <div className="flex flex-wrap justify-end gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => void handleToggleManagerFlag(employee)}
                                                    disabled={isPending}
                                                    className="border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                                                >
                                                    {employee.canManageWorkload
                                                        ? "Revoke manager"
                                                        : "Make manager"}
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => void handleToggleAdminFlag(employee)}
                                                    disabled={isPending}
                                                    className="border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                                                >
                                                    {employee.isAdmin ? "Revoke admin" : "Make admin"}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => void handleResetEmployeePassword(employee)}
                                                    disabled={isPending}
                                                    className="border border-transparent bg-slate-900/60 text-white hover:bg-slate-800/70"
                                                >
                                                    Reset password
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </section>

            <section className="space-y-4 rounded-xl border border-slate-700/60 bg-slate-900/50 p-5 shadow-md">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-white">Projects</h2>
                        <p className="text-sm text-slate-300">
                            Track project metadata, status, and availability.
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void loadProjects()}
                        disabled={projectsLoading}
                        className="border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                    >
                        {projectsLoading ? "Refreshing…" : "Refresh"}
                    </Button>
                </div>

                <form
                    onSubmit={handleCreateProject}
                    className="grid gap-3 rounded-lg border border-slate-700/60 bg-slate-900/50 p-4 sm:grid-cols-[1.1fr_1.1fr_0.6fr_auto]"
                >
                    <Input
                        value={createProjectName}
                        onChange={(event) => setCreateProjectName(event.target.value)}
                        placeholder="Project name"
                        className="bg-slate-900/60"
                    />
                    <Textarea
                        value={createProjectDescription}
                        onChange={(event) => setCreateProjectDescription(event.target.value)}
                        placeholder="Short description"
                        className="min-h-[46px] bg-slate-900/60 sm:min-h-[40px]"
                    />
                    <Select
                        value={createProjectStatus}
                        onValueChange={(value) => setCreateProjectStatus(value as ProjectStatus)}
                    >
                        <SelectTrigger className="border-slate-600/70 bg-slate-900/60 text-left text-slate-100">
                            <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent className="border-slate-600/70 bg-slate-800 text-slate-100">
                            {projectStatuses.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button type="submit" disabled={isCreatingProject}>
                        {isCreatingProject ? "Adding…" : "Add project"}
                    </Button>
                    {createProjectError && (
                        <div className="sm:col-span-4 text-sm text-red-300">{createProjectError}</div>
                    )}
                </form>

                {projectsError && (
                    <div className="rounded border border-red-600/60 bg-red-900/30 px-3 py-2 text-sm text-red-200">
                        {projectsError}
                    </div>
                )}

                <div className="space-y-3">
                    {projects.length === 0 ? (
                        <div className="rounded border border-slate-700/60 bg-slate-900/50 px-4 py-5 text-sm text-slate-300">
                            {projectsLoading ? "Loading projects…" : "No projects found."}
                        </div>
                    ) : (
                        projects.map((project) => {
                            const isPending = pendingProjectIds.has(project.id);
                            return (
                                <div
                                    key={project.id}
                                    className="flex flex-col gap-3 rounded-lg border border-slate-700/60 bg-slate-900/60 p-4 sm:flex-row sm:items-start sm:justify-between"
                                >
                                    <div className="space-y-1">
                                        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                                            <span>{project.name}</span>
                                            <ProjectStatusBadge status={project.status} />
                                            <span
                                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                    project.active
                                                        ? "bg-emerald-500/20 text-emerald-200"
                                                        : "bg-slate-700/60 text-slate-300"
                                                }`}
                                            >
                                                {project.active ? "Active" : "Inactive"}
                                            </span>
                                        </div>
                                        {project.description && (
                                            <p className="text-xs text-slate-300">{project.description}</p>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                        <Select
                                            value={project.status}
                                            onValueChange={(value) =>
                                                void handleUpdateProjectStatus(
                                                    project,
                                                    value as ProjectStatus
                                                )
                                            }
                                            disabled={isPending}
                                        >
                                            <SelectTrigger className="w-[150px] border-slate-600/70 bg-slate-900/60 text-left text-slate-100">
                                                <SelectValue placeholder="Status" />
                                            </SelectTrigger>
                                            <SelectContent className="border-slate-600/70 bg-slate-800 text-slate-100">
                                                {projectStatuses.map((option) => (
                                                    <SelectItem key={option.value} value={option.value}>
                                                        {option.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button
                                            variant={project.active ? "ghost" : "secondary"}
                                            size="sm"
                                            onClick={() => void handleToggleProjectActive(project)}
                                            disabled={isPending}
                                            className="border border-transparent bg-slate-900/60 text-white hover:bg-slate-800/80"
                                        >
                                            {project.active ? "Set inactive" : "Activate"}
                                        </Button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </section>
        </div>
    );
}

export { ManagementView };
