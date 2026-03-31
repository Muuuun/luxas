/**
 * API key resolution — env vars, OAuth credentials, config files.
 *
 * Supports:
 * - Environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY)
 * - Anthropic OAuth via pi-ai (Claude Pro/Max subscription)
 * - Local credential storage (~/.sisyphus/auth.json)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  loginAnthropic,
  refreshAnthropicToken,
  type OAuthCredentials,
} from "@mariozechner/pi-ai/oauth";

const AUTH_DIR = join(homedir(), ".sisyphus");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

interface StoredAuth {
  anthropic?: OAuthCredentials;
}

function readStoredAuth(): StoredAuth {
  if (!existsSync(AUTH_FILE)) return {};
  try {
    return JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeStoredAuth(auth: StoredAuth): void {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
}

/**
 * Run Anthropic OAuth login flow (opens browser).
 * Stores credentials locally for future use.
 */
export async function loginAnthropicOAuth(): Promise<void> {
  const { execSync } = await import("node:child_process");

  console.log("Starting Anthropic OAuth login...\n");

  const credentials = await loginAnthropic({
    onAuth: (info) => {
      console.log("Open this URL in your browser to authenticate:\n");
      console.log(`  ${info.url}\n`);
      if (info.instructions) console.log(info.instructions);
      // Try to open browser automatically
      try {
        const cmd = process.platform === "darwin" ? "open" :
                    process.platform === "win32" ? "start" : "xdg-open";
        execSync(`${cmd} "${info.url}"`, { stdio: "ignore" });
        console.log("(Browser opened automatically)\n");
      } catch {
        console.log("(Please open the URL manually)\n");
      }
    },
    onPrompt: async (prompt) => {
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise<string>((resolve) => {
        rl.question(prompt.message + " ", (answer) => {
          rl.close();
          resolve(answer);
        });
      });
    },
    onProgress: (message) => {
      console.log(`  ${message}`);
    },
  });

  const auth = readStoredAuth();
  auth.anthropic = credentials;
  writeStoredAuth(auth);

  console.log("\n✓ Authenticated with Anthropic (Claude Pro/Max)");
  console.log(`  Credentials saved to ${AUTH_FILE}`);
}

/**
 * Resolve Anthropic API key.
 * Priority: env vars → stored OAuth credentials (auto-refresh) → config files
 */
export async function resolveAnthropicKey(): Promise<string | undefined> {
  // 1. Env vars
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;

  // 2. Stored OAuth credentials
  const auth = readStoredAuth();
  if (auth.anthropic) {
    // Check if token needs refresh (expired or expires within 5 min)
    if (auth.anthropic.expires < Date.now()) {
      try {
        console.error("  ⟳ Refreshing Anthropic OAuth token...");
        const refreshed = await refreshAnthropicToken(auth.anthropic.refresh);
        auth.anthropic = refreshed;
        writeStoredAuth(auth);
      } catch (err: any) {
        console.error(`  ✗ Token refresh failed: ${err.message}`);
        console.error("  Run 'sisyphus login' to re-authenticate.");
        return undefined;
      }
    }
    return auth.anthropic.access;
  }

  // 3. Config files (Claude Code, etc.)
  const home = homedir();
  for (const p of [
    join(home, ".claude", "credentials.json"),
    join(home, ".claude.json"),
  ]) {
    const key = readJsonKey(p, ["oauthToken", "oauth_token", "apiKey", "api_key"]);
    if (key) return key;
  }

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

export async function getApiKey(provider: string): Promise<string | undefined> {
  if (provider === "anthropic") return resolveAnthropicKey();
  if (provider === "openai") return resolveOpenAIKey();
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
