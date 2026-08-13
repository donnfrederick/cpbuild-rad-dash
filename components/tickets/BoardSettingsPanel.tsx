"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { TeamBoardStatus, TeamSwimlaneConfig, SwimlaneBy } from "@/components/tickets/ticket-types";
import { cn } from "@/lib/utils";

interface BoardSettingsPanelProps {
  teamId: string;
  boardStatuses: TeamBoardStatus[];
  swimlaneConfig: TeamSwimlaneConfig | null;
  onClose: () => void;
  onSaved: (statuses: TeamBoardStatus[], swimlane?: TeamSwimlaneConfig | null) => void;
}

const SWIMLANE_OPTIONS: { value: SwimlaneBy; label: string }[] = [
  { value: "NONE", label: "None" },
  { value: "ASSIGNEE", label: "Assignee" },
  { value: "TYPE", label: "Ticket Type" },
  { value: "PRIORITY", label: "Priority" },
  { value: "PROJECT", label: "Project" },
];

function SortableStatusRow({
  status,
  onToggle,
  onRename,
  onColorChange,
  onDelete,
  saving,
}: {
  status: TeamBoardStatus;
  onToggle: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onColorChange: (id: string, color: string) => void;
  onDelete: (status: TeamBoardStatus) => void;
  saving: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: status.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 transition-opacity",
        !status.isEnabled && "opacity-50",
        isDragging && "z-50 shadow-lg ring-1 ring-primary/30"
      )}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...listeners}
        {...attributes}
      >
        <GripVertical size={14} aria-hidden />
      </button>

      <input
        type="color"
        value={status.color ?? "#6b7280"}
        onChange={(e) => onColorChange(status.id, e.target.value)}
        className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border"
        title="Column colour"
      />

      <input
        type="text"
        value={status.label}
        onChange={(e) => onRename(status.id, e.target.value)}
        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-foreground focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
        aria-label="Status label"
      />

      <button
        type="button"
        role="switch"
        aria-checked={status.isEnabled}
        aria-label={`Toggle ${status.label}`}
        title={status.isEnabled ? "Hide column" : "Show column"}
        onClick={() => onToggle(status.id)}
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          status.isEnabled ? "bg-primary" : "bg-input"
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-3 w-3 rounded-full bg-white shadow-sm transition-transform",
            status.isEnabled ? "translate-x-3" : "translate-x-0"
          )}
        />
      </button>

      {!status.isBuiltIn ? (
        <button
          type="button"
          onClick={() => onDelete(status)}
          disabled={saving}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive disabled:opacity-50"
          aria-label={`Delete ${status.label}`}
        >
          <Trash2 size={12} />
        </button>
      ) : (
        <span className="h-6 w-6 shrink-0" aria-hidden />
      )}
    </div>
  );
}

export function BoardSettingsPanel({
  teamId,
  boardStatuses: initialStatuses,
  swimlaneConfig: initialSwimlane,
  onClose,
  onSaved,
}: BoardSettingsPanelProps) {
  const [tab, setTab] = useState<"statuses" | "swimlanes">("statuses");
  const [statuses, setStatuses] = useState<TeamBoardStatus[]>(
    [...initialStatuses].sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const [swimlaneBy, setSwimlaneBy] = useState<SwimlaneBy>(
    initialSwimlane?.swimlaneBy ?? "NONE"
  );
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Always fetch fresh data on mount so the panel reflects the actual DB state,
  // even if the parent's cached boardStatuses is stale (e.g. a status was added
  // in a previous session without clicking "Save Settings").
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/teams/${encodeURIComponent(teamId)}/board-statuses`).then(
        (r) => r.json() as Promise<{ boardStatuses: TeamBoardStatus[] }>
      ),
      fetch(`/api/teams/${encodeURIComponent(teamId)}/swimlane-config`).then(
        (r) => r.json() as Promise<{ swimlaneConfig: { swimlaneBy: SwimlaneBy } }>
      ),
    ])
      .then(([statusData, swimlaneData]) => {
        if (cancelled) return;
        setStatuses(
          [...statusData.boardStatuses].sort((a, b) => a.sortOrder - b.sortOrder)
        );
        setSwimlaneBy(swimlaneData.swimlaneConfig?.swimlaneBy ?? "NONE");
      })
      .catch(() => {
        // Fall back to whatever the parent passed in
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [teamId]);

  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [addingNew, setAddingNew] = useState(false);
  const newLabelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingNew) newLabelRef.current?.focus();
  }, [addingNew]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setStatuses((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const toggleEnabled = useCallback((id: string) => {
    setStatuses((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isEnabled: !s.isEnabled } : s))
    );
  }, []);

  const renameStatus = useCallback((id: string, label: string) => {
    setStatuses((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
  }, []);

  const changeColor = useCallback((id: string, color: string) => {
    setStatuses((prev) => prev.map((s) => (s.id === id ? { ...s, color } : s)));
  }, []);

  const removeStatus = useCallback((id: string) => {
    setStatuses((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleAddNew = useCallback(async () => {
    const label = newLabel.trim();
    if (!label) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/board-statuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, color: newColor }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to add status");
        return;
      }
      const data = (await res.json()) as { boardStatus: TeamBoardStatus };
      setStatuses((prev) => [...prev, data.boardStatus]);
      setNewLabel("");
      setNewColor("#6366f1");
      setAddingNew(false);
      toast.success("Status added");
    } catch {
      toast.error("Failed to add status");
    } finally {
      setSaving(false);
    }
  }, [teamId, newLabel, newColor]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updates = statuses.map((s, index) =>
        fetch(`/api/teams/${encodeURIComponent(teamId)}/board-statuses/${encodeURIComponent(s.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: s.label,
            color: s.color,
            isEnabled: s.isEnabled,
            sortOrder: index,
          }),
        })
      );

      const swimRes = fetch(`/api/teams/${encodeURIComponent(teamId)}/swimlane-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swimlaneBy }),
      });

      const [statusResults, swimlaneResult] = await Promise.all([
        Promise.all(updates),
        swimRes,
      ]);

      const allOk = statusResults.every((r) => r.ok) && swimlaneResult.ok;
      if (!allOk) {
        toast.error("Some settings failed to save. Please try again.");
        return;
      }

      const [refreshedStatuses, swimlaneData] = await Promise.all([
        fetch(`/api/teams/${encodeURIComponent(teamId)}/board-statuses`).then(
          (r) => r.json() as Promise<{ boardStatuses: TeamBoardStatus[] }>
        ),
        swimlaneResult.json() as Promise<{ swimlaneConfig: TeamSwimlaneConfig }>,
      ]);

      toast.success("Board settings saved");
      onSaved(refreshedStatuses.boardStatuses, swimlaneData.swimlaneConfig);
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }, [statuses, swimlaneBy, teamId, onSaved]);

  const handleDeleteStatus = useCallback(
    async (status: TeamBoardStatus) => {
      if (status.isBuiltIn) {
        toast.error("Built-in statuses cannot be deleted.");
        return;
      }
      setSaving(true);
      try {
        const res = await fetch(
          `/api/teams/${encodeURIComponent(teamId)}/board-statuses/${encodeURIComponent(status.id)}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          toast.error(err.error ?? "Failed to delete status");
          return;
        }
        removeStatus(status.id);
        toast.success("Status deleted");
      } catch {
        toast.error("Failed to delete status");
      } finally {
        setSaving(false);
      }
    },
    [teamId, removeStatus]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" role="dialog" aria-modal="true" aria-label="Board Settings">
      <div
        className="fixed inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 flex h-full w-full max-w-md flex-col bg-background shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Board Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="flex shrink-0 gap-0 border-b border-border px-5">
          {(["statuses", "swimlanes"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "relative px-4 py-2.5 text-xs font-medium transition-colors",
                tab === t
                  ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "statuses" ? "Statuses" : "Swimlanes"}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "statuses" ? (
            <div className="flex flex-col gap-2">
              <p className="mb-2 text-xs text-muted-foreground">
                Drag to reorder, toggle to show/hide columns, rename, or add custom statuses.
                Built-in statuses cannot be deleted.
              </p>

              {loading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 size={16} className="animate-spin" aria-hidden />
                </div>
              ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={statuses.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-2">
                    {statuses.map((status) => (
                      <SortableStatusRow
                        key={status.id}
                        status={status}
                        onToggle={toggleEnabled}
                        onRename={renameStatus}
                        onColorChange={changeColor}
                        onDelete={handleDeleteStatus}
                        saving={saving}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              )}

              {!loading && addingNew ? (
                <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      ref={newLabelRef}
                      type="text"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleAddNew(); }}
                      placeholder="Status name (e.g. Awaiting QA)"
                      className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1.5 text-xs text-foreground"
                    />
                    <input
                      type="color"
                      value={newColor}
                      onChange={(e) => setNewColor(e.target.value)}
                      className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border"
                      title="Colour"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => { setAddingNew(false); setNewLabel(""); }}
                      className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAddNew()}
                      disabled={!newLabel.trim() || saving}
                      className="rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={12} className="animate-spin" /> : "Add"}
                    </button>
                  </div>
                </div>
              ) : !loading ? (
                <button
                  type="button"
                  onClick={() => setAddingNew(true)}
                  className="mt-1 flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                >
                  <Plus size={12} aria-hidden />
                  Add custom status
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground">
                Group tickets into horizontal lanes by a shared attribute.
                Select &quot;None&quot; to disable swimlanes.
              </p>
              <div className="flex flex-col gap-2">
                {SWIMLANE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md border border-border px-4 py-3 transition-colors hover:bg-muted/50",
                      swimlaneBy === opt.value && "border-primary bg-primary/5"
                    )}
                  >
                    <input
                      type="radio"
                      name="swimlaneBy"
                      value={opt.value}
                      checked={swimlaneBy === opt.value}
                      onChange={() => setSwimlaneBy(opt.value)}
                      className="text-primary"
                    />
                    <span className="text-sm text-foreground">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-5 py-4">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-border bg-card px-4 py-2 text-xs font-medium text-foreground shadow-(--shadow-1) hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
              Save settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
