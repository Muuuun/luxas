/**
 * API key resolution — environment variables and config files.
 *
 * Supports:
 * - Environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY)
 * - Config files (Codex OAuth tokens)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Resolve Anthropic API key from environment.
 */
export async function resolveAnthropicKey(): Promise<string | undefined> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  // Fall back to ~/.sisyphus/auth.json (alongside OAuth tokens it may already
  // hold). Studio-spawned brain has no shell env — see readSisyphusAuthKey.
  return readJsonKey(join(homedir(), ".sisyphus", "auth.json"), ["anthropic", "ANTHROPIC_API_KEY"]);
}

/**
 * The two OpenAI surfaces need DIFFERENT credentials and must never be crossed
 * (2026-09-04):
 *
 *   provider "openai"        → api.openai.com          → platform key, `sk-…`
 *   provider "openai-codex"  → chatgpt.com/backend-api → ChatGPT OAuth JWT
 *
 * They are not interchangeable, and each backend rejects the other's token:
 * the Codex OAuth token on api.openai.com returns
 * `403 Missing scopes: api.responses.write`, and an `sk-` key sent to the Codex
 * backend is not a valid ChatGPT session. Before the split, both providers
 * resolved through one function that read `~/.codex/auth.json`'s FLAT keys
 * first — so dropping a platform key into that file would have silently handed
 * it to the Codex backend and broken the `math` agent (gpt-5.6-terra), which is
 * the only openai-codex consumer.
 *
 * Platform key lookup order: env → ~/.sisyphus/auth.json (alongside the other
 * Luxas keys, and the only file the studio-spawned brain can rely on) →
 * ~/.codex/auth.json's OPENAI_API_KEY field, which the Codex CLI writes only in
 * api-key auth mode.
 */
export async function resolveOpenAIPlatformKey(): Promise<string | undefined> {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const fromSisyphus = readJsonKey(join(homedir(), ".sisyphus", "auth.json"), ["openai", "OPENAI_API_KEY"]);
  if (fromSisyphus) return fromSisyphus;
  const codexApiKey = readJsonKey(join(homedir(), ".codex", "auth.json"), ["OPENAI_API_KEY", "apiKey", "api_key"]);
  if (codexApiKey) return codexApiKey;
  return undefined;
}

/** ChatGPT OAuth token for the Codex backend. Never returns a platform key. */
export async function resolveCodexKey(): Promise<string | undefined> {
  const home = homedir();
  const codexPaths = [
    join(home, ".codex", "auth.json"),
    join(home, ".codex", "config.json"),
    join(home, ".config", "codex", "auth.json"),
  ];
  for (const p of codexPaths) {
    const token = await resolveCodexOAuthToken(p);
    if (token) return token;
  }
  return undefined;
}

/** @deprecated Ambiguous across the two surfaces — call the specific resolver. */
export async function resolveOpenAIKey(): Promise<string | undefined> {
  return (await resolveOpenAIPlatformKey()) ?? (await resolveCodexKey());
}

/**
 * Resolve Codex OAuth token with automatic refresh.
 * Reads tokens.access_token, checks if it's expired (JWT exp claim),
 * and refreshes using tokens.refresh_token if needed.
 */
async function resolveCodexOAuthToken(authPath: string): Promise<string | undefined> {
  if (!existsSync(authPath)) return undefined;

  try {
    const data = JSON.parse(readFileSync(authPath, "utf-8"));
    const tokens = data?.tokens;
    if (!tokens?.access_token) return undefined;

    // Check JWT expiration (access_token is a JWT)
    const expired = isJwtExpired(tokens.access_token);

    if (!expired) {
      return tokens.access_token;
    }

    // Token expired — try refresh
    if (!tokens.refresh_token) {
      console.error("  ✗ Codex OAuth token expired and no refresh_token available. Run 'codex auth login'.");
      return undefined;
    }

    console.error("  ⟳ Refreshing Codex OAuth token...");
    const refreshed = await refreshCodexToken(tokens.refresh_token);
    if (refreshed) {
      // Update stored tokens
      data.tokens.access_token = refreshed.access_token;
      if (refreshed.refresh_token) {
        data.tokens.refresh_token = refreshed.refresh_token;
      }
      data.last_refresh = new Date().toISOString();
      writeFileSync(authPath, JSON.stringify(data, null, 2));
      console.error("  ✓ Codex OAuth token refreshed.");
      return refreshed.access_token;
    }

    console.error("  ✗ Codex OAuth token refresh failed. Run 'codex auth login'.");
    return undefined;
  } catch {
    return undefined;
  }
}

function isJwtExpired(jwt: string): boolean {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return true;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (!payload.exp) return false; // no exp claim = don't know, assume valid
    return Date.now() / 1000 > payload.exp - 60; // 60s buffer
  } catch {
    return true; // can't parse = treat as expired
  }
}

async function refreshCodexToken(refreshToken: string): Promise<{ access_token: string; refresh_token?: string } | null> {
  try {
    const resp = await fetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann", // Codex CLI client ID (from codex binary)
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) return null;

    const data = await resp.json() as any;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    };
  } catch {
    return null;
  }
}

/**
 * Persistent fallback for API keys when env doesn't have them. Used when
 * Sisyphus is spawned by a parent that lacks shell env (notably the
 * studio's launchd-supervised next-server: launchd plist sets only
 * HOME/PATH/NODE_ENV, so DEEPSEEK_API_KEY etc. never propagate from the
 * user's shell). Auth file lives at ~/.sisyphus/auth.json and accepts
 * any of these key shapes:
 *
 *   { "deepseek": "sk-...", "kimi": "sk-...", "moonshot": "sk-...", "openai": "sk-..." }
 *   { "DEEPSEEK_API_KEY": "sk-...", "KIMI_API_KEY": "sk-...", ... }
 *
 * Existing Anthropic OAuth fields (access_token / refresh_token) coexist —
 * resolveAnthropicKey reads the OAuth path; this helper only consumes the
 * provider-keyed slots above.
 */
function readSisyphusAuthKey(...keys: string[]): string | undefined {
  return readJsonKey(join(homedir(), ".sisyphus", "auth.json"), keys);
}

export async function resolveDeepSeekKey(): Promise<string | undefined> {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  return readSisyphusAuthKey("deepseek", "DEEPSEEK_API_KEY");
}

export async function resolveKimiKey(): Promise<string | undefined> {
  if (process.env.KIMI_API_KEY) return process.env.KIMI_API_KEY;
  if (process.env.MOONSHOT_API_KEY) return process.env.MOONSHOT_API_KEY;
  return readSisyphusAuthKey("kimi", "moonshot", "KIMI_API_KEY", "MOONSHOT_API_KEY");
}

export async function resolveGLMKey(): Promise<string | undefined> {
  if (process.env.GLM_API_KEY) return process.env.GLM_API_KEY;
  if (process.env.ZHIPUAI_API_KEY) return process.env.ZHIPUAI_API_KEY;
  return readSisyphusAuthKey("glm", "zhipu", "GLM_API_KEY", "ZHIPUAI_API_KEY");
}

export async function getApiKey(provider: string): Promise<string | undefined> {
  if (provider === "anthropic") return resolveAnthropicKey();
  if (provider === "openai") return resolveOpenAIPlatformKey();
  if (provider === "openai-codex") return resolveCodexKey();
  if (provider === "deepseek") return resolveDeepSeekKey();
  if (provider === "kimi-coding") return resolveKimiKey();
  if (provider === "glm") return resolveGLMKey();
  return undefined;
}

function readJsonKey(path: string, keys: string[]): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    for (const k of keys) {
      if (typeof data[k] === "string" && data[k].length > 0) return data[k];
    }
  } catch {}
  return undefined;
}

function readNestedJsonKey(path: string, dotPaths: string[]): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    for (const dp of dotPaths) {
      const parts = dp.split(".");
      let val: any = data;
      for (const p of parts) {
        val = val?.[p];
      }
      if (typeof val === "string" && val.length > 0) return val;
    }
  } catch {}
  return undefined;
}
