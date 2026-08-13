/**
 * GET /api/devtools/run-tests?suite=unit|integration|e2e&headed=true
 *
 * Development-only endpoint. Spawns the test suite as a child process and
 * streams stdout/stderr back as Server-Sent Events so the DevTools panel
 * can display live output without polling.
 *
 * Events emitted:
 *   start  — { suite, command }
 *   line   — { text, stream: "stdout"|"stderr" }
 *   result — { type: "pass"|"fail"|"skip", name, file, duration? }
 *   done   — { exitCode, passed, failed, duration }
 *   error  — { message }
 */

import { spawn } from "child_process";
import { isDevToolsAllowed, DEVTOOLS_BLOCKED_MESSAGE } from "@/lib/devtools-env";
import { requireDevToolsAdmin } from "@/lib/devtools-auth";

/** True when running on a Railway deployment (not a local dev machine). */
function isDeployedEnvironment(): boolean {
  return (
    process.env.RAILWAY_ENVIRONMENT_NAME !== undefined ||
    process.env.RAILWAY_GIT_BRANCH !== undefined
  );
}
type Suite = "unit" | "integration" | "e2e";

// ── Output parsers ─────────────────────────────────────────────────────────

/** Parse a single line of vitest verbose output into a structured result. */
function parseVitestLine(line: string): {
  type: "pass" | "fail" | "skip";
  name: string;
  file: string;
} | null {
  // ✓ |unit| __tests__/unit/foo.test.ts > describe > test name  5ms
  // ✗ |unit| __tests__/unit/foo.test.ts > describe > test name
  const passMatch = line.match(/✓\s+\|[^|]+\|\s+([^>]+)(?:>(.+?))\s*\d*ms?$/);
  const failMatch = line.match(/✗\s+\|[^|]+\|\s+([^>]+)(?:>(.+?))$/);
  const skipMatch = line.match(/↓\s+\|[^|]+\|\s+([^>]+)(?:>(.+?))$/);

  if (passMatch) {
    return { type: "pass", file: passMatch[1].trim(), name: passMatch[2]?.trim() ?? "" };
  }
  if (failMatch) {
    return { type: "fail", file: failMatch[1].trim(), name: failMatch[2]?.trim() ?? "" };
  }
  if (skipMatch) {
    return { type: "skip", file: skipMatch[1].trim(), name: skipMatch[2]?.trim() ?? "" };
  }
  return null;
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function GET(request: Request) {
  if (!isDevToolsAllowed()) {
    return new Response(
      JSON.stringify({ error: DEVTOOLS_BLOCKED_MESSAGE }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const authError = await requireDevToolsAdmin();
  if (authError) return authError;

  // Test runner spawns child processes — only meaningful on a local dev machine.
  // On Railway the source files and devDependency binaries aren't reliably
  // accessible from within the running server process.
  if (isDeployedEnvironment()) {
    const encoder = new TextEncoder();
    const msg = [
      `event: start\ndata: ${JSON.stringify({ suite: "unavailable", command: "n/a" })}\n\n`,
      `event: line\ndata: ${JSON.stringify({ text: "⚠️  Test runner is only available in your local development environment.", stream: "stderr" })}\n\n`,
      `event: line\ndata: ${JSON.stringify({ text: "   Run 'npm run test:unit' or 'npm run test:integration' in your terminal.", stream: "stderr" })}\n\n`,
      `event: done\ndata: ${JSON.stringify({ exitCode: 1, passed: 0, failed: 0, duration: 0 })}\n\n`,
    ].join("");
    return new Response(encoder.encode(msg), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const { searchParams } = new URL(request.url);
  const suite = (searchParams.get("suite") ?? "unit") as Suite;
  const headed = searchParams.get("headed") === "true";

  const cwd = process.cwd();

  const commands: Record<Suite, { cmd: string; args: string[] }> = {
    unit: {
      cmd: "npx",
      args: ["vitest", "run", "--project=unit", "--reporter=verbose"],
    },
    integration: {
      cmd: "npx",
      args: ["vitest", "run", "--project=integration", "--reporter=verbose"],
    },
    e2e: {
      cmd: "npx",
      args: [
        "playwright",
        "test",
        "--reporter=list",
        ...(headed ? ["--headed", "--slow-mo=700"] : []),
      ],
    },
  };

  const { cmd, args } = commands[suite] ?? commands.unit;

  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  function send(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    try {
      controller.enqueue(encoder.encode(payload));
    } catch {
      // Stream already closed — ignore
    }
  }

  const startTime = Date.now();
  let passed = 0;
  let failed = 0;

  send("start", { suite, command: [cmd, ...args].join(" ") });

  const proc = spawn(cmd, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: "0" },
    // shell: true lets the OS shell resolve npx from PATH,
    // which is necessary when Next.js dev server doesn't inherit the full PATH.
    shell: true,
  });

  function handleLine(text: string, stream: "stdout" | "stderr") {
    // Emit the raw line
    send("line", { text, stream });

    // Try to parse a test result out of it
    const result = parseVitestLine(text);
    if (result) {
      if (result.type === "pass") passed++;
      if (result.type === "fail") failed++;
      send("result", result);
    }
  }

  let stdoutBuf = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() ?? "";
    for (const line of lines) handleLine(line, "stdout");
  });

  let stderrBuf = "";
  proc.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    const lines = stderrBuf.split("\n");
    stderrBuf = lines.pop() ?? "";
    for (const line of lines) handleLine(line, "stderr");
  });

  proc.on("close", (exitCode) => {
    // Flush remaining buffer
    if (stdoutBuf) handleLine(stdoutBuf, "stdout");
    if (stderrBuf) handleLine(stderrBuf, "stderr");

    send("done", {
      exitCode: exitCode ?? 1,
      passed,
      failed,
      duration: Date.now() - startTime,
    });

    try {
      controller.close();
    } catch {
      // Already closed
    }
  });

  proc.on("error", (err) => {
    send("error", { message: err.message });
    try {
      controller.close();
    } catch {
      // Already closed
    }
  });

  // Kill the child process if the client disconnects
  request.signal.addEventListener("abort", () => {
    proc.kill("SIGTERM");
    try {
      controller.close();
    } catch {
      // Already closed
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
