import { ContributionForm } from "@/features/contributions/ContributionForm";
import { getPublicEnv } from "@/lib/env";

export default function HomePage() {
  const { NEXT_PUBLIC_TURNSTILE_SITE_KEY } = getPublicEnv();
  return <ContributionForm turnstileSiteKey={NEXT_PUBLIC_TURNSTILE_SITE_KEY} />;
}
