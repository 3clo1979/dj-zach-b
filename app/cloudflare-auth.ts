import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { inspectAccessToken } from "./verify-access";
export async function getManagerAuthResult() {
  const h = await headers();
  const config = env as unknown as { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string };
  return inspectAccessToken(h.get("cf-access-jwt-assertion"), config.CF_ACCESS_TEAM_DOMAIN, config.CF_ACCESS_AUD);
}
export async function getManagerUser() { return (await getManagerAuthResult()).user; }
