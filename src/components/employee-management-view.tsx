import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
    createEmployee,
    fetchEmployees,
    updateEmployee,
    type EmployeeSummary,
} from "@/api/workloadApi";
import type { AuthUser } from "@/api/authApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DraftRecord = Record<string, string>;

const makeHoursDraft = (employees: EmployeeSummary[]): DraftRecord =>
    employees.reduce<DraftRecord>((acc, employee) => {
        acc[employee.id] = employee.workHours?.toString() ?? "40";
        return acc;
    }, {});

const makeTagsDraft = (employees: EmployeeSummary[]): DraftRecord =>
    employees.reduce<DraftRecord>((acc, employee) => {
        acc[employee.id] = employee.tags.join(", ");
        return acc;
    }, {});

const normalizeTags = (values: string): string[] => {
    const seen = new Set<string>();
    return values
        .split(",")
        .map((value) => value.trim())
        .filter((value) => {
            if (!value) return false;
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};

type EmployeeManagementViewProps = {
    currentUser: AuthUser;
    onEmployeesChanged?: () => void;
};

export function EmployeeManagementView({ currentUser, onEmployeesChanged }: EmployeeManagementViewProps) {
    const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
    const [employeeHoursDraft, setEmployeeHoursDraft] = useState<DraftRecord>({});
    const [employeeTagsDraft, setEmployeeTagsDraft] = useState<DraftRecord>({});
    const [employeesLoading, setEmployeesLoading] = useState(false);
    const [employeesError, setEmployeesError] = useState<string | null>(null);
    const [employeesNotice, setEmployeesNotice] = useState<string | null>(null);
    const [pendingEmployeeIds, setPendingEmployeeIds] = useState<Set<string>>(new Set());

    const [createEmployeeName, setCreateEmployeeName] = useState("");
    const [createEmployeePosition, setCreateEmployeePosition] = useState("");
    const [createEmployeeHours, setCreateEmployeeHours] = useState("40");
    const [createEmployeeUsername, setCreateEmployeeUsername] = useState("");
    const [createEmployeePassword, setCreateEmployeePassword] = useState("");
    const [createEmployeeManager, setCreateEmployeeManager] = useState(false);
    const [createEmployeeAdmin, setCreateEmployeeAdmin] = useState(false);
    const [createEmployeeTags, setCreateEmployeeTags] = useState("");
    const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);
    const [createEmployeeError, setCreateEmployeeError] = useState<string | null>(null);

    const refreshEmployees = useCallback(async () => {
        setEmployeesLoading(true);
        setEmployeesError(null);
        setEmployeesNotice(null);
        try {
            const data = await fetchEmployees();
            setEmployees(data);
            setEmployeeHoursDraft(makeHoursDraft(data));
            setEmployeeTagsDraft(makeTagsDraft(data));
        } catch {
            setEmployeesError("Unable to load employees. Please refresh.");
        } finally {
            setEmployeesLoading(false);
        }
    }, []);

    useEffect(() => {
        void refreshEmployees();
    }, [refreshEmployees]);

    const mutateEmployeePending = useCallback((id: string, enable: boolean) => {
        setPendingEmployeeIds((prev) => {
            const next = new Set(prev);
            if (enable) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    const handleCreateEmployee = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
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

            const tags = normalizeTags(createEmployeeTags);

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
                    tags,
                });
                setCreateEmployeeName("");
                setCreateEmployeePosition("");
                setCreateEmployeeHours("40");
                setCreateEmployeeUsername("");
                setCreateEmployeePassword("");
                setCreateEmployeeManager(false);
                setCreateEmployeeAdmin(false);
                setCreateEmployeeTags("");
                await refreshEmployees();
                onEmployeesChanged?.();
                setEmployeesNotice(`${trimmedName} has been added.`);
            } catch {
                setCreateEmployeeError("Could not create employee. Please try again.");
            } finally {
                setIsCreatingEmployee(false);
            }
        },
        [
            createEmployeeName,
            createEmployeePosition,
            createEmployeeHours,
            createEmployeeUsername,
            createEmployeePassword,
            createEmployeeManager,
            createEmployeeAdmin,
            createEmployeeTags,
            currentUser.isAdmin,
            isCreatingEmployee,
            refreshEmployees,
            onEmployeesChanged,
        ]
    );

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
                onEmployeesChanged?.();
                setEmployeesNotice(`${updated.name}'s capacity updated.`);
            } catch {
                setEmployeesError("Failed to update employee hours. Please retry.");
            } finally {
                mutateEmployeePending(employee.id, false);
            }
        },
        [employeeHoursDraft, mutateEmployeePending, onEmployeesChanged]
    );

    const handleSaveEmployeeTags = useCallback(
        async (employee: EmployeeSummary) => {
            const draft = employeeTagsDraft[employee.id] ?? "";
            const tags = normalizeTags(draft);
            setEmployeesNotice(null);
            mutateEmployeePending(employee.id, true);
            try {
                const updated = await updateEmployee(employee.id, { tags });
                setEmployees((prev) =>
                    prev.map((entry) => (entry.id === employee.id ? updated : entry))
                );
                setEmployeeTagsDraft((prev) => ({
                    ...prev,
                    [employee.id]: updated.tags.join(", "),
                }));
                onEmployeesChanged?.();
                setEmployeesNotice(`${updated.name}'s tags updated.`);
            } catch {
                setEmployeesError("Failed to update employee tags. Please retry.");
            } finally {
                mutateEmployeePending(employee.id, false);
            }
        },
        [employeeTagsDraft, mutateEmployeePending, onEmployeesChanged]
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
                onEmployeesChanged?.();
                setEmployeesNotice(
                    `${updated.name} is now ${updated.active ? "active" : "inactive"}.`
                );
            } catch {
                setEmployeesError("Failed to update employee state. Please retry.");
            } finally {
                mutateEmployeePending(employee.id, false);
            }
        },
        [mutateEmployeePending, onEmployeesChanged]
    );

    const handleToggleManagerFlag = useCallback(
        async (employee: EmployeeSummary) => {
            if (!currentUser.isAdmin) return;
            if (employee.id === currentUser.id && employee.canManageWorkload) {
                setEmployeesError("You cannot remove your own project manager access.");
                return;
            }
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
                        updated.canManageWorkload
                            ? "granted project manager access."
                            : "project manager access revoked."
                    }`
                );
                onEmployeesChanged?.();
            } catch {
                setEmployeesError("Failed to update project manager access. Please retry.");
            } finally {
                mutateEmployeePending(employee.id, false);
            }
        },
        [currentUser.id, currentUser.isAdmin, mutateEmployeePending, onEmployeesChanged]
    );

    const handleToggleAdminFlag = useCallback(
        async (employee: EmployeeSummary) => {
            if (!currentUser.isAdmin) return;
            if (employee.id === currentUser.id && employee.isAdmin) {
                setEmployeesError("You cannot remove your own admin access.");
                return;
            }
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
                    `${updated.name} ${
                        updated.isAdmin ? "promoted to admin." : "admin access removed."
                    }`
                );
                onEmployeesChanged?.();
            } catch {
                setEmployeesError("Failed to update admin access. Please retry.");
            } finally {
                mutateEmployeePending(employee.id, false);
            }
        },
        [currentUser.id, currentUser.isAdmin, mutateEmployeePending, onEmployeesChanged]
    );

    const handleResetEmployeePassword = useCallback(
        async (employee: EmployeeSummary) => {
            if (!currentUser.isAdmin) return;
            const nextPassword = window.prompt(`Enter a new password for ${employee.name}`, "");
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

    return (
        <section className="space-y-6 rounded-xl border border-slate-700/60 bg-slate-900/50 p-5 shadow-md">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-white">Employees</h2>
                    <p className="text-sm text-slate-300">
                        Add team members, adjust capacity, manage roles, and curate their skills.
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshEmployees()}
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
                <Input
                    value={createEmployeeTags}
                    onChange={(event) => setCreateEmployeeTags(event.target.value)}
                    placeholder="Skills (comma separated)"
                    className="bg-slate-900/60 sm:col-span-2 lg:col-span-2"
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
                            Only administrators can grant manager or admin privileges.
                        </span>
                    )}
                </div>
                {createEmployeeError && (
                    <div className="sm:col-span-2 lg:col-span-5">
                        <div className="rounded border border-red-600/70 bg-red-900/30 px-3 py-2 text-sm text-red-200">
                            {createEmployeeError}
                        </div>
                    </div>
                )}
                <div className="sm:col-span-2 lg:col-span-5">
                    <Button
                        type="submit"
                        disabled={isCreatingEmployee}
                        className="w-full bg-slate-100 text-slate-900 hover:bg-white/80"
                    >
                        {isCreatingEmployee ? "Creating…" : "Add employee"}
                    </Button>
                </div>
            </form>

            {employeesNotice && (
                <div className="rounded border border-emerald-600/50 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-100">
                    {employeesNotice}
                </div>
            )}

            {employeesError && (
                <div className="rounded border border-red-600/70 bg-red-900/30 px-3 py-2 text-sm text-red-200">
                    {employeesError}
                </div>
            )}

            <div className="space-y-3">
                {employees.length === 0 ? (
                    <div className="rounded border border-slate-700/60 bg-slate-900/50 px-4 py-5 text-sm text-slate-300">
                        {employeesLoading ? "Loading employees…" : "No employees found."}
                    </div>
                ) : (
                    employees.map((employee) => {
                        const isSelf = employee.id === currentUser.id;
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
                                        <span className="font-semibold text-slate-200">
                                            @{employee.username}
                                        </span>
                                    </div>
                                    {employee.position && (
                                        <div className="text-xs text-slate-300">{employee.position}</div>
                                    )}
                                    <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                                        {employee.tags.length === 0 ? (
                                            <span className="text-slate-500">No skills tagged</span>
                                        ) : (
                                            employee.tags.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="rounded-full bg-slate-800/80 px-2 py-0.5 text-slate-200"
                                                >
                                                    {tag}
                                                </span>
                                            ))
                                        )}
                                    </div>
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
                                        <div className="flex items-center gap-2">
                                            <Input
                                                value={employeeTagsDraft[employee.id] ?? ""}
                                                onChange={(event) =>
                                                    setEmployeeTagsDraft((prev) => ({
                                                        ...prev,
                                                        [employee.id]: event.target.value,
                                                    }))
                                                }
                                                placeholder="Tags"
                                                className="w-48 bg-slate-950/40"
                                            />
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => void handleSaveEmployeeTags(employee)}
                                                disabled={isPending}
                                                className="border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                                            >
                                                Save tags
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap justify-end gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void handleToggleEmployeeActive(employee)}
                                            disabled={isPending}
                                            className="border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                                        >
                                            {employee.active ? "Set inactive" : "Set active"}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void handleToggleManagerFlag(employee)}
                                            disabled={isPending || !currentUser.isAdmin}
                                            className="border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                                        >
                                            {employee.canManageWorkload ? "Revoke manager" : "Make manager"}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void handleToggleAdminFlag(employee)}
                                            disabled={isPending || !currentUser.isAdmin}
                                            className="border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                                        >
                                            {employee.isAdmin ? "Revoke admin" : "Make admin"}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void handleResetEmployeePassword(employee)}
                                            disabled={isPending || !currentUser.isAdmin || isSelf}
                                            className="border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                                        >
                                            Reset password
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </section>
    );
}
