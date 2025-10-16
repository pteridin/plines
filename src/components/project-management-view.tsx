import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
    createProject,
    fetchProjects,
    updateProject,
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

const projectStatuses: Array<{ value: ProjectStatus; label: string }> = [
    { value: "backlog", label: "Backlog" },
    { value: "started", label: "Started" },
    { value: "finished", label: "Finished" },
    { value: "canceled", label: "Canceled" },
];

type ProjectManagementViewProps = {
    onProjectsChanged?: () => void;
};

export function ProjectManagementView({ onProjectsChanged }: ProjectManagementViewProps) {
    const [projects, setProjects] = useState<ProjectSummary[]>([]);
    const [projectsLoading, setProjectsLoading] = useState(false);
    const [projectsError, setProjectsError] = useState<string | null>(null);
    const [pendingProjectIds, setPendingProjectIds] = useState<Set<string>>(new Set());

    const [createProjectName, setCreateProjectName] = useState("");
    const [createProjectDescription, setCreateProjectDescription] = useState("");
    const [createProjectStatus, setCreateProjectStatus] = useState<ProjectStatus>("backlog");
    const [isCreatingProject, setIsCreatingProject] = useState(false);
    const [createProjectError, setCreateProjectError] = useState<string | null>(null);

    const refreshProjects = useCallback(async () => {
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
        void refreshProjects();
    }, [refreshProjects]);

    const mutateProjectPending = useCallback((id: string, enable: boolean) => {
        setPendingProjectIds((prev) => {
            const next = new Set(prev);
            if (enable) next.add(id);
            else next.delete(id);
            return next;
        });
    }, []);

    const handleCreateProject = useCallback(
        async (event: FormEvent<HTMLFormElement>) => {
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
                await refreshProjects();
                onProjectsChanged?.();
            } catch {
                setCreateProjectError("Could not create project. Please try again.");
            } finally {
                setIsCreatingProject(false);
            }
        },
        [
            createProjectName,
            createProjectDescription,
            createProjectStatus,
            isCreatingProject,
            refreshProjects,
            onProjectsChanged,
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
                onProjectsChanged?.();
            } catch {
                setProjectsError("Failed to update project status.");
            } finally {
                mutateProjectPending(project.id, false);
            }
        },
        [mutateProjectPending, onProjectsChanged]
    );

    const handleToggleProjectActive = useCallback(
        async (project: ProjectSummary) => {
            mutateProjectPending(project.id, true);
            try {
                const updated = await updateProject(project.id, { active: !project.active });
                setProjects((prev) =>
                    prev.map((entry) => (entry.id === project.id ? updated : entry))
                );
                onProjectsChanged?.();
            } catch {
                setProjectsError("Failed to update project state.");
            } finally {
                mutateProjectPending(project.id, false);
            }
        },
        [mutateProjectPending, onProjectsChanged]
    );

    return (
        <section className="space-y-6 rounded-xl border border-slate-700/60 bg-slate-900/50 p-5 shadow-md">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-white">Projects</h2>
                    <p className="text-sm text-slate-300">
                        Maintain the project catalogue, descriptions, activity state, and status.
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshProjects()}
                    disabled={projectsLoading}
                    className="border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                >
                    {projectsLoading ? "Refreshing…" : "Refresh"}
                </Button>
            </div>

            <form
                onSubmit={handleCreateProject}
                className="grid gap-3 rounded-lg border border-slate-700/60 bg-slate-900/50 p-4 sm:grid-cols-[1.1fr_1.4fr_0.8fr_auto]"
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
                    placeholder="Description"
                    className="min-h-[46px] bg-slate-900/60"
                />
                <Select
                    value={createProjectStatus}
                    onValueChange={(value: ProjectStatus) => setCreateProjectStatus(value)}
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
                <Button
                    type="submit"
                    disabled={isCreatingProject}
                    className="bg-slate-100 text-slate-900 hover:bg-white/80"
                >
                    {isCreatingProject ? "Creating…" : "Add project"}
                </Button>
                {createProjectError && (
                    <div className="sm:col-span-4">
                        <div className="rounded border border-red-600/70 bg-red-900/30 px-3 py-2 text-sm text-red-200">
                            {createProjectError}
                        </div>
                    </div>
                )}
            </form>

            {projectsError && (
                <div className="rounded border border-red-600/70 bg-red-900/30 px-3 py-2 text-sm text-red-200">
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
                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                                        {project.name}
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
                                        <div className="text-xs text-slate-300">{project.description}</div>
                                    )}
                                </div>
                                <div className="flex flex-col gap-2 sm:items-end sm:text-right">
                                    <Select
                                        value={project.status}
                                        onValueChange={(value: ProjectStatus) =>
                                            handleUpdateProjectStatus(project, value)
                                        }
                                        disabled={isPending}
                                    >
                                        <SelectTrigger className="w-[170px] border-slate-600/70 bg-slate-900/60 text-left text-slate-100">
                                            <SelectValue placeholder="Set status" />
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
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void handleToggleProjectActive(project)}
                                        disabled={isPending}
                                        className="border-slate-600/70 bg-slate-900/60 text-white hover:bg-slate-800/70"
                                    >
                                        {project.active ? "Mark inactive" : "Mark active"}
                                    </Button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </section>
    );
}
