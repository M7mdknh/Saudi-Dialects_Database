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
import {
  Turnstile,
  type TurnstileHandle,
  type TurnstileStatus,
} from "./Turnstile";
import {
  listPublicDialects,
  type PublicDialectOption,
} from "./dialects-actions";
import { GuidedPromptRail } from "@/features/prompts/GuidedPromptRail";
import { getGuidedPrompts } from "@/features/prompts/actions";
import {
  getExclusionIds,
  recordAnsweredId,
  recordShownIds,
} from "@/features/prompts/prompt-history";
import type { GuidedPromptRecord } from "@/features/prompts/types";

type Status = "idle" | "submitting" | "success" | "error";

export function ContributionForm({
  turnstileSiteKey,
  initialPrompts,
  initialDialectOptions,
}: {
  turnstileSiteKey?: string;
  /** null means the server-side load failed — a real error, not a genuine empty result. */
  initialPrompts: GuidedPromptRecord[] | null;
  initialDialectOptions: PublicDialectOption[];
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
  const [turnstileStatus, setTurnstileStatus] =
    useState<TurnstileStatus>("loading");
  const [prompts, setPrompts] = useState(initialPrompts ?? []);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptsError, setPromptsError] = useState(initialPrompts === null);
  const [dialectOptions, setDialectOptions] = useState(initialDialectOptions);
  const idempotencyKey = useRef<string>("");
  const firstErrorRef = useRef<HTMLDivElement | null>(null);
  const firstGuidedCardRef = useRef<HTMLDivElement | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    // Reads a browser-only external system (localStorage) once on mount to
    // hydrate form state; this is not derivable via a useState initializer
    // without a server/client hydration mismatch.
    idempotencyKey.current = getOrCreateIdempotencyKey();
    if (initialPrompts) recordShownIds(initialPrompts.map((p) => p.id));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveDraft({ words: state.words, consent: state.consent });
  }, [state]);

  useEffect(() => {
    if (Object.keys(fieldErrors).length > 0 && firstErrorRef.current) {
      firstErrorRef.current.scrollIntoView?.({
        block: "center",
        behavior: "smooth",
      });
      const input = firstErrorRef.current.querySelector("input, textarea");
      if (input instanceof HTMLElement) input.focus();
    }
  }, [fieldErrors]);

  // The dialect list failing server-side (network blip, cold RPC) is not
  // fatal — the combobox still works as a free-text field — but retry once
  // client-side so a transient failure doesn't permanently hide the taxonomy.
  useEffect(() => {
    if (initialDialectOptions.length > 0) return;
    listPublicDialects()
      .then(setDialectOptions)
      .catch(() => {
        // Non-fatal: dialect field still accepts free text.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshPrompts() {
    setPromptsLoading(true);
    try {
      const next = await getGuidedPrompts(getExclusionIds());
      setPrompts(next);
      setPromptsError(false);
      recordShownIds(next.map((p) => p.id));
    } catch {
      setPromptsError(true);
    } finally {
      setPromptsLoading(false);
    }
  }

  function chooseGuidedPrompt(prompt: GuidedPromptRecord) {
    dispatch({ type: "ADD_GUIDED_WORD", prompt });
    requestAnimationFrame(() => {
      firstGuidedCardRef.current?.scrollIntoView?.({
        block: "center",
        behavior: "smooth",
      });
      const input =
        firstGuidedCardRef.current?.querySelector<HTMLInputElement>("input");
      input?.focus();
    });
  }

  function onTurnstileStatusChange(nextStatus: TurnstileStatus) {
    setTurnstileStatus(nextStatus);
    if (nextStatus !== "verified") setTurnstileToken(undefined);
  }

  const turnstileRequired = Boolean(turnstileSiteKey);
  const turnstileBlocked =
    turnstileRequired &&
    (turnstileStatus === "error" ||
      turnstileStatus === "expired" ||
      turnstileStatus === "timeout");
  const turnstileNotReady = turnstileRequired && !turnstileToken;

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
      for (const word of state.words) {
        if (word.referencePromptId) recordAnsweredId(word.referencePromptId);
      }
      clearDraft();
      rotateIdempotencyKey();
      setStatus("success");
      turnstileRef.current?.reset();
      void refreshPrompts();
      return;
    }

    setErrorCode(result.code);
    if (result.fieldErrors) setFieldErrors(result.fieldErrors);
    setStatus("error");
    if (result.code === "TURNSTILE_FAILED") {
      turnstileRef.current?.reset();
    }
  }

  function startAnother() {
    dispatch({ type: "RESET" });
    idempotencyKey.current = getOrCreateIdempotencyKey();
    setTurnstileToken(undefined);
    setStatus("idle");
    setDraftRestored(false);
  }

  function startAnotherWithPrompt(prompt: GuidedPromptRecord) {
    startAnother();
    dispatch({ type: "ADD_GUIDED_WORD", prompt });
  }

  if (status === "success") {
    return (
      <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="border-success/30 bg-success/5 flex flex-col items-center gap-3 rounded-2xl border p-8 text-center">
          <h1 className="text-success text-xl font-bold">
            وصلتنا مساهمتك، وشكراً لك!
          </h1>
          <p className="text-foreground/80">
            سيراجع فريقنا الكلمة قبل إضافتها إلى مجموعة بيانات لهجات. تقدر تكمّل
            بمساهمة ثانية الحين.
          </p>
          <Button type="button" onClick={startAnother}>
            إرسال مساهمة أخرى
          </Button>
        </div>
        <GuidedPromptRail
          prompts={prompts}
          loading={promptsLoading}
          error={promptsError}
          onRetry={refreshPrompts}
          onChoose={startAnotherWithPrompt}
        />
      </div>
    );
  }

  const disableAdd = state.words.length >= MAX_WORD_CARDS;
  const firstGuidedClientId = state.words.find(
    (w) => w.referencePromptId,
  )?.clientId;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6"
    >
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-foreground text-2xl font-bold">
          ساهم بكلمة من لهجتك
        </h1>
        <p className="text-foreground/70">
          ساعدنا في بناء بيانات تفهم تنوّع لهجاتنا العربية.
        </p>
      </header>

      <GuidedPromptRail
        prompts={prompts}
        loading={promptsLoading}
        error={promptsError}
        onRetry={refreshPrompts}
        onChoose={chooseGuidedPrompt}
      />

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
          const isFirstGuided = card.clientId === firstGuidedClientId;
          return (
            <div
              key={card.clientId}
              ref={(el) => {
                if (index === 0 && cardErrors) firstErrorRef.current = el;
                if (isFirstGuided) firstGuidedCardRef.current = el;
              }}
            >
              <WordCard
                index={index}
                total={state.words.length}
                card={card}
                errors={cardErrors}
                dialectOptions={dialectOptions}
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
                onAddAnotherForSamePrompt={
                  card.referencePromptId
                    ? () =>
                        dispatch({
                          type: "ADD_ANOTHER_FOR_SAME_PROMPT",
                          clientId: card.clientId,
                        })
                    : undefined
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
        <Turnstile
          ref={turnstileRef}
          siteKey={turnstileSiteKey}
          onToken={setTurnstileToken}
          onStatusChange={onTurnstileStatusChange}
        />
      ) : null}

      <Button
        type="submit"
        disabled={
          status === "submitting" ||
          !state.consent ||
          turnstileBlocked ||
          turnstileNotReady
        }
        className="w-full"
      >
        {status === "submitting" ? "جارٍ الإرسال…" : "إرسال المساهمة"}
      </Button>
    </form>
  );
}
