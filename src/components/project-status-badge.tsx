import { type ProjectStatus } from "@/api/workloadApi";
import { cn } from "@/lib/utils";

const statusStyles: Record<ProjectStatus, string> = {
    backlog: "border-sky-400/60 bg-sky-500/20 text-sky-100",
    started: "border-amber-400/60 bg-amber-500/20 text-amber-100",
    finished: "border-emerald-400/60 bg-emerald-500/20 text-emerald-100",
    canceled: "border-rose-500/60 bg-rose-500/20 text-rose-100",
};

const statusLabels: Record<ProjectStatus, string> = {
    backlog: "Backlog",
    started: "Started",
    finished: "Finished",
    canceled: "Canceled",
};

type ProjectStatusBadgeProps = {
    status: ProjectStatus;
    className?: string;
};

function ProjectStatusBadge({ status, className }: ProjectStatusBadgeProps) {
    return (
        <span
            className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal shadow-sm",
                statusStyles[status],
                className
            )}
        >
            {statusLabels[status]}
        </span>
    );
}

export { ProjectStatusBadge };
