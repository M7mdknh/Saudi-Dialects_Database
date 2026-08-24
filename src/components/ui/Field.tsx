import type { ReactNode } from "react";

interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
}: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-foreground text-sm font-medium">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        ) : (
          <span className="text-foreground/50"> (اختياري)</span>
        )}
      </label>
      {hint ? (
        <p id={hintId} className="text-foreground/60 text-xs">
          {hint}
        </p>
      ) : null}
      <div
        data-field-id={id}
        data-describedby={[hint ? hintId : null, error ? errorId : null]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-danger text-sm font-medium"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
