import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { verifyAccessToken } from "./verify-access";
export async function getManagerUser() {
  const h = await headers();
  const config = env as unknown as { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string };
  return verifyAccessToken(h.get("cf-access-jwt-assertion"), config.CF_ACCESS_TEAM_DOMAIN, config.CF_ACCESS_AUD);
}
