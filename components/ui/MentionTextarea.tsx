"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { getClipboardImageFiles } from "@/lib/clipboard-image-paste";

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
}

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  "aria-label"?: string;
  /** Exposes the inner textarea (e.g. focus when starting voice dictation). */
  textFieldRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** When the user pastes a clipboard image (e.g. screenshot), receives the file(s). */
  onImagePaste?: (file: File) => void;
}

// Fetch all workspace users once and cache for the session
let cachedMembers: TeamMember[] | null = null;
async function fetchTeamMembers(): Promise<TeamMember[]> {
  if (cachedMembers) return cachedMembers;
  try {
    const res = await fetch("/api/tickets/assignees");
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: TeamMember[] };
    cachedMembers = data.data ?? [];
    return cachedMembers;
  } catch {
    return [];
  }
}

function displayName(m: TeamMember): string {
  return m.name?.trim() || m.email.split("@")[0] || m.email;
}

/** Strip @[Name](id) → @Name for display in the textarea */
function toDisplay(data: string): string {
  return data.replace(/@\[([^\]]+)\]\([^)]+\)/g, "@$1");
}

/** Extract { name → id } from a data-format string */
function extractMentionMap(data: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /@\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(data)) !== null) {
    if (m[1] && m[2]) map.set(m[1], m[2]);
  }
  return map;
}

/**
 * Rebuild data format from display text using the mention map.
 * Replaces @Name (followed by space or end) with @[Name](id).
 */
function reconstructData(display: string, mentionMap: Map<string, string>): string {
  if (mentionMap.size === 0) return display;
  let result = display;
  for (const [name, id] of mentionMap) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`@${escaped}(?=\\s|$)`, "g"),
      `@[${name}](${id})`
    );
  }
  return result;
}

export function MentionTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled,
  style,
  className,
  "aria-label": ariaLabel,
  textFieldRef,
  onImagePaste,
}: MentionTextareaProps) {
  const listId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!textFieldRef) return;
    const el = textareaRef.current;
    textFieldRef.current = el;
    return () => {
      if (textFieldRef.current === el) textFieldRef.current = null;
    };
  }, [textFieldRef]);

  // The textarea shows display format (@Name); parent receives data format (@[Name](id))
  const [displayVal, setDisplayVal] = useState(() => toDisplay(value));
  const mentionMapRef = useRef<Map<string, string>>(extractMentionMap(value));

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [query, setQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Load team members on mount
  useEffect(() => {
    void fetchTeamMembers().then(setMembers);
  }, []);

  // Sync displayVal if value prop is reset externally (e.g. form clear)
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (value !== prevValueRef.current) {
      const currentDisplay = reconstructData(displayVal, mentionMapRef.current);
      // Only sync from prop if the parent changed it to something genuinely different
      if (currentDisplay !== value) {
        setDisplayVal(toDisplay(value));
        mentionMapRef.current = extractMentionMap(value);
      }
      prevValueRef.current = value;
    }
  }, [value, displayVal]);

  const filtered = members.filter((m) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return displayName(m).toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  }).slice(0, 8);

  // Position the dropdown — uses visualViewport for accurate mobile/keyboard coords.
  //
  // On iOS Safari, getBoundingClientRect() returns layout-viewport coordinates,
  // but position:fixed is anchored to the VISUAL viewport (which shrinks when the
  // keyboard opens). We must convert to visual-viewport coords before using them
  // as CSS top/left values on a fixed-position element.
  //
  //   layoutY → visualY:  subtract visualViewport.offsetTop
  //   position:fixed top  = visualY  (no further conversion needed)
  const updateDropdownPos = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const rect = ta.getBoundingClientRect();

    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const vvHeight = vv?.height ?? window.innerHeight;
    const vvOffsetTop = vv?.offsetTop ?? 0;

    // Convert layout-viewport coords → visual-viewport coords
    const visTop = rect.top - vvOffsetTop;
    const visBottom = rect.bottom - vvOffsetTop;

    const dropdownHeight = Math.min(filtered.length * 48 + 28, 280);
    const spaceBelow = vvHeight - visBottom;
    const spaceAbove = visTop;

    // finalTop is always in VISUAL-VIEWPORT coords (correct for position:fixed on iOS)
    let finalTop: number;
    if (spaceBelow >= dropdownHeight + 8 && spaceBelow >= 140) {
      finalTop = visBottom + 4;
    } else if (spaceAbove >= dropdownHeight + 8) {
      finalTop = visTop - dropdownHeight - 4;
    } else {
      // Tight — prefer above, clamp to visible area
      finalTop = Math.max(4, visTop - dropdownHeight - 4);
    }

    setDropdownPos({
      top: finalTop,
      left: Math.min(rect.left, window.innerWidth - 240),
    });
  }, [filtered.length]);

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
    setQuery("");
    setMentionStart(null);
    setHighlightedIdx(0);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newDisplay = e.target.value;
    setDisplayVal(newDisplay);

    // Notify parent with data format
    const dataVal = reconstructData(newDisplay, mentionMapRef.current);
    onChange(dataVal);

    // Detect in-progress @ trigger in the display text
    const cursor = e.target.selectionStart ?? newDisplay.length;
    const textUpToCursor = newDisplay.slice(0, cursor);
    const match = /(?<![)\]])\B@([\w. ]*)$/.exec(textUpToCursor);

    if (!match) {
      closeDropdown();
      return;
    }

    const atIdx = match.index;
    // Only treat as a mention trigger if no word gap (space) after the most recent @
    const fragment = match[1] ?? "";
    if (fragment.includes("  ")) {
      // double space — user moved past mention intent
      closeDropdown();
      return;
    }

    setQuery(fragment.trimEnd());
    setMentionStart(atIdx);
    setHighlightedIdx(0);
    setShowDropdown(true);
    updateDropdownPos();
  }, [onChange, closeDropdown, updateDropdownPos]);

  const insertMention = useCallback((member: TeamMember) => {
    const ta = textareaRef.current;
    if (!ta || mentionStart === null) return;
    const name = displayName(member);

    // Work in DISPLAY space — textarea contains display text
    const displayBefore = displayVal.slice(0, mentionStart);
    const displayAfter = displayVal.slice(ta.selectionStart ?? displayVal.length);
    const newDisplay = `${displayBefore}@${name} ${displayAfter}`;
    setDisplayVal(newDisplay);

    // Register this mention so reconstructData can encode it
    mentionMapRef.current = new Map(mentionMapRef.current).set(name, member.id);

    // Notify parent with full data format
    const dataVal = reconstructData(newDisplay, mentionMapRef.current);
    onChange(dataVal);

    closeDropdown();

    // Move cursor to just after the inserted mention
    requestAnimationFrame(() => {
      ta.focus();
      const newCursor = displayBefore.length + name.length + 2; // @ + name + space
      ta.setSelectionRange(newCursor, newCursor);
    });
  }, [displayVal, mentionStart, onChange, closeDropdown]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onImagePaste || disabled) return;
      const images = getClipboardImageFiles(e);
      if (images.length === 0) return;
      e.preventDefault();
      for (const file of images) {
        onImagePaste(file);
      }
    },
    [onImagePaste, disabled]
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showDropdown || filtered.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      const selected = filtered[highlightedIdx];
      if (selected) {
        e.preventDefault();
        insertMention(selected);
      }
    } else if (e.key === "Escape") {
      closeDropdown();
    }
  }, [showDropdown, filtered, highlightedIdx, insertMention, closeDropdown]);

  // Reposition when the virtual keyboard opens/closes on mobile
  useEffect(() => {
    if (!showDropdown) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => updateDropdownPos();
    vv.addEventListener("resize", handler);
    vv.addEventListener("scroll", handler);
    return () => {
      vv.removeEventListener("resize", handler);
      vv.removeEventListener("scroll", handler);
    };
  }, [showDropdown, updateDropdownPos]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        textareaRef.current && !textareaRef.current.contains(e.target as Node)
      ) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown, closeDropdown]);

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={textareaRef}
        value={displayVal}
        onChange={handleChange}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        style={style}
        className={className}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={showDropdown ? listId : undefined}
      />

      {showDropdown && filtered.length > 0 && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          id={listId}
          role="listbox"
          aria-label="Team members"
          style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            zIndex: 99999,
            backgroundColor: "var(--neutral-0)",
            border: "1px solid var(--neutral-200)",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            minWidth: 220,
            maxWidth: 320,
            overflow: "hidden",
          }}
        >
          {filtered.map((m, idx) => {
            const name = displayName(m);
            const isHighlighted = idx === highlightedIdx;
            return (
              <div
                key={m.id}
                role="option"
                aria-selected={isHighlighted}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(m);
                }}
                onMouseEnter={() => setHighlightedIdx(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  cursor: "pointer",
                  backgroundColor: isHighlighted ? "var(--primary-50)" : "transparent",
                  borderBottom: idx < filtered.length - 1 ? "1px solid var(--neutral-100)" : "none",
                  transition: "background-color 0.1s",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    backgroundColor: isHighlighted ? "var(--primary-200)" : "var(--neutral-150, var(--neutral-100))",
                    color: isHighlighted ? "var(--primary-700)" : "var(--neutral-600)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {name.slice(0, 2).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--neutral-900)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--neutral-500)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.email}
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ padding: "5px 12px", fontSize: 10, color: "var(--neutral-400)", borderTop: "1px solid var(--neutral-100)" }}>
            ↵ select · esc dismiss
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
