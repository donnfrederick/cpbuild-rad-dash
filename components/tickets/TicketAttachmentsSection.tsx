"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Paperclip, Pencil, X, Loader2, Images, Video } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { ImageAnnotationEditor } from "./ImageAnnotationEditor";
import { ImageAnnotationOverlay } from "./ImageAnnotationOverlay";
import type { ImageAnnotationPayload } from "@/lib/image-annotation-schema";
import { parseImageAnnotation } from "@/lib/image-annotation-schema";
import type { AnnotationSaveResult } from "./ImageAnnotationEditor";

export interface TicketAttachment {
  id: string;
  storageKey: string;
  storageUrl: string;
  mimeType: string;
  fileSizeBytes: number | null;
  caption: string | null;
  imageAnnotation: ImageAnnotationPayload | null;
  lastMarkedById: string | null;
  lastMarkedAt: string | null;
  lastMarkedBy: { id: string; name: string | null; email: string } | null;
  createdAt: string;
}

interface TicketAttachmentsSectionProps {
  ticketId: string;
  currentUserId?: string;
}

const VIDEO_SIZE_LIMIT = 50 * 1024 * 1024;

function formatRelTime(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getInitials(nameOrEmail: string): string {
  const parts = nameOrEmail.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return nameOrEmail.slice(0, 2).toUpperCase();
}

export function TicketAttachmentsSection({ ticketId }: TicketAttachmentsSectionProps) {
  const t = useTranslations("tickets");

  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [annotatingIdx, setAnnotatingIdx] = useState<number | null>(null);
  const [savingAnnotation, setSavingAnnotation] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const baseUrl = `/api/tickets/${ticketId}/attachments`;

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(baseUrl);
      if (!res.ok) return;
      const data = (await res.json()) as { attachments: TicketAttachment[] };
      setAttachments(
        (data.attachments ?? []).map((a) => ({
          ...a,
          imageAnnotation: parseImageAnnotation(a.imageAnnotation as unknown),
          lastMarkedBy: a.lastMarkedBy ?? null,
        }))
      );
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    void fetchAttachments();
  }, [fetchAttachments]);

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress({ current: 0, total: files.length });

    const keys: string[] = [];
    const urls: string[] = [];
    const mimes: string[] = [];
    const sizes: number[] = [];
    const captions: string[] = [];

    for (let i = 0; i < files.length; i++) {
      setUploadProgress({ current: i + 1, total: files.length });
      const file = files[i];
      const mime = file.type || "application/octet-stream";
      if (mime.startsWith("video/") && file.size > VIDEO_SIZE_LIMIT) {
        toast.error(t("videoTooLarge", { name: file.name }));
        continue;
      }
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("type", "tickets");
        const res = await fetch("/api/upload/field-media", { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as {
          storageKey: string;
          storageUrl: string;
          mimeType: string;
          fileSizeBytes: number;
        };
        keys.push(data.storageKey);
        urls.push(data.storageUrl);
        mimes.push(data.mimeType);
        sizes.push(data.fileSizeBytes);
        captions.push("");
      } catch {
        toast.error(t("uploadFailedChunk", { n: i + 1 }));
      }
    }

    setUploadProgress(null);

    if (keys.length > 0) {
      try {
        const res = await fetch(baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attachmentKeys: keys,
            attachmentUrls: urls,
            attachmentMimeTypes: mimes,
            attachmentFileSizeBytes: sizes,
            attachmentCaptions: captions,
          }),
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { attachments: TicketAttachment[] };
        setAttachments((prev) => [
          ...prev,
          ...(data.attachments ?? []).map((a) => ({
            ...a,
            imageAnnotation: parseImageAnnotation(a.imageAnnotation as unknown),
            lastMarkedBy: a.lastMarkedBy ?? null,
          })),
        ]);
      } catch {
        toast.error(t("commentPostFailed"));
      }
    }

    setUploading(false);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (e.target) e.target.value = "";
    await handleFiles(files);
  }

  async function handleAnnotationSave(idx: number, result: AnnotationSaveResult) {
    setAnnotatingIdx(null);
    if (!("kind" in result) || result.kind !== "layered") return;

    const attachment = attachments[idx];
    if (!attachment) return;

    setSavingAnnotation((p) => ({ ...p, [attachment.id]: true }));
    try {
      const res = await fetch(`${baseUrl}/${attachment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageAnnotation: result.annotation }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to save annotation");
        return;
      }
      const updated = (await res.json()) as TicketAttachment;
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === attachment.id
            ? {
                ...a,
                imageAnnotation: parseImageAnnotation(updated.imageAnnotation as unknown),
                lastMarkedAt: updated.lastMarkedAt,
                lastMarkedBy: updated.lastMarkedBy ?? null,
              }
            : a
        )
      );
    } catch {
      toast.error("Failed to save annotation");
    } finally {
      setSavingAnnotation((p) => ({ ...p, [attachment.id]: false }));
    }
  }

  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const videos = attachments.filter((a) => a.mimeType.startsWith("video/"));
  const others = attachments.filter(
    (a) => !a.mimeType.startsWith("image/") && !a.mimeType.startsWith("video/"),
  );

  const isAnnotating = annotatingIdx !== null;
  const annotatingAttachment = annotatingIdx !== null ? images[annotatingIdx] : null;

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
          <Paperclip size={13} />
          {t("attachmentsSection")}
          {attachments.length > 0 ? ` (${attachments.length})` : ""}
        </span>
        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,image/heic,image/heif,video/*,audio/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
            aria-label={t("addAttachmentAria")}
          >
            {uploading ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                {uploadProgress
                  ? t("uploadingProgress", { current: uploadProgress.current, total: uploadProgress.total })
                  : "Uploading…"}
              </>
            ) : (
              <>
                <Images size={12} />
                {t("addAttachment")}
              </>
            )}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-3">
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : attachments.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground">{t("noAttachments")}</p>
      ) : (
        <div>
          {images.length > 0 && (
            <div
              className="mb-2 grid gap-1.5"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}
            >
              {images.map((a, i) => (
                <div key={a.id} className="group flex flex-col">
                  <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                    <button
                      type="button"
                      className="h-full w-full"
                      onClick={() => setLightboxIdx(i)}
                      aria-label={a.caption ?? t("attachmentLightboxImage")}
                    >
                      <ImageAnnotationOverlay
                        src={a.storageUrl}
                        annotation={a.imageAnnotation}
                        alt={a.caption ?? ""}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </button>

                    {/* Pencil button — always visible */}
                    <button
                      type="button"
                      aria-label="Annotate image"
                      onClick={(e) => { e.stopPropagation(); setAnnotatingIdx(i); }}
                      disabled={savingAnnotation[a.id]}
                      className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full border-0 bg-black/60"
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
                        {getInitials(a.lastMarkedBy.name ?? a.lastMarkedBy.email)}
                        <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow opacity-0 transition-opacity group-hover:opacity-100">
                          {a.lastMarkedBy.name ?? a.lastMarkedBy.email}
                        </span>
                      </span>
                      {a.lastMarkedAt && (
                        <span className="opacity-70">· {formatRelTime(a.lastMarkedAt)}</span>
                      )}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {videos.length > 0 && (
            <div className="mb-2 flex flex-col gap-2">
              {videos.map((a) => {
                const fileName = a.caption || a.storageKey.split("/").pop() || "Recording";
                return (
                  <div key={a.id} className="overflow-hidden rounded-lg border border-border bg-card">
                    <video
                      src={a.storageUrl}
                      controls
                      preload="metadata"
                      className="w-full max-h-64 bg-black"
                    />
                    <div className="flex items-center gap-2 px-3 py-2">
                      <Video size={13} className="shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <a
                          href={a.storageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-sm text-foreground underline-offset-2 hover:underline"
                        >
                          {fileName}
                        </a>
                        {a.fileSizeBytes ? (
                          <p className="text-[11px] text-muted-foreground">{formatBytes(a.fileSizeBytes)}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {others.map((a) => (
            <div key={a.id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <Paperclip size={13} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <a
                  href={a.storageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-sm text-foreground underline-offset-2 hover:underline"
                >
                  {a.caption || a.storageKey.split("/").pop() || "File"}
                </a>
                {a.fileSizeBytes && (
                  <p className="text-[11px] text-muted-foreground">{formatBytes(a.fileSizeBytes)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxIdx !== null && images[lightboxIdx] && (
        <div
          className="fixed inset-0 z-320 flex flex-col items-center justify-center bg-black/90"
          role="dialog"
          aria-modal="true"
          aria-label={t("attachmentLightboxImage")}
        >
          <button
            type="button"
            onClick={() => setLightboxIdx(null)}
            aria-label={t("attachmentLightboxClose")}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border-0 bg-white/15 text-white"
          >
            <X size={18} />
          </button>
          <button
            type="button"
            aria-label="Annotate image"
            onClick={() => {
              const imgIdx = lightboxIdx;
              setLightboxIdx(null);
              setAnnotatingIdx(imgIdx);
            }}
            className="absolute right-16 top-4 flex h-9 w-9 items-center justify-center rounded-full border-0 bg-white/15 text-white"
          >
            <Pencil size={16} />
          </button>
          <div className="flex max-h-[80dvh] max-w-[92vw] items-center justify-center">
            <ImageAnnotationOverlay
              src={images[lightboxIdx].storageUrl}
              annotation={images[lightboxIdx].imageAnnotation}
              alt=""
              style={{ maxHeight: "80dvh", maxWidth: "92vw", borderRadius: 8 }}
            />
          </div>
          {images[lightboxIdx].caption && (
            <p className="mt-2 text-sm text-white/70">{images[lightboxIdx].caption}</p>
          )}
        </div>
      )}

      {/* Annotation editor */}
      {isAnnotating && annotatingAttachment && (
        <ImageAnnotationEditor
          src={annotatingAttachment.storageUrl}
          exportMode="layered"
          initialAnnotation={annotatingAttachment.imageAnnotation}
          onSave={(result) => void handleAnnotationSave(annotatingIdx!, result)}
          onClose={() => setAnnotatingIdx(null)}
        />
      )}
    </div>
  );
}
