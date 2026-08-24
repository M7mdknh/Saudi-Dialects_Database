"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { batchReducer, initialBatchState } from "./batch-reducer";
import { WordCard } from "./WordCard";
import { submissionBatchSchema } from "./schema";
import { submitBatch } from "./submit-batch";
import {
  clearDraft,
  getOrCreateIdempotencyKey,
  loadDraft,
  rotateIdempotencyKey,
  saveDraft,
} from "./draft-storage";
import { messageForCode } from "./errors";
import { mapZodIssuesToFieldErrors } from "./field-errors";
import { CONSENT_VERSION, MAX_WORD_CARDS } from "./constants";
import { Button } from "@/components/ui/Button";
import { Turnstile } from "./Turnstile";

type Status = "idle" | "submitting" | "success" | "error";

export function ContributionForm({
  turnstileSiteKey,
}: {
  turnstileSiteKey?: string;
}) {
  const [state, dispatch] = useReducer(
    batchReducer,
    undefined,
    initialBatchState,
  );
  const [status, setStatus] = useState<Status>("idle");
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, Record<string, string>>
  >({});
  const [draftRestored, setDraftRestored] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const idempotencyKey = useRef<string>("");
  const firstErrorRef = useRef<HTMLDivElement | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    // Reads a browser-only external system (localStorage) once on mount to
    // hydrate form state; this is not derivable via a useState initializer
    // without a server/client hydration mismatch.
    idempotencyKey.current = getOrCreateIdempotencyKey();
    const draft = loadDraft();
    if (draft && draft.words.length > 0) {
      dispatch({
        type: "LOAD_DRAFT",
        words: draft.words,
        consent: draft.consent,
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftRestored(true);
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveDraft({ words: state.words, consent: state.consent });
  }, [state]);

  useEffect(() => {
    if (Object.keys(fieldErrors).length > 0 && firstErrorRef.current) {
      firstErrorRef.current.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
      const input = firstErrorRef.current.querySelector("input, textarea");
      if (input instanceof HTMLElement) input.focus();
    }
  }, [fieldErrors]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setErrorCode(undefined);

    const payload = {
      idempotencyKey: idempotencyKey.current,
      consent: state.consent as true,
      consentVersion: CONSENT_VERSION,
      words: state.words,
      turnstileToken,
    };

    const parsed = submissionBatchSchema.safeParse(payload);
    if (!parsed.success) {
      const mapped = mapZodIssuesToFieldErrors(parsed.error);
      setFieldErrors(mapped);
      setErrorCode("VALIDATION_FAILED");
      setStatus("error");
      return;
    }

    setStatus("submitting");
    const result = await submitBatch(parsed.data);
    if (result.ok) {
      clearDraft();
      rotateIdempotencyKey();
      setStatus("success");
      return;
    }

    setErrorCode(result.code);
    if (result.fieldErrors) setFieldErrors(result.fieldErrors);
    setStatus("error");
  }

  function startAnother() {
    dispatch({ type: "RESET" });
    idempotencyKey.current = getOrCreateIdempotencyKey();
    setTurnstileToken(undefined);
    setStatus("idle");
    setDraftRestored(false);
  }

  if (status === "success") {
    return (
      <div className="border-border bg-surface mx-auto flex max-w-lg flex-col items-center gap-4 rounded-2xl border p-8 text-center">
        <h1 className="text-success text-xl font-bold">
          تم إرسال مساهمتك بنجاح
        </h1>
        <p className="text-foreground/80">
          شكراً لمساهمتك! سيراجع فريقنا الكلمات قبل إضافتها إلى مجموعة البيانات.
        </p>
        <Button type="button" onClick={startAnother}>
          إرسال مساهمة أخرى
        </Button>
      </div>
    );
  }

  const disableAdd = state.words.length >= MAX_WORD_CARDS;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6"
    >
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-foreground text-2xl font-bold">
          ساهم بكلمة من لهجتك
        </h1>
        <p className="text-foreground/70">
          ساعدنا في بناء بيانات تفهم تنوّع لهجاتنا العربية.
        </p>
      </header>

      {draftRestored ? (
        <p
          role="status"
          className="bg-surface-muted text-foreground/80 rounded-lg px-3 py-2 text-sm"
        >
          تمت استعادة مسودة محفوظة من زيارة سابقة.
        </p>
      ) : null}

      {status === "error" && errorCode ? (
        <div
          role="alert"
          className="border-danger bg-danger/10 text-danger rounded-lg border px-3 py-2 text-sm font-medium"
        >
          {messageForCode(errorCode)}
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {state.words.map((card, index) => {
          const cardErrors = fieldErrors[String(index)];
          return (
            <div
              key={card.clientId}
              ref={index === 0 && cardErrors ? firstErrorRef : undefined}
            >
              <WordCard
                index={index}
                total={state.words.length}
                card={card}
                errors={cardErrors}
                canRemove={state.words.length > 1}
                onUpdateField={(field, value) =>
                  dispatch({
                    type: "UPDATE_WORD",
                    clientId: card.clientId,
                    field,
                    value,
                  })
                }
                onUpdateExample={(i, value) =>
                  dispatch({
                    type: "UPDATE_EXAMPLE",
                    clientId: card.clientId,
                    index: i,
                    value,
                  })
                }
                onAddExample={() =>
                  dispatch({ type: "ADD_EXAMPLE", clientId: card.clientId })
                }
                onRemoveExample={(i) =>
                  dispatch({
                    type: "REMOVE_EXAMPLE",
                    clientId: card.clientId,
                    index: i,
                  })
                }
                onRemove={() =>
                  dispatch({ type: "REMOVE_WORD", clientId: card.clientId })
                }
                onMoveUp={() =>
                  dispatch({
                    type: "MOVE_WORD",
                    clientId: card.clientId,
                    direction: "up",
                  })
                }
                onMoveDown={() =>
                  dispatch({
                    type: "MOVE_WORD",
                    clientId: card.clientId,
                    direction: "down",
                  })
                }
              />
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="secondary"
        onClick={() => dispatch({ type: "ADD_WORD" })}
        disabled={disableAdd}
      >
        + إضافة كلمة أخرى
      </Button>
      {disableAdd ? (
        <p className="text-foreground/60 text-center text-xs">
          يمكنك إرسال هذه الدفعة ثم إضافة المزيد من الكلمات في مساهمة جديدة.
        </p>
      ) : null}

      <label className="border-border bg-surface-muted flex items-start gap-3 rounded-xl border p-4 text-sm">
        <input
          type="checkbox"
          checked={state.consent}
          onChange={(e) =>
            dispatch({ type: "SET_CONSENT", value: e.target.checked })
          }
          className="accent-accent mt-0.5 h-5 w-5 shrink-0"
          aria-describedby="consent-text"
        />
        <span id="consent-text">
          أوافق على استخدام هذه المساهمة في بناء مجموعة بيانات لهجات مفتوحة، دون
          مشاركة أي بيانات تعريف شخصية.
        </span>
      </label>

      {turnstileSiteKey ? (
        <Turnstile siteKey={turnstileSiteKey} onToken={setTurnstileToken} />
      ) : null}

      <Button
        type="submit"
        disabled={status === "submitting" || !state.consent}
        className="w-full"
      >
        {status === "submitting" ? "جارٍ الإرسال…" : "إرسال المساهمة"}
      </Button>
    </form>
  );
}
