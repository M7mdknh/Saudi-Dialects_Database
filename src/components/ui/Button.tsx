import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "bg-surface-muted text-foreground border border-border hover:bg-border/40 disabled:opacity-50",
  ghost: "text-foreground hover:bg-surface-muted disabled:opacity-40",
  danger: "bg-danger text-white hover:opacity-90 disabled:opacity-50",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`focus-visible:outline-accent inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${variantClasses[variant]} ${className}`}
    />
  );
}
