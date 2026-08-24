import "server-only";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(
  token: string,
  secret: string,
  remoteIdentifier?: string,
): Promise<boolean> {
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIdentifier && remoteIdentifier !== "unknown") {
      body.set("remoteip", remoteIdentifier);
    }
    const response = await fetch(VERIFY_URL, { method: "POST", body });
    if (!response.ok) return false;
    const result = (await response.json()) as { success: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}
