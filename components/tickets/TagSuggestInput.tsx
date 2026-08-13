"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  capCurrentTagToken,
  normalizeTagName,
  replaceCurrentTagToken,
  splitTagInputPrefixAndCurrentToken,
} from "@/lib/tag-normalize";
import { cn } from "@/lib/utils";

export interface TagSuggestInputProps {
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
  id?: string;
  /** Normalized tag names to hide from suggestions (e.g. already on the ticket). */
  excludeNormalizedNames: ReadonlySet<string>;
}

export function TagSuggestInput({
  value,
  onChange,
  onKeyDown,
  disabled,
  className,
  placeholder,
  "aria-label": ariaLabel,
  id: idProp,
  excludeNormalizedNames,
}: TagSuggestInputProps): React.ReactElement {
  const t = useTranslations("tickets");
  const genId = useId();
  const listboxId = `${genId}-suggestions`;
  const inputId = idProp ?? `${genId}-input`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ id: string; name: string }>>([]);
  const [highlight, setHighlight] = useState(0);

  const { currentToken } = splitTagInputPrefixAndCurrentToken(value);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    let stale = false;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const q = currentToken;
      if (!q) {
        setSuggestions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      void fetch(`/api/tags?q=${encodeURIComponent(q)}&limit=20`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("tags"))))
        .then((data: { tags?: Array<{ id: string; name: string }> }) => {
          if (stale) return;
          const raw = data.tags ?? [];
          const filtered = raw.filter((tag) => !excludeNormalizedNames.has(normalizeTagName(tag.name)));
          setSuggestions(filtered);
          setHighlight(0);
        })
        .catch(() => {
          if (!stale) setSuggestions([]);
        })
        .finally(() => {
          if (!stale) setLoading(false);
        });
    }, 200);
    return () => {
      stale = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [currentToken, excludeNormalizedNames]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = useCallback(
    (name: string) => {
      onChange(replaceCurrentTagToken(value, name));
      setOpen(false);
      setSuggestions([]);
    },
    [onChange, value]
  );

  const showList = open && suggestions.length > 0 && !disabled;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showList) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(suggestions.length - 1, h + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
        return;
      }
      if (e.key === "Tab" && !e.shiftKey && suggestions.length > 0) {
        const row = suggestions[highlight];
        if (row) {
          e.preventDefault();
          pick(row.name);
          return;
        }
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div ref={wrapRef} className="relative">
      {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props -- listbox pairing; implicit textbox role still pairs with aria-expanded for SRs */}
      <input
        id={inputId}
        type="text"
        className={className}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={showList ? listboxId : undefined}
        aria-activedescendant={showList ? `${listboxId}-opt-${highlight}` : undefined}
        onChange={(e) => {
          onChange(capCurrentTagToken(e.target.value));
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {showList ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t("tagSuggestionsAria")}
          className={cn(
            "absolute left-0 right-0 top-full z-50 mt-0.5 max-h-48 min-w-[max(100%,18rem)] max-w-[min(96vw,36rem)] overflow-auto rounded-md border border-border bg-card py-1 text-sm shadow-md"
          )}
        >
          {suggestions.map((tag, i) => (
            <li key={tag.id} role="presentation">
              <button
                id={`${listboxId}-opt-${i}`}
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={cn(
                  "flex w-full whitespace-normal break-words px-2 py-1.5 text-left text-foreground hover:bg-muted",
                  i === highlight && "bg-muted"
                )}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(tag.name);
                }}
              >
                {tag.name}
              </button>
            </li>
          ))}
        </ul>
      ) : loading && open && currentToken ? (
        <p className="absolute left-0 top-full z-50 mt-0.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground shadow-md">
          {t("tagSuggestionsLoading")}
        </p>
      ) : null}
    </div>
  );
}
