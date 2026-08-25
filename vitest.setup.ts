import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// The real "server-only" package throws when imported outside Next's server
// bundler, which is exactly what unit-testing server actions/modules does
// here on purpose (with the actual Supabase/Next dependencies mocked).
vi.mock("server-only", () => ({}));
