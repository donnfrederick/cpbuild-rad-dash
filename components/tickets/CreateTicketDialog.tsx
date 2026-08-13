"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bug,
  Camera,
  Check,
  ChevronDown,
  FilePlus2,
  Lightbulb,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Video,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TICKETS_INBOX_REFRESH_EVENT } from "@/lib/ticket-inbox-events";
import { parseTagInput, TAG_NAME_MAX_LENGTH } from "@/lib/tag-normalize";
import {
  TICKET_TYPE_KIND_VALUES,
  ticketTypeKindLabelKey,
  formatCustomTypeKey,
  type BuiltInTicketTypeKind,
  type TicketTypeKind,
  type TeamTicketType,
} from "@/components/tickets/ticket-types";
import { TagSuggestInput } from "@/components/tickets/TagSuggestInput";
import { useScreenRecording } from "@/components/tickets/ScreenRecordingProvider";
import { useCurrentTeam } from "@/contexts/CurrentTeamContext";
import { cn } from "@/lib/utils";
import { getClipboardImageFiles } from "@/lib/clipboard-image-paste";

interface DuplicateCandidate {
  id: string;
  ref: string;
  shortId: number;
  title: string;
  similarity: number;
}

interface DuplicateReviewState {
  createdTicketId: string;
  candidates: DuplicateCandidate[];
}

const SELECT_CLASS =
  "min-h-(--input-height) min-w-[7.5rem] rounded-sm border border-border bg-card px-2 py-1.5 text-sm text-foreground shadow-(--shadow-1)";

const VIDEO_SIZE_LIMIT = 50 * 1024 * 1024;

/** Icons and accent colors for built-in ticket types (create form trigger + menu). */
const TICKET_TYPE_UI: Record<
  BuiltInTicketTypeKind,
  {
    Icon: LucideIcon;
    selectedClasses: string;
    menuIconClass: string;
  }
> = {
  BUG: {
    Icon: Bug,
    selectedClasses: "border-error-700 bg-error-50 text-error-700",
    menuIconClass: "text-error-700",
  },
  FEATURE_REQUEST: {
    Icon: Lightbulb,
    selectedClasses: "border-primary-500 bg-primary-100 text-primary-700",
    menuIconClass: "text-primary-700",
  },
  FEEDBACK: {
    Icon: MessageSquare,
    selectedClasses:
      "border-teal-600 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-200",
    menuIconClass: "text-teal-800 dark:text-teal-200",
  },
  MINOR_ENHANCEMENT: {
    Icon: Zap,
    selectedClasses:
      "border-amber-600 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100",
    menuIconClass: "text-amber-900 dark:text-amber-100",
  },
  REGRESSION: {
    Icon: RotateCcw,
    selectedClasses:
      "border-orange-600 bg-orange-50 text-orange-900 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-100",
    menuIconClass: "text-orange-900 dark:text-orange-100",
  },
  SECURITY_IMPROVEMENT: {
    Icon: ShieldCheck,
    selectedClasses:
      "border-violet-600 bg-violet-50 text-violet-900 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-100",
    menuIconClass: "text-violet-900 dark:text-violet-100",
  },
};

/** Returns the UI config for any ticket type key, falling back for custom types. */
function getTicketTypeUI(key: string): {
  Icon: LucideIcon;
  selectedClasses: string;
  menuIconClass: string;
} {
  if (key in TICKET_TYPE_UI) {
    return TICKET_TYPE_UI[key as BuiltInTicketTypeKind];
  }
  return {
    Icon: FilePlus2,
    selectedClasses: "border-border bg-muted text-foreground",
    menuIconClass: "text-muted-foreground",
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Matches `/api/tickets/assist-draft` follow_up JSON shape. */
interface AssistMcQuestion {
  prompt: string;
  options: [string, string, string, string];
}

interface AssistMcAnswerRow {
  /** 0–3 = preset option; 4 = other (see otherText) */
  choiceIndex: number | null;
  otherText: string;
}

function emptyMcAnswers(): AssistMcAnswerRow[] {
  return Array.from({ length: 5 }, () => ({ choiceIndex: null, otherText: "" }));
}

function parseAssistMcQuestions(data: unknown): AssistMcQuestion[] | null {
  if (typeof data !== "object" || data === null || !("questions" in data)) return null;
  const qs = (data as { questions: unknown }).questions;
  if (!Array.isArray(qs) || qs.length === 0) return null;
  const out: AssistMcQuestion[] = [];
  for (const row of qs) {
    if (typeof row !== "object" || row === null) continue;
    const prompt = typeof (row as { prompt: unknown }).prompt === "string" ? (row as { prompt: string }).prompt.trim() : "";
    const opts = (row as { options: unknown }).options;
    if (!prompt || !Array.isArray(opts)) continue;
    const four = opts
      .map((o) => (typeof o === "string" ? o.trim() : String(o).trim()))
      .filter((s) => s.length > 0)
      .slice(0, 4);
    while (four.length < 4) {
      four.push(`Option ${four.length + 1}`);
    }
    out.push({
      prompt: prompt.slice(0, 500),
      options: [four[0]!, four[1]!, four[2]!, four[3]!],
    });
    if (out.length >= 5) break;
  }
  return out.length === 5 ? out : null;
}

function mcAnswersComplete(questions: AssistMcQuestion[], answers: AssistMcAnswerRow[]): boolean {
  if (questions.length !== 5 || answers.length !== 5) return false;
  for (let i = 0; i < 5; i++) {
    const a = answers[i]!;
    if (a.choiceIndex === null || a.choiceIndex < 0 || a.choiceIndex > 4) return false;
    if (a.choiceIndex === 4 && a.otherText.trim().length === 0) return false;
  }
  return true;
}

function buildMcAnswersPayload(questions: AssistMcQuestion[], answers: AssistMcAnswerRow[]): string {
  return questions
    .map((q, i) => {
      const a = answers[i];
      if (!a || a.choiceIndex === null) {
        return `Q${i + 1} (${q.prompt}): (not answered)`;
      }
      if (a.choiceIndex === 4) {
        return `Q${i + 1}: Other — ${a.otherText.trim()}`;
      }
      const label = q.options[a.choiceIndex];
      return `Q${i + 1}: ${label ?? ""}`;
    })
    .join("\n");
}

export interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, ticket is created under this project and the field is fixed in the UI. */
  projectId?: string | null;
  /** When set without `projectId`, project dropdown lists only these projects (e.g. sprint scope). */
  allowedProjectIds?: string[];
  /**
   * When set (sprint with explicit `sprint_tickets`), triage can link the new ticket so it shows on the sprint board.
   */
  sprintId?: string | null;
  canTriage: boolean;
  fetchTickets: (opts?: { soft?: boolean }) => Promise<void>;
  /** Pre-populated files (e.g. a screen recording passed in from ScreenRecordingProvider). */
  initialFiles?: File[];
  /** Called after successful create so the parent can deep-link (?open=). */
  onCreated?: (ticketId: string) => void;
  /** When set, the ticket is created with this status instead of BACKLOG. */
  defaultStatus?: string;
}

type AssigneeOption = { id: string; name: string | null; email: string };

export function CreateTicketDialog({
  open,
  onOpenChange,
  projectId: scopedProjectId,
  allowedProjectIds,
  sprintId: linkSprintId,
  canTriage,
  fetchTickets,
  initialFiles,
  onCreated,
  defaultStatus,
}: CreateTicketDialogProps): React.ReactElement {
  const t = useTranslations("tickets");
  const { currentTeam } = useCurrentTeam();
  const teamSlug = currentTeam?.teamSlug ?? null;

  const [teamTicketTypes, setTeamTicketTypes] = useState<TeamTicketType[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ticketType, setTicketType] = useState<TicketTypeKind>("BUG");
  const [assigneeId, setAssigneeId] = useState("");
  const [priorityChoice, setPriorityChoice] = useState<"" | "LOW" | "MEDIUM" | "HIGH">("");
  const [storyPointsInput, setStoryPointsInput] = useState("");
  const [projectChoice, setProjectChoice] = useState("");
  const [projectLabel, setProjectLabel] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [pendingDescImages, setPendingDescImages] = useState<Array<{ file: File; localUrl: string }>>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const projectSelectRef = useRef<HTMLSelectElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const { recordingState, screenshotPhase, startRecording: startGlobalRecording, startScreenshot } =
    useScreenRecording();
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [duplicateReview, setDuplicateReview] = useState<DuplicateReviewState | null>(null);
  const [linkingDuplicateId, setLinkingDuplicateId] = useState<string | null>(null);
  const [aiAssistExpanded, setAiAssistExpanded] = useState(false);
  const [aiSituation, setAiSituation] = useState("");
  const [aiExtra, setAiExtra] = useState("");
  const [aiMcQuestions, setAiMcQuestions] = useState<AssistMcQuestion[]>([]);
  const [aiMcAnswers, setAiMcAnswers] = useState<AssistMcAnswerRow[]>(() => emptyMcAnswers());
  const [aiBusy, setAiBusy] = useState<null | "questions" | "draft">(null);
  const [projectError, setProjectError] = useState<string | null>(null);

  const emptyTagExclude = useMemo(() => new Set<string>(), []);

  const allowedProjectIdsKey = useMemo(
    () => (allowedProjectIds ?? []).join("\u001f"),
    [allowedProjectIds]
  );

  const resetForm = useCallback(() => {
    setTitle("");
    setDescription("");
    setTicketType("BUG");
    setAssigneeId("");
    setPriorityChoice("");
    setStoryPointsInput("");
    setProjectChoice("");
    setTagsInput("");
    setFiles([]);
    setPendingDescImages((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.localUrl);
      return [];
    });
    setDuplicateReview(null);
    setLinkingDuplicateId(null);
    dragCounterRef.current = 0;
    setIsDragOver(false);
    setAiAssistExpanded(false);
    setAiSituation("");
    setAiExtra("");
    setAiMcQuestions([]);
    setAiMcAnswers(emptyMcAnswers());
    setAiBusy(null);
    setProjectError(null);
  }, []);

  useEffect(() => {
    if (!open) {
      resetForm();
    } else if (initialFiles && initialFiles.length > 0) {
      setFiles(initialFiles);
    }
  }, [open, resetForm, initialFiles]);

  useEffect(() => {
    if (!open || !currentTeam?.teamId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/teams/${encodeURIComponent(currentTeam.teamId)}/ticket-types`);
        if (!res.ok) return;
        const data = (await res.json()) as { ticketTypes: TeamTicketType[] };
        if (!cancelled) {
          const enabled = data.ticketTypes.filter((tt) => tt.isEnabled);
          setTeamTicketTypes(enabled);
          // If the current ticketType is not in the enabled list, switch to the first enabled
          if (enabled.length > 0 && !enabled.some((tt) => tt.key === ticketType)) {
            setTicketType(enabled[0].key);
          }
        }
      } catch {
        // non-fatal — fall back to built-in types below
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentTeam?.teamId]);

  const enabledTicketTypes = teamTicketTypes.length > 0
    ? teamTicketTypes
    : TICKET_TYPE_KIND_VALUES.map((k, i) => ({
        id: k,
        name: k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, " "),
        key: k,
        isBuiltIn: true,
        isEnabled: true,
        sortOrder: i,
      } satisfies TeamTicketType));

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingMeta(true);
    void (async () => {
      try {
        const teamQuery = teamSlug ? `?team=${encodeURIComponent(teamSlug)}` : "";
        const [aRes, pRes] = await Promise.all([
          fetch("/api/tickets/assignees"),
          scopedProjectId
            ? fetch(`/api/projects/${encodeURIComponent(scopedProjectId)}`)
            : fetch(`/api/projects${teamQuery}`),
        ]);
        if (!aRes.ok) throw new Error("assignees");
        const aJson = (await aRes.json()) as { data: AssigneeOption[] };
        if (!cancelled) setAssignees(aJson.data ?? []);

        if (scopedProjectId) {
          if (pRes.ok) {
            const pJson = (await pRes.json()) as { name?: string };
            if (!cancelled) {
              setProjectLabel(pJson.name ?? scopedProjectId);
              setProjectChoice(scopedProjectId);
            }
          } else if (!cancelled) {
            setProjectLabel(null);
            setProjectChoice("");
          }
        } else if (allowedProjectIds && allowedProjectIds.length > 0) {
          if (pRes.ok) {
            const pJson = (await pRes.json()) as { projects?: Array<{ id: string; name: string }> };
            if (!cancelled) {
              const idOrder = new Map(allowedProjectIds.map((id, i) => [id, i]));
              const list = (pJson.projects ?? [])
                .filter((p) => idOrder.has(p.id))
                .sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
              setProjects(list);
              setProjectChoice((prev) => (list.some((p) => p.id === prev) ? prev : ""));
            }
          } else if (!cancelled) {
            setProjects([]);
            setProjectChoice("");
          }
        } else {
          if (pRes.ok) {
            const pJson = (await pRes.json()) as { projects?: Array<{ id: string; name: string }> };
            if (!cancelled) {
              const list = pJson.projects ?? [];
              setProjects(list);
              setProjectChoice((prev) => (prev && list.some((p) => p.id === prev) ? prev : ""));
            }
          } else if (!cancelled) {
            setProjects([]);
          }
        }
      } catch {
        if (!cancelled) {
          toast.error(t("createTicketLoadFailed"));
          setAssignees([]);
        }
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, scopedProjectId, allowedProjectIdsKey, teamSlug, t]);

  const effectiveProjectId = scopedProjectId ?? projectChoice;

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (e.target) e.target.value = "";
    setFiles((prev) => {
      const next = [...prev];
      for (const file of picked) {
        const mime = file.type || "application/octet-stream";
        if (mime.startsWith("video/") && file.size > VIDEO_SIZE_LIMIT) {
          toast.error(t("createTicketVideoTooLarge", { name: file.name }));
          continue;
        }
        if (next.length + pendingDescImages.length >= 10) break;
        next.push(file);
      }
      return next;
    });
  }, [t, pendingDescImages.length]);

  const removeFileAt = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleCaptureScreenshot = useCallback(async () => {
    try {
      await startScreenshot();
      // Provider acquired the stream and is now showing the floating bar.
      // Close the dialog so the screen is clear for navigation + capture.
      onOpenChange(false);
    } catch {
      // cancelled — stay silent
    }
  }, [startScreenshot, onOpenChange]);

  const isCaptureActive =
    screenshotPhase !== "idle" || recordingState !== "idle";

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      const dropped = Array.from(e.dataTransfer.files);
      setFiles((prev) => {
        const next = [...prev];
        for (const file of dropped) {
          const mime = file.type || "application/octet-stream";
          if (mime.startsWith("video/") && file.size > VIDEO_SIZE_LIMIT) {
            toast.error(t("createTicketVideoTooLarge", { name: file.name }));
            continue;
          }
          if (next.length + pendingDescImages.length >= 10) break;
          next.push(file);
        }
        return next;
      });
    },
    [t, pendingDescImages.length],
  );

  const handleDescriptionPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imgs = getClipboardImageFiles(e);
      if (imgs.length === 0) return;
      e.preventDefault();
      setPendingDescImages((prev) => {
        const next = [...prev];
        for (const file of imgs) {
          if (files.length + next.length >= 10) break;
          next.push({ file, localUrl: URL.createObjectURL(file) });
        }
        return next;
      });
    },
    [files.length],
  );

  // Stable object URLs keyed by "name|size|lastModified" so they survive re-renders
  // and are revoked when the file leaves the list or the dialog closes.
  const previewUrlsRef = useRef<Map<string, string>>(new Map());
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const prev = previewUrlsRef.current;
    const next = new Map<string, string>();

    for (const file of files) {
      if (!file.type.startsWith("video/") && !file.type.startsWith("image/")) continue;
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      // Reuse an existing URL if we already created one for this file
      next.set(key, prev.get(key) ?? URL.createObjectURL(file));
    }

    // Revoke URLs for files that are no longer in the list
    for (const [key, url] of prev) {
      if (!next.has(key)) URL.revokeObjectURL(url);
    }

    previewUrlsRef.current = next;
    setPreviewUrls(new Map(next));

    return () => {
      // Revoke all on unmount / dialog close
      for (const url of next.values()) URL.revokeObjectURL(url);
      previewUrlsRef.current = new Map();
    };
  }, [files]);

  const handleStartRecording = useCallback(async () => {
    try {
      await startGlobalRecording();
      // Close this dialog so the screen is clear during recording;
      // ScreenRecordingProvider will open a fresh dialog with the video when done.
      onOpenChange(false);
    } catch {
      toast.error(t("createTicketRecordingCancelled"));
    }
  }, [startGlobalRecording, onOpenChange, t]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedTitle = title.trim();
      const trimmedDesc = description.trim();
      if (!trimmedTitle || !trimmedDesc) {
        toast.error(t("createTicketValidation"));
        return;
      }


      setSubmitting(true);
      try {
        const body: Record<string, unknown> = {
          type: ticketType,
          title: trimmedTitle,
          description: trimmedDesc,
          projectId: effectiveProjectId ? effectiveProjectId : null,
        };
        if (assigneeId) {
          body.assigneeId = assigneeId;
        }
        if (canTriage && priorityChoice) {
          body.priority = priorityChoice;
        }
        if (canTriage && storyPointsInput.trim() !== "") {
          const n = Number.parseInt(storyPointsInput.trim(), 10);
          if (Number.isNaN(n) || n < 0 || n > 99) {
            toast.error(t("bulkInvalidStoryPoints"));
            setSubmitting(false);
            return;
          }
          body.storyPoints = n;
        }
        if (canTriage) {
          const names = parseTagInput(tagsInput);
          if (names.length > 0) {
            body.tagNames = names;
          }
        }
        if (canTriage && linkSprintId) {
          body.sprintId = linkSprintId;
        }
        if (defaultStatus) {
          body.status = defaultStatus;
        }

        const createTicketUrl = teamSlug ? `/api/tickets?team=${encodeURIComponent(teamSlug)}` : "/api/tickets";
        const res = await fetch(createTicketUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          if (res.status === 403) {
            toast.error(t("createTicketForbidden"));
          } else {
            toast.error(err.error ?? t("createTicketFailed"));
          }
          return;
        }
        const created = (await res.json()) as {
          id: string;
          duplicateCandidates?: DuplicateCandidate[];
        };

        const toUpload = [...files, ...pendingDescImages.map((p) => p.file)];
        if (toUpload.length > 0) {
          const uploadedKeys: string[] = [];
          const uploadedUrls: string[] = [];
          const uploadedMimes: string[] = [];
          const uploadedSizes: number[] = [];
          const uploadedCaptions: string[] = [];

          for (let i = 0; i < toUpload.length; i++) {
            const file = toUpload[i]!;
            const form = new FormData();
            form.append("file", file);
            form.append("type", "tickets");
            const up = await fetch("/api/upload/field-media", { method: "POST", body: form });
            if (!up.ok) {
              toast.error(t("createTicketUploadPartial", { n: i + 1 }));
              break;
            }
            const data = (await up.json()) as {
              storageKey: string;
              storageUrl: string;
              mimeType: string;
              fileSizeBytes: number;
            };
            uploadedKeys.push(data.storageKey);
            uploadedUrls.push(data.storageUrl);
            uploadedMimes.push(data.mimeType);
            uploadedSizes.push(data.fileSizeBytes);
            uploadedCaptions.push("");
          }

          if (uploadedKeys.length > 0) {
            const cRes = await fetch(`/api/tickets/${encodeURIComponent(created.id)}/attachments`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                attachmentKeys: uploadedKeys,
                attachmentUrls: uploadedUrls,
                attachmentMimeTypes: uploadedMimes,
                attachmentFileSizeBytes: uploadedSizes,
                attachmentCaptions: uploadedCaptions,
              }),
            });
            if (!cRes.ok) {
              toast.error(t("createTicketAttachmentsFailed"));
            }
          }
        }

        setPendingDescImages((prev) => {
          for (const p of prev) URL.revokeObjectURL(p.localUrl);
          return [];
        });

        toast.success(t("createTicketSuccess"));
        window.dispatchEvent(new CustomEvent(TICKETS_INBOX_REFRESH_EVENT));
        await fetchTickets({ soft: true });

        const candidates = created.duplicateCandidates ?? [];
        if (candidates.length > 0 && canTriage) {
          // Switch the dialog into review mode — the user decides whether
          // the new ticket is a duplicate of one of the candidates.
          setDuplicateReview({
            createdTicketId: created.id,
            candidates: candidates.slice(0, 5),
          });
        } else {
          onOpenChange(false);
          onCreated?.(created.id);
        }
      } catch {
        toast.error(t("createTicketFailed"));
      } finally {
        setSubmitting(false);
      }
    },
    [
      title,
      description,
      ticketType,
      assigneeId,
      canTriage,
      priorityChoice,
      storyPointsInput,
      effectiveProjectId,
      files,
      pendingDescImages,
      tagsInput,
      linkSprintId,
      defaultStatus,
      fetchTickets,
      onOpenChange,
      onCreated,
      t,
    ]
  );

  const finishAndClose = useCallback(
    (ticketId: string) => {
      setDuplicateReview(null);
      onOpenChange(false);
      onCreated?.(ticketId);
    },
    [onOpenChange, onCreated]
  );

  const handleKeepAsSeparate = useCallback(() => {
    if (!duplicateReview) return;
    finishAndClose(duplicateReview.createdTicketId);
  }, [duplicateReview, finishAndClose]);

  const handleLinkAsDuplicate = useCallback(
    async (canonicalId: string, canonicalRef: string, similarity: number) => {
      if (!duplicateReview) return;
      setLinkingDuplicateId(canonicalId);
      try {
        const res = await fetch(
          `/api/tickets/${encodeURIComponent(duplicateReview.createdTicketId)}/link-duplicate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ canonicalId, similarity }),
          }
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(err.error ?? t("createTicketFailed"));
          return;
        }
        toast.success(
          t.has("createTicketLinkedDuplicate")
            ? t("createTicketLinkedDuplicate", { ref: canonicalRef })
            : `Linked as duplicate of ${canonicalRef}.`
        );
        window.dispatchEvent(new CustomEvent(TICKETS_INBOX_REFRESH_EVENT));
        await fetchTickets({ soft: true });
        finishAndClose(canonicalId);
      } catch {
        toast.error(t("createTicketFailed"));
      } finally {
        setLinkingDuplicateId(null);
      }
    },
    [duplicateReview, fetchTickets, finishAndClose, t]
  );

  const runAiAssistFollowUp = useCallback(async () => {
    const situation = aiSituation.trim();
    if (!situation) {
      toast.error(t("createTicketAiAssistNeedSituation"));
      return;
    }
    setAiBusy("questions");
    try {
      const res = await fetch("/api/tickets/assist-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "follow_up",
          ticketType,
          situation,
          extraContext: aiExtra.trim() || undefined,
        }),
      });
      if (res.status === 503) {
        toast.error(t("createTicketAiAssistNotConfigured"));
        return;
      }
      if (!res.ok) {
        toast.error(t("createTicketAiAssistQuestionsFailed"));
        return;
      }
      const data: unknown = await res.json();
      const parsedQs = parseAssistMcQuestions(data);
      if (!parsedQs) {
        toast.error(t("createTicketAiAssistQuestionsFailed"));
        return;
      }
      setAiMcQuestions(parsedQs);
      setAiMcAnswers(emptyMcAnswers());
    } catch {
      toast.error(t("createTicketAiAssistQuestionsFailed"));
    } finally {
      setAiBusy(null);
    }
  }, [aiSituation, aiExtra, ticketType, t]);

  const runAiAssistDraft = useCallback(
    async (options?: { includeFollowUpAnswers?: boolean }) => {
      const situation = aiSituation.trim();
      if (!situation) {
        toast.error(t("createTicketAiAssistNeedSituation"));
        return;
      }
      const skipAnswers = options?.includeFollowUpAnswers === false;
      const requireCompleteMc = options?.includeFollowUpAnswers === true;
      if (requireCompleteMc) {
        if (!mcAnswersComplete(aiMcQuestions, aiMcAnswers)) {
          toast.error(t("createTicketAiAssistMcIncomplete"));
          return;
        }
      }
      let answersPayload: string | undefined;
      if (!skipAnswers) {
        if (aiMcQuestions.length === 5 && mcAnswersComplete(aiMcQuestions, aiMcAnswers)) {
          answersPayload = buildMcAnswersPayload(aiMcQuestions, aiMcAnswers).slice(0, 8000);
        }
      }
      setAiBusy("draft");
      try {
        const res = await fetch("/api/tickets/assist-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phase: "draft",
            ticketType,
            situation,
            extraContext: aiExtra.trim() || undefined,
            ...(answersPayload ? { followUpAnswers: answersPayload } : {}),
          }),
        });
        if (res.status === 503) {
          toast.error(t("createTicketAiAssistNotConfigured"));
          return;
        }
        if (!res.ok) {
          toast.error(t("createTicketAiAssistFailed"));
          return;
        }
        const data = (await res.json()) as { title?: string; description?: string };
        if (data.title?.trim()) {
          setTitle(data.title.trim().slice(0, 120));
        }
        if (data.description?.trim()) {
          setDescription(data.description.trim().slice(0, 4000));
        }
        if (data.title?.trim() || data.description?.trim()) {
          setAiAssistExpanded(false);
          setAiMcQuestions([]);
          setAiMcAnswers(emptyMcAnswers());
        }
      } catch {
        toast.error(t("createTicketAiAssistFailed"));
      } finally {
        setAiBusy(null);
      }
    },
    [aiSituation, aiExtra, aiMcQuestions, aiMcAnswers, ticketType, t]
  );

  const currentTypeUI = getTicketTypeUI(ticketType);
  const TicketTypeTriggerIcon = currentTypeUI.Icon;
  const currentTypeName = enabledTicketTypes.find((tt) => tt.key === ticketType)?.name
    ?? (ticketTypeKindLabelKey(ticketType) ? t(ticketTypeKindLabelKey(ticketType)!) : formatCustomTypeKey(ticketType));

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90dvh,720px)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {duplicateReview ? t.has("createTicketDuplicateReviewTitle")
              ? t("createTicketDuplicateReviewTitle")
              : "Possible duplicates found"
              : t("createTicketTitle")}
          </DialogTitle>
          {!duplicateReview ? (
            <DialogDescription className="sr-only">{t("createTicketFormDescription")}</DialogDescription>
          ) : null}
        </DialogHeader>
        {duplicateReview ? (
          <DuplicateReviewPanel
            state={duplicateReview}
            linkingCandidateId={linkingDuplicateId}
            onLink={handleLinkAsDuplicate}
            onKeep={handleKeepAsSeparate}
          />
        ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
          {!scopedProjectId ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("projectLabel")}</span>
              <select
                ref={projectSelectRef}
                className={`${SELECT_CLASS} w-full`}
                value={projectChoice}
                onChange={(e) => {
                  setProjectChoice(e.target.value);
                }}
                disabled={loadingMeta}
              >
                <option value="">
                  {loadingMeta ? "…" : t("createTicketProjectNone")}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {!projectChoice && linkSprintId && !loadingMeta ? (
                <p className="text-xs text-muted-foreground">{t("createTicketSprintGeneralHint")}</p>
              ) : projects.length === 0 && !loadingMeta ? (
                <p className="text-xs text-muted-foreground">{t("createTicketNoProjects")}</p>
              ) : null}
            </label>
          ) : (
            <div className="rounded-sm border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-xs text-muted-foreground">{t("projectLabel")}</span>
              <p className="font-medium text-foreground">
                {loadingMeta ? "…" : projectLabel ?? scopedProjectId}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground" id="create-ticket-type-label">
              {t("createTicketTypeLabel")}
            </span>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    currentTypeUI.selectedClasses,
                  )}
                  aria-labelledby="create-ticket-type-label"
                  aria-haspopup="menu"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <TicketTypeTriggerIcon size={16} className="shrink-0" strokeWidth={2} aria-hidden />
                    <span className="truncate">{currentTypeName}</span>
                  </span>
                  <ChevronDown className="size-4 shrink-0 opacity-70" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="min-w-(--radix-dropdown-menu-trigger-width) p-1"
              >
                {enabledTicketTypes.map((tt) => {
                  const cfg = getTicketTypeUI(tt.key);
                  const ItemIcon = cfg.Icon;
                  const selected = ticketType === tt.key;
                  return (
                    <DropdownMenuItem
                      key={tt.key}
                      onSelect={() => setTicketType(tt.key)}
                      className={cn("gap-2 py-2", selected && "font-semibold")}
                    >
                      <ItemIcon
                        size={16}
                        className={cn("shrink-0", cfg.menuIconClass)}
                        strokeWidth={2}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">{tt.name}</span>
                      {selected ? (
                        <Check className="ml-auto size-4 shrink-0 text-primary" aria-hidden />
                      ) : (
                        <span className="ml-auto size-4 shrink-0" aria-hidden />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex flex-col gap-3 rounded-xl border border-sky-200 bg-sky-50/90 p-3 dark:border-sky-900/60 dark:bg-sky-950/25 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-1 gap-3">
                <Sparkles
                  className="mt-0.5 size-5 shrink-0 text-sky-800 dark:text-sky-300"
                  aria-hidden
                  strokeWidth={2}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold text-foreground">{t("createTicketAiAssistTitle")}</p>
                  <p className="text-sm text-muted-foreground">{t("createTicketAiAssistBody")}</p>
                  <p className="text-xs text-muted-foreground">{t("createTicketAiAssistBodyHint")}</p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                className="w-full shrink-0 bg-sky-900 text-white hover:bg-sky-950 dark:bg-sky-800 dark:hover:bg-sky-700 sm:mt-0 sm:w-auto"
                onClick={() => setAiAssistExpanded((v) => !v)}
              >
                {t("createTicketAiAssistCta")}
              </Button>
            </div>
            {aiAssistExpanded ? (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-(--shadow-1)">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-foreground">{t("createTicketAiAssistSituationLabel")}</span>
                  <textarea
                    value={aiSituation}
                    onChange={(e) => setAiSituation(e.target.value)}
                    className="min-h-[72px] w-full rounded-sm border border-border bg-background px-3 py-2 text-sm"
                    placeholder={t("createTicketAiAssistSituationPlaceholder")}
                    maxLength={3000}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{t("createTicketAiAssistExtraLabel")}</span>
                  <textarea
                    value={aiExtra}
                    onChange={(e) => setAiExtra(e.target.value)}
                    className="min-h-[56px] w-full rounded-sm border border-border bg-background px-3 py-2 text-sm"
                    placeholder={t("createTicketAiAssistExtraPlaceholder")}
                    maxLength={3000}
                  />
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={aiBusy !== null}
                    className="border-sky-800/30 bg-background sm:order-1"
                    onClick={() => void runAiAssistFollowUp()}
                  >
                    {aiBusy === "questions" ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        {t("createTicketAiAssistGenerating")}
                      </>
                    ) : (
                      t("createTicketAiAssistSuggestQuestions")
                    )}
                  </Button>
                  <Button
                    type="button"
                    disabled={aiBusy !== null}
                    className="bg-sky-900 text-white hover:bg-sky-950 sm:order-2"
                    onClick={() => void runAiAssistDraft()}
                  >
                    {aiBusy === "draft" ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                        {t("createTicketAiAssistGenerating")}
                      </>
                    ) : (
                      t("createTicketAiAssistGenerate")
                    )}
                  </Button>
                </div>
                {aiMcQuestions.length > 0 ? (
                  <div className="mt-1 flex flex-col gap-4 rounded-md border border-sky-200/80 bg-sky-50/50 p-3 dark:border-sky-900/50 dark:bg-sky-950/20">
                    <p className="text-xs font-medium text-foreground">{t("createTicketAiAssistMcIntro")}</p>
                    {aiMcQuestions.map((q, qIndex) => {
                      const row = aiMcAnswers[qIndex] ?? { choiceIndex: null, otherText: "" };
                      const groupName = `create-ticket-ai-mc-${qIndex}`;
                      return (
                        <fieldset key={`${qIndex}-${q.prompt.slice(0, 40)}`} className="flex flex-col gap-2 border-0 p-0">
                          <legend className="mb-1 text-sm font-medium text-foreground">
                            <span className="text-muted-foreground">{qIndex + 1}. </span>
                            {q.prompt}
                          </legend>
                          <div className="flex flex-col gap-2 pl-0.5">
                            {q.options.map((opt, j) => (
                              <label
                                key={`${qIndex}-opt-${j}`}
                                className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-0.5 text-sm hover:bg-background/60"
                              >
                                <input
                                  type="radio"
                                  name={groupName}
                                  className="mt-1 shrink-0"
                                  checked={row.choiceIndex === j}
                                  onChange={() => {
                                    setAiMcAnswers((prev) => {
                                      const next = [...prev];
                                      next[qIndex] = { choiceIndex: j, otherText: "" };
                                      return next;
                                    });
                                  }}
                                />
                                <span className="min-w-0 leading-snug text-foreground">{opt}</span>
                              </label>
                            ))}
                            <label className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-0.5 text-sm hover:bg-background/60">
                              <input
                                type="radio"
                                name={groupName}
                                className="mt-1 shrink-0"
                                checked={row.choiceIndex === 4}
                                onChange={() => {
                                  setAiMcAnswers((prev) => {
                                    const next = [...prev];
                                    next[qIndex] = {
                                      choiceIndex: 4,
                                      otherText: next[qIndex]?.otherText ?? "",
                                    };
                                    return next;
                                  });
                                }}
                              />
                              <span className="min-w-0 leading-snug font-medium text-foreground">
                                {t("createTicketAiAssistMcOtherLabel")}
                              </span>
                            </label>
                            {row.choiceIndex === 4 ? (
                              <textarea
                                value={row.otherText}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setAiMcAnswers((prev) => {
                                    const next = [...prev];
                                    const cur = next[qIndex] ?? { choiceIndex: 4, otherText: "" };
                                    next[qIndex] = { ...cur, otherText: v };
                                    return next;
                                  });
                                }}
                                className="ml-6 min-h-[64px] w-[calc(100%-1.25rem)] rounded-sm border border-border bg-background px-3 py-2 text-sm"
                                placeholder={t("createTicketAiAssistMcOtherPlaceholder")}
                                maxLength={600}
                                aria-label={t("createTicketAiAssistMcOtherAria")}
                              />
                            ) : null}
                          </div>
                        </fieldset>
                      );
                    })}
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={aiBusy !== null}
                        className="text-muted-foreground sm:mr-auto"
                        onClick={() => void runAiAssistDraft({ includeFollowUpAnswers: false })}
                      >
                        {t("createTicketAiAssistGenerateSkip")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={aiBusy !== null}
                        className="bg-sky-900 text-white hover:bg-sky-950"
                        onClick={() => void runAiAssistDraft({ includeFollowUpAnswers: true })}
                      >
                        {aiBusy === "draft" ? (
                          <>
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                            {t("createTicketAiAssistGenerating")}
                          </>
                        ) : (
                          t("createTicketAiAssistGenerateWithAnswers")
                        )}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("createTicketTitleLabel")}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="min-h-(--input-height) w-full rounded-sm border border-border bg-card px-3 text-sm shadow-(--shadow-1)"
              maxLength={120}
              required
              autoComplete="off"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("createTicketDescriptionLabel")}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onPaste={handleDescriptionPaste}
              className="min-h-[120px] w-full rounded-sm border border-border bg-card px-3 py-2 text-sm shadow-(--shadow-1)"
              maxLength={4000}
              required
            />
            {pendingDescImages.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {pendingDescImages.map((p, i) => (
                  <div
                    key={p.localUrl}
                    className="relative h-[60px] w-[60px] shrink-0 overflow-hidden rounded-lg border border-border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.localUrl} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label={t("removeAttachmentAria")}
                      onClick={() => {
                        URL.revokeObjectURL(p.localUrl);
                        setPendingDescImages((prev) => prev.filter((_, j) => j !== i));
                      }}
                      className="absolute right-0.5 top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-0 bg-black/60 p-0"
                    >
                      <X size={10} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("assigneeLabel")}</span>
            <select
              className={SELECT_CLASS}
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              disabled={loadingMeta}
            >
              <option value="">{t("assigneeUnassigned")}</option>
              {assignees.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                </option>
              ))}
            </select>
          </label>

          {canTriage ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t("priorityLabel")}</span>
                <select
                  className={SELECT_CLASS}
                  value={priorityChoice}
                  onChange={(e) => setPriorityChoice(e.target.value as typeof priorityChoice)}
                >
                  <option value="">{t("createTicketPriorityUnset")}</option>
                  <option value="LOW">{t("priorityLow")}</option>
                  <option value="MEDIUM">{t("priorityMedium")}</option>
                  <option value="HIGH">{t("priorityHigh")}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t("storyPointsLabel")}</span>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={storyPointsInput}
                  onChange={(e) => setStoryPointsInput(e.target.value)}
                  className="min-h-(--input-height) w-full rounded-sm border border-border bg-card px-3 text-sm shadow-(--shadow-1)"
                  placeholder={t("createTicketStoryPointsPlaceholder")}
                />
              </label>
            </div>
          ) : null}

          {canTriage ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("tagsLabel")}</span>
              <TagSuggestInput
                className="min-h-(--input-height) w-full rounded-sm border border-border bg-card px-3 text-sm shadow-(--shadow-1)"
                value={tagsInput}
                onChange={setTagsInput}
                placeholder={t("tagsPlaceholder")}
                aria-label={t("createTicketTagsAria")}
                excludeNormalizedNames={emptyTagExclude}
              />
              <p className="text-xs text-muted-foreground">{t("tagMaxLengthHint", { max: TAG_NAME_MAX_LENGTH })}</p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t("createTicketAttachmentsLabel")}</span>
              {(files.length > 0 || pendingDescImages.length > 0) && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {files.length + pendingDescImages.length}/10
                </span>
              )}
            </div>

            {/* Drop zone */}
            <div
              className={cn(
                "rounded-lg border-2 border-dashed transition-colors duration-150",
                isDragOver
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/20 hover:border-muted-foreground/30",
              )}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {/* Capture toolbar */}
              <div className="flex flex-wrap gap-1.5 p-2">
                <button
                  type="button"
                  disabled={isCaptureActive}
                  onClick={() => void handleCaptureScreenshot()}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-(--shadow-1) transition-colors hover:bg-muted disabled:opacity-50",
                  )}
                >
                  {screenshotPhase === "requesting" ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Camera className="size-3.5" aria-hidden />
                  )}
                  {t("createTicketCaptureScreenshot")}
                </button>

                <button
                  type="button"
                  disabled={isCaptureActive}
                  onClick={() => void handleStartRecording()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-(--shadow-1) transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Video className="size-3.5" aria-hidden />
                  {t("createTicketRecordScreen")}
                </button>

                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-(--shadow-1) transition-colors hover:bg-muted">
                  <input
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={onFileChange}
                    accept="image/*,video/*,audio/*"
                    disabled={files.length + pendingDescImages.length >= 10}
                  />
                  <FilePlus2 className="size-3.5" aria-hidden />
                  {t("createTicketAttachFiles")}
                </label>
              </div>

              {/* Empty-state hint */}
              {files.length === 0 && (
                <p
                  className={cn(
                    "pb-3 text-center text-[11px] transition-colors duration-100",
                    isDragOver ? "font-medium text-primary" : "text-muted-foreground/60",
                  )}
                >
                  {isDragOver ? t("createTicketDropFilesHere") : t("createTicketDragAndDrop")}
                </p>
              )}

              {/* Image grid */}
              {(() => {
                const imageFiles = files.filter((f) => f.type.startsWith("image/"));
                const nonImageFiles = files.filter((f) => !f.type.startsWith("image/"));
                return (
                  <>
                    {imageFiles.length > 0 && (
                      <div className="grid grid-cols-3 gap-1.5 px-2 pb-2">
                        {imageFiles.map((f) => {
                          const urlKey = `${f.name}|${f.size}|${f.lastModified}`;
                          const previewUrl = previewUrls.get(urlKey);
                          const fileIdx = files.indexOf(f);
                          return (
                            <div
                              key={urlKey}
                              className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted/30"
                            >
                              {previewUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={previewUrl}
                                  alt={f.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center">
                                  <Camera className="size-5 text-muted-foreground/50" aria-hidden />
                                </div>
                              )}
                              {/* File size badge */}
                              <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] leading-none text-white/90">
                                {formatFileSize(f.size)}
                              </span>
                              {/* Remove button */}
                              <button
                                type="button"
                                onClick={() => removeFileAt(fileIdx)}
                                aria-label={`Remove ${f.name}`}
                                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                              >
                                <X className="size-3" aria-hidden />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Video & other files */}
                    {nonImageFiles.length > 0 && (
                      <div className="flex flex-col gap-1 px-2 pb-2">
                        {nonImageFiles.map((f) => {
                          const urlKey = `${f.name}|${f.size}|${f.lastModified}`;
                          const previewUrl = previewUrls.get(urlKey);
                          const fileIdx = files.indexOf(f);
                          const isVideo = f.type.startsWith("video/");
                          return (
                            <div
                              key={urlKey}
                              className="overflow-hidden rounded-md border border-border bg-card"
                            >
                              {isVideo && previewUrl && (
                                <video
                                  src={previewUrl}
                                  controls
                                  className="max-h-36 w-full bg-black"
                                />
                              )}
                              <div className="flex items-center gap-2 px-2.5 py-1.5">
                                {isVideo ? (
                                  <Video className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                ) : (
                                  <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                )}
                                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                                  {f.name}
                                </span>
                                <span className="shrink-0 text-[10px] text-muted-foreground">
                                  {formatFileSize(f.size)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeFileAt(fileIdx)}
                                  aria-label={`Remove ${f.name}`}
                                  className="ml-0.5 shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  <X className="size-3.5" aria-hidden />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2 sm:justify-end">
            <button
              type="button"
              className="rounded-sm border border-border px-3 py-2 text-sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t("createTicketCancel")}
            </button>
            <button
              type="submit"
              disabled={submitting || loadingMeta}
              className="inline-flex items-center justify-center gap-2 rounded-sm bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("createTicketSubmit")}
            </button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

// ─── Duplicate review panel ──────────────────────────────────────────────────

interface DuplicateReviewPanelProps {
  state: DuplicateReviewState;
  linkingCandidateId: string | null;
  onLink: (canonicalId: string, canonicalRef: string, similarity: number) => Promise<void> | void;
  onKeep: () => void;
}

function DuplicateReviewPanel({
  state,
  linkingCandidateId,
  onLink,
  onKeep,
}: DuplicateReviewPanelProps): React.ReactElement {
  const t = useTranslations("tickets");
  const busy = linkingCandidateId !== null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-800 dark:bg-amber-950/30">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div>
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {t.has("createTicketDuplicateReviewHeader")
              ? t("createTicketDuplicateReviewHeader", { count: state.candidates.length })
              : `This ticket looks similar to ${state.candidates.length} existing ticket${state.candidates.length === 1 ? "" : "s"}.`}
          </p>
          <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
            {t.has("createTicketDuplicateReviewSubtext")
              ? t("createTicketDuplicateReviewSubtext")
              : "Link the new ticket to one of them, or keep it as a separate ticket."}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {state.candidates.map((candidate) => {
          const isLinking = linkingCandidateId === candidate.id;
          const percent = Math.round(candidate.similarity * 100);
          return (
            <li
              key={candidate.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  <span className="font-mono text-primary">{candidate.ref}</span>{" "}
                  — {candidate.title}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.has("createTicketDuplicateSimilarity")
                    ? t("createTicketDuplicateSimilarity", { percent })
                    : `${percent}% similar`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onLink(candidate.id, candidate.ref, candidate.similarity)}
                disabled={busy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-primary bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {isLinking ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Link2 className="size-3.5" aria-hidden />
                )}
                {t.has("createTicketLinkAsDuplicate")
                  ? t("createTicketLinkAsDuplicate")
                  : "Link as duplicate"}
              </button>
            </li>
          );
        })}
      </ul>

      <DialogFooter className="gap-2 pt-1 sm:justify-end">
        <button
          type="button"
          onClick={onKeep}
          disabled={busy}
          className="inline-flex items-center justify-center rounded-sm border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          {t.has("createTicketKeepAsSeparate")
            ? t("createTicketKeepAsSeparate")
            : "Keep as separate"}
        </button>
      </DialogFooter>
    </div>
  );
}
