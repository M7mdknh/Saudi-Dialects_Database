"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: (errorCode?: string) => void;
          "expired-callback"?: () => void;
          "timeout-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

export type TurnstileStatus =
  "loading" | "verified" | "error" | "expired" | "timeout";

export interface TurnstileHandle {
  /** Forces a fresh challenge/token. Used after a failed submission and after a successful one (idempotency rotation). */
  reset: () => void;
}

interface TurnstileProps {
  siteKey: string;
  onToken: (token: string) => void;
  /** Fires on every widget state change so the form can gate the submit button and show retry UI. */
  onStatusChange?: (status: TurnstileStatus, errorCode?: string) => void;
}

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  "110100": "إعداد التحقق الأمني لهذا الموقع غير صحيح.",
  "110110": "إعداد التحقق الأمني لهذا الموقع غير صحيح.",
  "110200": "هذا المضيف غير مصرّح له باستخدام التحقق الأمني.",
  "200500": "تعذّر تحميل نافذة التحقق الأمني.",
};

function messageForErrorCode(code?: string): string {
  if (code) {
    if (code in KNOWN_ERROR_MESSAGES) return KNOWN_ERROR_MESSAGES[code];
    if (code.startsWith("3") || code.startsWith("6")) {
      return "تعذّر إكمال التحقق الأمني.";
    }
  }
  return "تعذّر تحميل التحقق الأمني.";
}

/** Renders the Cloudflare Turnstile widget. No-op host when no site key is configured (local dev). */
export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(
  function Turnstile({ siteKey, onToken, onStatusChange }, ref) {
    const containerId = useId();
    const widgetId = useRef<string | null>(null);
    const [status, setStatus] = useState<TurnstileStatus>("loading");
    const [errorCode, setErrorCode] = useState<string>();
    const [renderNonce, setRenderNonce] = useState(0);
    const onTokenRef = useRef(onToken);
    onTokenRef.current = onToken;

    useImperativeHandle(ref, () => ({
      reset() {
        if (window.turnstile && widgetId.current) {
          window.turnstile.reset(widgetId.current);
          setStatus("loading");
          setErrorCode(undefined);
        } else {
          setRenderNonce((n) => n + 1);
        }
      },
    }));

    useEffect(() => {
      onStatusChange?.(status, errorCode);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status, errorCode]);

    useEffect(() => {
      if (!siteKey) return;
      let cancelled = false;

      function render() {
        const container = document.getElementById(containerId);
        if (!container || !window.turnstile) return;
        container.innerHTML = "";
        setStatus("loading");
        setErrorCode(undefined);
        widgetId.current = window.turnstile.render(container, {
          sitekey: siteKey,
          callback: (token) => {
            if (cancelled) return;
            setStatus("verified");
            setErrorCode(undefined);
            onTokenRef.current(token);
          },
          "error-callback": (code) => {
            if (cancelled) return;
            setStatus("error");
            setErrorCode(code);
          },
          "expired-callback": () => {
            if (cancelled) return;
            setStatus("expired");
          },
          "timeout-callback": () => {
            if (cancelled) return;
            setStatus("timeout");
          },
        });
      }

      if (window.turnstile) {
        render();
        return () => {
          cancelled = true;
        };
      }

      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${SCRIPT_SRC}"]`,
      );
      const script = existing ?? document.createElement("script");
      const onScriptError = () => {
        if (!cancelled) {
          setStatus("error");
          setErrorCode("200500");
        }
      };
      if (!existing) {
        script.src = SCRIPT_SRC;
        script.async = true;
        script.addEventListener("error", onScriptError);
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
      return () => {
        cancelled = true;
        script.removeEventListener("load", render);
        script.removeEventListener("error", onScriptError);
      };
    }, [siteKey, containerId, renderNonce]);

    if (!siteKey) return null;

    const isUnresolved =
      status === "error" || status === "expired" || status === "timeout";
    const hostname =
      typeof window !== "undefined" ? window.location.hostname : "";

    return (
      <div className="flex min-w-0 flex-col gap-2">
        <div
          id={containerId}
          className="max-w-full overflow-hidden"
          data-turnstile-status={status}
        />
        {isUnresolved ? (
          <div
            role="alert"
            className="border-danger bg-danger/10 text-danger flex flex-col items-start gap-2 rounded-lg border px-3 py-2 text-sm"
          >
            <p className="font-medium">
              {status === "expired"
                ? "انتهت صلاحية التحقق الأمني. أعد المحاولة."
                : status === "timeout"
                  ? "استغرق التحقق الأمني وقتاً طويلاً. أعد المحاولة."
                  : `تعذّر تحميل التحقق الأمني. ${messageForErrorCode(errorCode)} أعد المحاولة.`}
            </p>
            <button
              type="button"
              onClick={() => setRenderNonce((n) => n + 1)}
              className="min-h-11 rounded-lg border border-current px-3 py-1.5 font-semibold"
            >
              إعادة تحميل التحقق
            </button>
            {errorCode || hostname ? (
              <details className="text-danger/70 text-xs">
                <summary>تفاصيل تقنية للمطوّر</summary>
                <p>
                  {errorCode ? `رمز الخطأ: ${errorCode}` : null}
                  {errorCode && hostname ? " — " : null}
                  {hostname
                    ? `المضيف الحالي: ${hostname} (أضِفه في Cloudflare Turnstile › Settings › Hostname Management إذا كان الخطأ 110200)`
                    : null}
                </p>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  },
);
