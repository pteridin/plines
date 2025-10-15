import { useCallback, useState } from "react";
import { ChevronDown, ClipboardList, Users } from "lucide-react";
import "./index.css";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ManagementView } from "@/components/management-view";
import { WorkloadView } from "@/components/workload-view";

type ActiveView = "workload" | "management";

export function App() {
    const [activeView, setActiveView] = useState<ActiveView>("workload");
    const [workloadRefreshToken, setWorkloadRefreshToken] = useState(0);

    const handleDataChange = useCallback(() => {
        setWorkloadRefreshToken((prev) => prev + 1);
    }, []);

    const viewLabel =
        activeView === "workload" ? "Workload assessment" : "Employee & project management";

    return (
        <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
            <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                    <h1 className="text-2xl font-semibold text-white">Pipeline Planner</h1>
                    <p className="text-sm text-slate-300">
                        Understand capacity and manage your delivery backlog in one place.
                    </p>
                </div>
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
                                activeView === "management" && "bg-slate-800/70 text-white"
                            )}
                            onSelect={() => setActiveView("management")}
                        >
                            <Users className="size-4" />
                            Employee & project management
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </header>

            <main>
                {activeView === "workload" ? (
                    <WorkloadView refreshSignal={workloadRefreshToken} />
                ) : (
                    <ManagementView onDataChange={handleDataChange} />
                )}
            </main>
        </div>
    );
}

export default App;
