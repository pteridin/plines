import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchEmployees, type EmployeeSummary } from "@/api/workloadApi";
import type { AuthUser } from "@/api/authApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { WorkloadTable } from "./workload-table";

type WorkloadViewProps = {
    refreshSignal?: number;
    currentUser: AuthUser;
    isManager: boolean;
};

const filterEmployeesList = (
    employees: EmployeeSummary[],
    nameFilter: string,
    selectedTags: string[]
) => {
    const search = nameFilter.trim().toLowerCase();
    const requiredTags = selectedTags.map((tag) => tag.toLowerCase());
    return employees.filter((employee) => {
        const matchesName =
            search.length === 0 ||
            employee.name.toLowerCase().includes(search) ||
            (employee.position ?? "").toLowerCase().includes(search) ||
            employee.tags.some((tag) => tag.toLowerCase().includes(search));
        const matchesTags =
            requiredTags.length === 0 ||
            requiredTags.every((tag) =>
                employee.tags.some((entry) => entry.toLowerCase() === tag)
            );
        return matchesName && matchesTags;
    });
};

function WorkloadView({ refreshSignal = 0, currentUser, isManager }: WorkloadViewProps) {
    const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(currentUser.id);
    const [isLoadingEmployees, setIsLoadingEmployees] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [nameFilter, setNameFilter] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);

    const loadEmployees = useCallback(async () => {
        if (!isManager) {
            setEmployees([]);
            setSelectedEmployeeId(currentUser.id);
            return;
        }

        setIsLoadingEmployees(true);
        setErrorMessage(null);
        try {
            const data = await fetchEmployees();
            setEmployees(data);
            setSelectedEmployeeId((prev) => {
                if (prev && data.some((employee) => employee.id === prev)) {
                    return prev;
                }
                return data[0]?.id ?? "";
            });
        } catch {
            setErrorMessage("Failed to load employees. Please try again.");
        } finally {
            setIsLoadingEmployees(false);
        }
    }, [currentUser.id, isManager]);

    useEffect(() => {
        if (isManager) {
            void loadEmployees();
        } else {
            setEmployees([]);
            setSelectedEmployeeId(currentUser.id);
        }
    }, [loadEmployees, refreshSignal, isManager, currentUser.id]);

    const availableTags = useMemo(() => {
        const tags = new Set<string>();
        employees.forEach((employee) => {
            employee.tags.forEach((tag) => tags.add(tag));
        });
        return Array.from(tags).sort((a, b) => a.localeCompare(b));
    }, [employees]);

    useEffect(() => {
        setSelectedTags((prev) => prev.filter((tag) => availableTags.includes(tag)));
    }, [availableTags]);

    const filteredEmployees = useMemo(
        () => (isManager ? filterEmployeesList(employees, nameFilter, selectedTags) : []),
        [employees, nameFilter, selectedTags, isManager]
    );

    useEffect(() => {
        if (!isManager) return;
        setSelectedEmployeeId((prev) => {
            if (filteredEmployees.length === 0) {
                return "";
            }
            if (prev && filteredEmployees.some((employee) => employee.id === prev)) {
                return prev;
            }
            return filteredEmployees[0]?.id ?? "";
        });
    }, [filteredEmployees, isManager]);

    useEffect(() => {
        if (!isManager) {
            setNameFilter("");
            setSelectedTags([]);
            setSelectedEmployeeId(currentUser.id);
        }
    }, [isManager, currentUser.id]);

    const toggleTag = useCallback((tag: string) => {
        setSelectedTags((prev) => {
            if (prev.includes(tag)) {
                return prev.filter((entry) => entry !== tag);
            }
            return [...prev, tag];
        });
    }, []);

    const selectedEmployee = useMemo(
        () =>
            isManager
                ? employees.find((employee) => employee.id === selectedEmployeeId)
                : ({
                      id: currentUser.id,
                      name: currentUser.name,
                      position: currentUser.position ?? "",
                      workHours: currentUser.workHours,
                      active: currentUser.active,
                      username: currentUser.username,
                      canManageWorkload: currentUser.canManageWorkload,
                      isAdmin: currentUser.isAdmin,
                      tags: currentUser.tags ?? [],
                  } satisfies EmployeeSummary),
        [
            employees,
            selectedEmployeeId,
            isManager,
            currentUser.id,
            currentUser.name,
            currentUser.position,
            currentUser.workHours,
            currentUser.active,
            currentUser.username,
            currentUser.canManageWorkload,
            currentUser.isAdmin,
            currentUser.tags,
        ]
    );

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                    <h1 className="text-xl font-semibold text-white">Workload assessment</h1>
                    <p className="text-sm text-slate-300">
                        {isManager
                            ? "Select an employee to review detailed project workload by week."
                            : "Review your scheduled workload and capacity for each project."}
                    </p>
                </div>
                {isManager ? (
                    <div className="flex flex-col gap-3 sm:items-end sm:text-right">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                        <Select
                                value={selectedEmployeeId}
                                onValueChange={setSelectedEmployeeId}
                                disabled={
                                    filteredEmployees.length === 0 || isLoadingEmployees
                                }
                        >
                            <SelectTrigger className="w-[220px] border-slate-600/70 bg-slate-900/50 text-left text-slate-100">
                                <SelectValue
                                        placeholder={
                                            isLoadingEmployees
                                                ? "Loading…"
                                                : filteredEmployees.length === 0
                                                    ? "No matches"
                                                    : "Choose employee"
                                        }
                                />
                            </SelectTrigger>
                            <SelectContent className="border-slate-600/70 bg-slate-800 text-slate-100">
                                {filteredEmployees.map((employee) => (
                                    <SelectItem key={employee.id} value={employee.id}>
                                        {employee.name}
                                        {!employee.active ? " (inactive)" : ""}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void loadEmployees()}
                            disabled={isLoadingEmployees}
                            className="border-slate-600/70 bg-slate-900/40 text-white hover:bg-slate-800/60"
                        >
                            {isLoadingEmployees ? "Refreshing…" : "Refresh"}
                        </Button>
                        </div>
                        <Input
                            value={nameFilter}
                            onChange={(event) => setNameFilter(event.target.value)}
                            placeholder="Filter by name, role, or tag"
                            className="border-slate-600/70 bg-slate-900/50 text-slate-100 sm:max-w-xs"
                        />
                        <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                            {availableTags.length === 0 ? (
                                <span className="text-xs text-slate-500">No tags available.</span>
                            ) : (
                                availableTags.map((tag) => {
                                    const isActive = selectedTags.includes(tag);
                                    return (
                                        <Button
                                            key={tag}
                                            size="sm"
                                            variant={isActive ? "default" : "outline"}
                                            onClick={() => toggleTag(tag)}
                                            className={
                                                (isActive
                                                    ? "bg-slate-100 text-slate-900 hover:bg-white/80"
                                                    : "border-slate-600/70 bg-slate-900/50 text-slate-200 hover:bg-slate-800/70") +
                                                " h-7 px-3 text-xs"
                                            }
                                        >
                                            {tag}
                                        </Button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 px-4 py-2 text-sm text-slate-200">
                        Viewing workload for <span className="font-semibold">{currentUser.name}</span>
                        {currentUser.active ? "" : " (inactive)"}
                    </div>
                )}
            </div>

            {errorMessage && (
                <div className="rounded border border-red-600/70 bg-red-900/30 px-3 py-2 text-sm text-red-200">
                    {errorMessage}
                </div>
            )}

            {selectedEmployee ? (
                <WorkloadTable
                    key={selectedEmployee.id}
                    userId={selectedEmployee.id}
                    employeeName={`${selectedEmployee.name}${selectedEmployee.active ? "" : " (inactive)"}`}
                    weeklyCapacityHours={selectedEmployee.workHours}
                    canEdit={isManager}
                />
            ) : isLoadingEmployees ? (
                <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-4 py-6 text-sm text-slate-300">
                    Loading employees…
                </div>
            ) : isManager && employees.length > 0 ? (
                <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-4 py-6 text-sm text-slate-300">
                    Adjust your filters to see matching employees.
                </div>
            ) : (
                <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-4 py-6 text-sm text-slate-300">
                    No employees available. Please add one from the management view.
                </div>
            )}
        </div>
    );
}

export { WorkloadView };
