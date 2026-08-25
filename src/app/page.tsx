import { ContributionForm } from "@/features/contributions/ContributionForm";
import { getGuidedPrompts } from "@/features/prompts/actions";
import { getPublicEnv } from "@/lib/env";

export const revalidate = 0;

export default async function HomePage() {
  const { NEXT_PUBLIC_TURNSTILE_SITE_KEY } = getPublicEnv();
  const initialPrompts = await getGuidedPrompts([]).catch(() => []);
  return (
    <ContributionForm
      turnstileSiteKey={NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      initialPrompts={initialPrompts}
    />
  );
}
