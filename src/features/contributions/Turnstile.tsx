"use client";

import { useEffect, useId, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

interface TurnstileProps {
  siteKey: string;
  onToken: (token: string) => void;
}

/** Renders the Cloudflare Turnstile widget. No-op host when no site key is configured. */
export function Turnstile({ siteKey, onToken }: TurnstileProps) {
  const containerId = useId();
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;

    function render() {
      const container = document.getElementById(containerId);
      if (!container || !window.turnstile) return;
      widgetId.current = window.turnstile.render(container, {
        sitekey: siteKey,
        callback: onToken,
      });
    }

    if (window.turnstile) {
      render();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    return () => script.removeEventListener("load", render);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  if (!siteKey) return null;

  return <div id={containerId} className="mt-1" />;
}
