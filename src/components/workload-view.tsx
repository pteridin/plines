import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchEmployees, type EmployeeSummary } from "@/api/workloadApi";
import { Button } from "@/components/ui/button";
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
};

function WorkloadView({ refreshSignal = 0 }: WorkloadViewProps) {
    const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
    const [isLoadingEmployees, setIsLoadingEmployees] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const loadEmployees = useCallback(async () => {
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
    }, []);

    useEffect(() => {
        void loadEmployees();
    }, [loadEmployees, refreshSignal]);

    const selectedEmployee = useMemo(
        () => employees.find((employee) => employee.id === selectedEmployeeId),
        [employees, selectedEmployeeId]
    );

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                    <h1 className="text-xl font-semibold text-white">Workload assessment</h1>
                    <p className="text-sm text-slate-300">
                        Select an employee to review detailed project workload by week.
                    </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    <Select
                        value={selectedEmployeeId}
                        onValueChange={setSelectedEmployeeId}
                        disabled={employees.length === 0 || isLoadingEmployees}
                    >
                        <SelectTrigger className="w-[220px] border-slate-600/70 bg-slate-900/50 text-left text-slate-100">
                            <SelectValue placeholder={isLoadingEmployees ? "Loading…" : "Choose employee"} />
                        </SelectTrigger>
                        <SelectContent className="border-slate-600/70 bg-slate-800 text-slate-100">
                            {employees.map((employee) => (
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
                />
            ) : isLoadingEmployees ? (
                <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-4 py-6 text-sm text-slate-300">
                    Loading employees…
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
