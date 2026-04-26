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
  return undefined;
}

export async function resolveOpenAIKey(): Promise<string | undefined> {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;

  const home = homedir();
  const codexPaths = [
    join(home, ".codex", "auth.json"),
    join(home, ".codex", "config.json"),
    join(home, ".config", "codex", "auth.json"),
  ];

  for (const p of codexPaths) {
    // Check flat keys first
    const key = readJsonKey(p, ["apiKey", "api_key", "token", "key", "OPENAI_API_KEY"]);
    if (key) return key;

    // Check Codex OAuth nested tokens — with auto-refresh
    const token = await resolveCodexOAuthToken(p);
    if (token) return token;
  }

  return undefined;
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

export async function resolveDeepSeekKey(): Promise<string | undefined> {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  return undefined;
}

export async function getApiKey(provider: string): Promise<string | undefined> {
  if (provider === "anthropic") return resolveAnthropicKey();
  if (provider === "openai" || provider === "openai-codex") return resolveOpenAIKey();
  if (provider === "deepseek") return resolveDeepSeekKey();
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
