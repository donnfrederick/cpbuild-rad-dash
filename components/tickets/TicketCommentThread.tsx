"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Pencil, Trash2, X, Images, Video, Mic, Loader2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { MentionTextarea } from "@/components/ui/MentionTextarea";
import { renderRichText } from "@/lib/mention-render";
import { ImageAnnotationEditor } from "@/components/tickets/ImageAnnotationEditor";
import { ImageAnnotationOverlay } from "@/components/tickets/ImageAnnotationOverlay";
import type { AnnotationSaveResult } from "@/components/tickets/ImageAnnotationEditor";
import type { ImageAnnotationPayload } from "@/lib/image-annotation-schema";
import { parseImageAnnotation } from "@/lib/image-annotation-schema";

export interface TicketCommentAttachment {
  id: string;
  storageKey: string;
  storageUrl: string;
  mimeType: string;
  fileSizeBytes: number | null;
  caption: string | null;
  imageAnnotation?: ImageAnnotationPayload | null;
  lastMarkedById?: string | null;
  lastMarkedAt?: string | null;
  lastMarkedBy?: { id: string; name: string | null; email: string } | null;
}

export interface TicketCommentData {
  id: string;
  body: string;
  editedAt: string | null;
  createdAt: string;
  author: { id: string; name: string | null; email: string };
  attachments: TicketCommentAttachment[];
  originTicket?: { id: string; ref: string; shortId: number; title: string } | null;
}

interface AnnotationSavedPayload {
  commentId: string;
  attachmentId: string;
  annotation: ImageAnnotationPayload;
  lastMarkedAt: string | null;
  lastMarkedBy: { id: string; name: string | null; email: string } | null;
}

interface AttachmentGridProps {
  attachments: TicketCommentAttachment[];
  ticketId: string;
  commentId: string;
  onAnnotationSaved: (payload: AnnotationSavedPayload) => void;
  formatTime: (dateStr: string) => string;
}

interface TicketCommentThreadProps {
  ticketId: string;
  currentUserId?: string;
  pollingEnabled?: boolean;
}

const EDIT_WINDOW_MS = 30 * 60 * 1000;
const VIDEO_SIZE_LIMIT = 50 * 1024 * 1024;
const POLL_MS = 8000;

function initials(name: string | null, email: string): string {
  const src = (name && name.trim()) ? name.trim() : email;
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function canEdit(comment: TicketCommentData, userId?: string): boolean {
  if (!userId) return false;
  if (comment.author.id !== userId) return false;
  return Date.now() - new Date(comment.createdAt).getTime() < EDIT_WINDOW_MS;
}

const CSS = `
  @keyframes tct-spin { to { transform: rotate(360deg); } }
  .tct-spin { animation: tct-spin 1s linear infinite; }
`;

function AttachmentGrid({ attachments, ticketId, commentId, onAnnotationSaved, formatTime }: AttachmentGridProps) {
  const t = useTranslations("tickets");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [annotatingIdx, setAnnotatingIdx] = useState<number | null>(null);
  const [savingAnnotation, setSavingAnnotation] = useState<Record<string, boolean>>({});

  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const others = attachments.filter((a) => !a.mimeType.startsWith("image/"));

  async function handleAnnotationSave(idx: number, result: AnnotationSaveResult) {
    setAnnotatingIdx(null);
    if (!("kind" in result) || result.kind !== "layered") return;
    const attachment = images[idx];
    if (!attachment) return;
    setSavingAnnotation((p) => ({ ...p, [attachment.id]: true }));
    try {
      const res = await fetch(
        `/api/tickets/${ticketId}/comments/${commentId}/attachments/${attachment.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageAnnotation: result.annotation }),
        }
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to save annotation");
        return;
      }
      const updated = (await res.json()) as {
        id: string;
        imageAnnotation: unknown;
        lastMarkedAt: string | null;
        lastMarkedBy: { id: string; name: string | null; email: string } | null;
      };
      onAnnotationSaved({
        commentId,
        attachmentId: attachment.id,
        annotation: result.annotation,
        lastMarkedAt: updated.lastMarkedAt ?? null,
        lastMarkedBy: updated.lastMarkedBy ?? null,
      });
    } catch {
      toast.error("Failed to save annotation");
    } finally {
      setSavingAnnotation((p) => ({ ...p, [attachment.id]: false }));
    }
  }

  const annotatingAttachment = annotatingIdx !== null ? images[annotatingIdx] : null;

  return (
    <div className="mt-2">
      {images.length > 0 && (
        <div
          className="mb-2 grid gap-1"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}
        >
          {images.map((a, i) => (
            <div key={a.id} className="group flex flex-col">
              <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
                <button
                  type="button"
                  className="h-full w-full"
                  onClick={() => setLightbox(i)}
                  aria-label={a.caption ?? t("attachmentLightboxImage")}
                >
                  <ImageAnnotationOverlay
                    src={a.storageUrl}
                    annotation={a.imageAnnotation ?? null}
                    alt={a.caption ?? ""}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </button>

                {/* Pencil button — always visible, sits in bottom-right corner */}
                <button
                  type="button"
                  aria-label="Annotate image"
                  onClick={(e) => { e.stopPropagation(); setAnnotatingIdx(i); }}
                  disabled={savingAnnotation[a.id]}
                  className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full border-0 bg-black/60 transition-opacity"
                  style={{ opacity: savingAnnotation[a.id] ? 1 : undefined }}
                >
                  {savingAnnotation[a.id] ? (
                    <Loader2 size={12} className="animate-spin text-white" />
                  ) : (
                    <Pencil size={12} className="text-white" />
                  )}
                </button>
              </div>

              {/* Annotated-by label */}
              {a.imageAnnotation && a.lastMarkedBy && (
                <p className="mt-0.5 flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  <Pencil size={9} className="shrink-0" />
                  <span
                    className="group relative cursor-default font-medium"
                    title={a.lastMarkedBy.name ?? a.lastMarkedBy.email}
                  >
                    {initials(a.lastMarkedBy.name, a.lastMarkedBy.email)}
                    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow opacity-0 transition-opacity group-hover:opacity-100">
                      {a.lastMarkedBy.name ?? a.lastMarkedBy.email}
                    </span>
                  </span>
                  {a.lastMarkedAt && (
                    <span className="opacity-70">· {formatTime(a.lastMarkedAt)}</span>
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {others.map((a) => (
        <div key={a.id} className="mb-1.5">
          {a.mimeType.startsWith("audio/") && (
            <audio controls src={a.storageUrl} className="h-9 w-full" />
          )}
          {a.mimeType.startsWith("video/") && (
            <div className="relative flex min-h-[80px] items-center justify-center overflow-hidden rounded-[10px] bg-black">
              <Video size={28} className="absolute text-white/50" aria-hidden />
              <video controls src={a.storageUrl} className="max-h-[200px] w-full" />
            </div>
          )}
          {a.caption && <p className="mt-0.5 text-[11px] text-muted-foreground">{a.caption}</p>}
        </div>
      ))}

      {lightbox !== null && images[lightbox] && (
        <div
          className="fixed inset-0 z-320 flex flex-col items-center justify-center bg-black/90"
          role="dialog"
          aria-modal="true"
          aria-label={t("attachmentLightboxImage")}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label={t("attachmentLightboxClose")}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border-0 bg-white/15 text-white"
          >
            <X size={18} />
          </button>
          <button
            type="button"
            aria-label="Annotate image"
            onClick={() => { const idx = lightbox; setLightbox(null); setAnnotatingIdx(idx); }}
            className="absolute right-16 top-4 flex h-9 w-9 items-center justify-center rounded-full border-0 bg-white/15 text-white"
          >
            <Pencil size={16} />
          </button>
          <div className="flex max-h-[80dvh] max-w-[92vw] items-center justify-center">
            <ImageAnnotationOverlay
              src={images[lightbox].storageUrl}
              annotation={images[lightbox].imageAnnotation ?? null}
              alt=""
              style={{ maxHeight: "80dvh", maxWidth: "92vw", borderRadius: 8 }}
            />
          </div>
        </div>
      )}

      {/* Annotation editor */}
      {annotatingIdx !== null && annotatingAttachment && (
        <ImageAnnotationEditor
          src={annotatingAttachment.storageUrl}
          exportMode="layered"
          initialAnnotation={annotatingAttachment.imageAnnotation ?? undefined}
          onSave={(result) => void handleAnnotationSave(annotatingIdx, result)}
          onClose={() => setAnnotatingIdx(null)}
        />
      )}
    </div>
  );
}

export function TicketCommentThread({
  ticketId,
  currentUserId,
  pollingEnabled = false,
}: TicketCommentThreadProps) {
  const t = useTranslations("tickets");
  const tCommon = useTranslations("common");

  const formatCommentRelTime = useCallback(
    (dateStr: string) => {
      const ms = Date.now() - new Date(dateStr).getTime();
      const mins = Math.floor(ms / 60000);
      if (mins < 1) return t("commentRelJustNow");
      if (mins < 60) return t("commentRelMinutesAgo", { n: mins });
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return t("commentRelHoursAgo", { n: hrs });
      return t("commentRelDaysAgo", { n: Math.floor(hrs / 24) });
    },
    [t]
  );

  const [comments, setComments] = useState<TicketCommentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newBody, setNewBody] = useState("");
  const [newMedia, setNewMedia] = useState<{ file: File; localUrl: string; mimeType: string; caption: string }[]>(
    []
  );
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const baseUrl = `/api/tickets/${ticketId}/comments`;

  function normalizeComments(raw: TicketCommentData[]): TicketCommentData[] {
    return raw.map((c) => ({
      ...c,
      attachments: c.attachments.map((a) => ({
        ...a,
        imageAnnotation: parseImageAnnotation(a.imageAnnotation as unknown ?? null),
      })),
    }));
  }

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(baseUrl);
      if (!res.ok) return;
      const data = (await res.json()) as { comments: TicketCommentData[] };
      setComments(normalizeComments(data.comments ?? []));
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void fetchComments();
  }, [fetchComments]);

  useEffect(() => {
    if (!pollingEnabled) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(baseUrl);
          if (!res.ok) return;
          const data = (await res.json()) as { comments: TicketCommentData[] };
          setComments(normalizeComments(data.comments ?? []));
        } catch {
          /* silent */
        }
      })();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [pollingEnabled, baseUrl]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchComments();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [fetchComments]);

  function startEdit(comment: TicketCommentData) {
    setEditingId(comment.id);
    setEditBody(comment.body);
  }

  async function saveEdit(commentId: string) {
    if (!editBody.trim()) return;
    setEditSaving(true);
    try {
      const res = await fetch(`${baseUrl}/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editBody.trim() }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? t("commentEditFailed"));
        return;
      }
      const updated = (await res.json()) as TicketCommentData;
      setComments((prev) => prev.map((c) => (c.id === commentId ? updated : c)));
      setEditingId(null);
    } catch {
      toast.error(t("commentEditFailed"));
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(commentId: string) {
    setDeleting(true);
    try {
      const res = await fetch(`${baseUrl}/${commentId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? t("commentDeleteFailed"));
        return;
      }
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setConfirmDeleteId(null);
    } catch {
      toast.error(t("commentDeleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  async function handleLibraryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const slots = 10 - newMedia.length;
    const rawFiles = Array.from(e.target.files ?? []).slice(0, slots);
    if (e.target) e.target.value = "";
    const newItems: typeof newMedia = [];
    for (const file of rawFiles) {
      const mime = file.type || "application/octet-stream";
      if (mime.startsWith("video/") && file.size > VIDEO_SIZE_LIMIT) {
        toast.error(t("videoTooLarge", { name: file.name }));
        continue;
      }
      newItems.push({
        file,
        localUrl: URL.createObjectURL(file),
        mimeType: mime,
        caption: "",
      });
    }
    setNewMedia((p) => [...p, ...newItems]);
  }

  async function handleSubmit() {
    if (!newBody.trim() && newMedia.length === 0) return;
    setSubmitting(true);

    const uploadedKeys: string[] = [];
    const uploadedUrls: string[] = [];
    const uploadedMimes: string[] = [];
    const uploadedSizes: number[] = [];
    const uploadedCaptions: string[] = [];

    if (newMedia.length > 0) {
      setUploadProgress({ current: 0, total: newMedia.length });
      for (let i = 0; i < newMedia.length; i++) {
        setUploadProgress({ current: i + 1, total: newMedia.length });
        const m = newMedia[i];
        try {
          const form = new FormData();
          form.append("file", m.file);
          form.append("type", "ticket-comments");
          if (m.caption) form.append("caption", m.caption);
          const res = await fetch("/api/upload/field-media", { method: "POST", body: form });
          if (!res.ok) throw new Error(await res.text());
          const data = (await res.json()) as {
            storageKey: string;
            storageUrl: string;
            mimeType: string;
            fileSizeBytes: number;
          };
          uploadedKeys.push(data.storageKey);
          uploadedUrls.push(data.storageUrl);
          uploadedMimes.push(data.mimeType);
          uploadedSizes.push(data.fileSizeBytes);
          uploadedCaptions.push(m.caption);
        } catch {
          toast.error(t("uploadFailedChunk", { n: i + 1 }));
        }
      }
    }
    setUploadProgress(null);

    try {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: newBody.trim(),
          attachmentKeys: uploadedKeys,
          attachmentUrls: uploadedUrls,
          attachmentMimeTypes: uploadedMimes,
          attachmentFileSizeBytes: uploadedSizes,
          attachmentCaptions: uploadedCaptions,
        }),
      });
      if (!res.ok) throw new Error();
      const raw = (await res.json()) as TicketCommentData;
      const comment = normalizeComments([raw])[0]!;
      setComments((prev) => [...prev, comment]);
      setNewBody("");
      setNewMedia([]);
      void fetchComments();
    } catch {
      toast.error(t("commentPostFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleAnnotationSaved({ commentId, attachmentId, annotation, lastMarkedAt, lastMarkedBy }: AnnotationSavedPayload) {
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? {
              ...c,
              attachments: c.attachments.map((a) =>
                a.id === attachmentId
                  ? { ...a, imageAnnotation: annotation, lastMarkedAt, lastMarkedBy }
                  : a
              ),
            }
          : c
      )
    );
  }

  const isUploading = uploadProgress !== null;
  const canPost = (newBody.trim().length > 0 || newMedia.length > 0) && !isUploading && !submitting;

  const MEDIA_BTN: React.CSSProperties = {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 8,
    border: "1.5px solid hsl(var(--border))",
    backgroundColor: "hsl(var(--card))",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: "hsl(var(--muted-foreground))",
  };

  return (
    <>
      <style>{CSS}</style>
      <div>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
            {t("commentsSection")}
            {comments.length > 0 ? ` (${comments.length})` : ""}
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 size={20} className="tct-spin text-muted-foreground" />
          </div>
        ) : comments.length === 0 ? (
          <p className="my-3 text-center text-sm text-muted-foreground">{t("noComments")}</p>
        ) : (
          <div className="mb-4 flex flex-col gap-4">
            {comments.map((comment) => {
              const isEditing = editingId === comment.id;
              const isAuthor = comment.author.id === currentUserId;
              const isFromDuplicate = !!comment.originTicket && comment.originTicket.id !== ticketId;

              return (
                <div key={comment.id}>
                  <div className="flex items-start gap-2.5">
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-primary"
                      style={{ backgroundColor: "hsl(var(--primary) / 0.15)" }}
                    >
                      {initials(comment.author.name, comment.author.email)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-foreground">
                          {comment.author.name ?? comment.author.email}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-muted-foreground">
                            {formatCommentRelTime(comment.createdAt)}
                          </span>
                          {comment.editedAt && (
                            <span className="text-[10px] italic text-muted-foreground">
                              ({t("edited")})
                            </span>
                          )}
                          {!isFromDuplicate && canEdit(comment, currentUserId) && !isEditing && (
                            <button
                              type="button"
                              onClick={() => startEdit(comment)}
                              aria-label={t("editCommentAria")}
                              className="flex min-h-[44px] min-w-[44px] items-center justify-center border-0 bg-transparent p-2"
                            >
                              <Pencil size={12} className="text-muted-foreground" />
                            </button>
                          )}
                          {!isFromDuplicate && isAuthor && !isEditing && confirmDeleteId !== comment.id && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(comment.id)}
                              aria-label={t("deleteCommentAria")}
                              className="flex min-h-[44px] min-w-[44px] items-center justify-center border-0 bg-transparent p-2"
                            >
                              <Trash2 size={12} className="text-muted-foreground" />
                            </button>
                          )}
                        </div>
                      </div>

                      {isFromDuplicate && comment.originTicket && (
                        <div className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                          <Link2 size={10} aria-hidden className="shrink-0" />
                          <span className="min-w-0 truncate">
                            {t("commentFromDuplicate", {
                              ref: comment.originTicket.ref,
                              title: comment.originTicket.title,
                            })}
                          </span>
                        </div>
                      )}

                      {isEditing ? (
                        <div className="mt-1.5">
                          <MentionTextarea
                            value={editBody}
                            onChange={setEditBody}
                            rows={3}
                            aria-label={t("editCommentAria")}
                            className="w-full rounded-lg border border-primary/40 bg-card p-2 font-sans text-sm outline-none"
                          />
                          <div className="mt-1.5 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void saveEdit(comment.id)}
                              disabled={editSaving || !editBody.trim()}
                              className="flex items-center gap-1 rounded-md border-0 bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                            >
                              {editSaving && <Loader2 size={11} className="tct-spin" />}
                              {t("saveComment")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded-md border-0 bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground"
                            >
                              {tCommon("cancel")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
                          {renderRichText(comment.body)}
                        </p>
                      )}

                      {confirmDeleteId === comment.id && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2">
                          <span className="text-xs font-medium text-destructive">{t("confirmDeleteComment")}</span>
                          <div className="flex shrink-0 gap-1.5">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={deleting}
                              className="rounded-md border-0 bg-muted px-2.5 py-1 text-[11px] font-semibold"
                            >
                              {tCommon("cancel")}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(comment.id)}
                              disabled={deleting}
                              className="flex items-center gap-1 rounded-md border-0 bg-destructive px-2.5 py-1 text-[11px] font-semibold text-destructive-foreground"
                            >
                              {deleting && <Loader2 size={10} className="tct-spin" />}
                              {t("deleteComment")}
                            </button>
                          </div>
                        </div>
                      )}

                      {comment.attachments.length > 0 && (
                        <AttachmentGrid
                          attachments={comment.attachments}
                          ticketId={ticketId}
                          commentId={comment.id}
                          onAnnotationSaved={handleAnnotationSaved}
                          formatTime={formatCommentRelTime}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-border pt-3.5">
          <MentionTextarea
            value={newBody}
            onChange={setNewBody}
            placeholder={t("addCommentPlaceholder")}
            rows={2}
            className="w-full rounded-[10px] border border-border bg-card px-3 py-2 font-sans text-sm text-foreground outline-none"
            aria-label={t("addCommentAria")}
            onImagePaste={(file) => {
              const mime = file.type || "application/octet-stream";
              if (mime.startsWith("video/") && file.size > VIDEO_SIZE_LIMIT) {
                toast.error(t("videoTooLarge", { name: file.name || "image" }));
                return;
              }
              setNewMedia((p) => {
                if (p.length >= 10) return p;
                return [
                  ...p,
                  {
                    file,
                    localUrl: URL.createObjectURL(file),
                    mimeType: mime,
                    caption: "",
                  },
                ];
              });
            }}
          />

          {newMedia.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {newMedia.map((m, i) => (
                <div
                  key={i}
                  className="relative h-[60px] w-[60px] shrink-0 overflow-hidden rounded-lg border border-border"
                >
                  {m.mimeType.startsWith("image/") && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={m.localUrl} alt="" className="h-full w-full object-cover" />
                  )}
                  {m.mimeType.startsWith("video/") && (
                    <div className="flex h-full w-full items-center justify-center bg-[#111]">
                      <Video size={18} className="text-white" />
                    </div>
                  )}
                  {m.mimeType.startsWith("audio/") && (
                    <div className="flex h-full w-full items-center justify-center bg-muted">
                      <Mic size={18} className="text-muted-foreground" />
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={t("removeAttachmentAria")}
                    onClick={() => setNewMedia((p) => p.filter((_, j) => j !== i))}
                    className="absolute right-0.5 top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-0 bg-black/60 p-0"
                  >
                    <X size={10} className="text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex gap-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,image/heic,image/heif,video/*,audio/*"
                multiple
                className="hidden"
                onChange={handleLibraryChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={newMedia.length >= 10}
                style={MEDIA_BTN}
                aria-label={t("libraryAria")}
              >
                <Images size={14} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canPost}
              className="flex min-h-[44px] items-center gap-1.5 rounded-lg border-0 px-4 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                color: canPost ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                backgroundColor: canPost ? "hsl(var(--primary))" : "hsl(var(--muted))",
              }}
            >
              {submitting && <Loader2 size={13} className="tct-spin" />}
              {uploadProgress
                ? t("uploadingProgress", {
                    current: uploadProgress.current,
                    total: uploadProgress.total,
                  })
                : t("postComment")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
