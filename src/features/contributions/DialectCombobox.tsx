"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toSearchKey } from "@/lib/text/normalize-arabic";
import type { PublicDialectOption } from "./dialects-actions";

const MAIN_GROUP_ORDER = [
  "hijazi",
  "najdi",
  "eastern",
  "northern",
  "southern",
] as const;

interface FlatOption {
  key: string;
  label: string;
  kind: "main" | "local" | "create";
}

interface DialectComboboxProps {
  id: string;
  value: string;
  options: PublicDialectOption[];
  onChange: (value: string) => void;
  error?: string;
}

/**
 * Accessible (WAI-ARIA combobox pattern) searchable + creatable dialect
 * picker. Visitors may select one of the five main Saudi groups, an
 * existing local dialect, or type a new local label — the raw text is
 * always what's stored (see schema.ts `dialect`), so a custom entry is
 * preserved verbatim as the contributor's label and only ever classified
 * later by an admin (classify_submission).
 */
export function DialectCombobox({
  id,
  value,
  options,
  onChange,
  error,
}: DialectComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const mains = useMemo(() => {
    const order: Record<string, number> = Object.fromEntries(
      MAIN_GROUP_ORDER.map((code, i) => [code, i]),
    );
    return options
      .filter((o) => o.parentId === null && o.mainGroupCode !== null)
      .sort(
        (a, b) =>
          (order[a.mainGroupCode ?? ""] ?? 99) -
          (order[b.mainGroupCode ?? ""] ?? 99),
      );
  }, [options]);

  const locals = useMemo(
    () =>
      options
        .filter((o) => o.parentId !== null)
        .sort((a, b) => a.nameAr.localeCompare(b.nameAr, "ar")),
    [options],
  );

  const query = value.trim();
  const queryKey = toSearchKey(query);

  const filteredMains = useMemo(
    () =>
      queryKey
        ? mains.filter((o) => toSearchKey(o.nameAr).includes(queryKey))
        : mains,
    [mains, queryKey],
  );
  const filteredLocals = useMemo(
    () =>
      queryKey
        ? locals.filter((o) => toSearchKey(o.nameAr).includes(queryKey))
        : locals,
    [locals, queryKey],
  );

  const hasExactMatch = useMemo(
    () =>
      queryKey.length > 0 &&
      [...mains, ...locals].some((o) => toSearchKey(o.nameAr) === queryKey),
    [mains, locals, queryKey],
  );

  const showCreateAction = query.length > 0 && !hasExactMatch;

  const flatOptions: FlatOption[] = [
    ...filteredMains.map((o) => ({
      key: o.id,
      label: o.nameAr,
      kind: "main" as const,
    })),
    ...filteredLocals.map((o) => ({
      key: o.id,
      label: o.nameAr,
      kind: "local" as const,
    })),
    ...(showCreateAction
      ? [{ key: "__create__", label: query, kind: "create" as const }]
      : []),
  ];

  // Clamp rather than track in state/effect: the option list changes on
  // every keystroke, and a previously-active index may no longer exist.
  const safeActiveIndex = activeIndex < flatOptions.length ? activeIndex : -1;

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function commit(option: FlatOption) {
    const nextValue =
      option.kind === "create" ? option.label.trim() : option.label;
    if (!nextValue) return;
    onChange(nextValue);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((i) => (i + 1 >= flatOptions.length ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((i) => (i - 1 < 0 ? flatOptions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0 && flatOptions[activeIndex]) {
        e.preventDefault();
        commit(flatOptions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    } else if (e.key === "Home" && open) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End" && open) {
      e.preventDefault();
      setActiveIndex(flatOptions.length - 1);
    }
  }

  const activeId =
    safeActiveIndex >= 0 ? `${listboxId}-opt-${safeActiveIndex}` : undefined;

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-invalid={Boolean(error)}
        autoComplete="off"
        value={value}
        placeholder="ابحث أو اكتب اسم اللهجة"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={`bg-surface text-foreground focus-visible:outline-accent min-h-11 w-full rounded-lg border px-3 py-2 text-base outline-none focus-visible:outline-2 focus-visible:outline-offset-2 ${
          error ? "border-danger" : "border-border"
        }`}
      />

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="قائمة اللهجات"
          className="border-border bg-surface absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border shadow-lg"
        >
          {flatOptions.length === 0 ? (
            <p className="text-foreground/60 px-3 py-3 text-sm">
              لا نتائج مطابقة.
            </p>
          ) : (
            <>
              {filteredMains.length > 0 ? (
                <ComboGroup label="التصنيف الرئيسي">
                  {filteredMains.map((o, i) => (
                    <ComboOption
                      key={o.id}
                      id={`${listboxId}-opt-${i}`}
                      label={o.nameAr}
                      selected={toSearchKey(o.nameAr) === queryKey}
                      active={safeActiveIndex === i}
                      onSelect={() =>
                        commit({ key: o.id, label: o.nameAr, kind: "main" })
                      }
                    />
                  ))}
                </ComboGroup>
              ) : null}

              {filteredLocals.length > 0 ? (
                <ComboGroup label="لهجات محلية">
                  {filteredLocals.map((o, i) => {
                    const flatIndex = filteredMains.length + i;
                    return (
                      <ComboOption
                        key={o.id}
                        id={`${listboxId}-opt-${flatIndex}`}
                        label={o.nameAr}
                        selected={toSearchKey(o.nameAr) === queryKey}
                        active={safeActiveIndex === flatIndex}
                        onSelect={() =>
                          commit({ key: o.id, label: o.nameAr, kind: "local" })
                        }
                      />
                    );
                  })}
                </ComboGroup>
              ) : null}

              {showCreateAction ? (
                <ComboOption
                  id={`${listboxId}-opt-${flatOptions.length - 1}`}
                  label={`استخدام «${query}» كاسم لهجة جديدة`}
                  active={safeActiveIndex === flatOptions.length - 1}
                  onSelect={() =>
                    commit({ key: "__create__", label: query, kind: "create" })
                  }
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ComboGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label}>
      <p className="text-foreground/50 px-3 pt-2 pb-1 text-xs font-semibold">
        {label}
      </p>
      {children}
    </div>
  );
}

function ComboOption({
  id,
  label,
  active,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  active: boolean;
  selected?: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={Boolean(selected)}
      // onMouseDown (not onClick) so the input's blur/close-on-outside-click
      // doesn't fire before the selection is registered — needed for both
      // mouse and touch activation, not just hover.
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      className={`min-h-11 cursor-pointer px-3 py-2.5 text-base ${
        active ? "bg-accent/10" : ""
      } ${selected ? "text-accent font-semibold" : "text-foreground"}`}
    >
      {label}
    </div>
  );
}
