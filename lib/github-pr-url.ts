function normalizeRepoSegment(segment: string): string {
  return segment.trim().toLowerCase();
}

export interface ParsedGitHubPrUrl {
  repoOwner: string;
  repoName: string;
  prNumber: number;
}

/**
 * Parses GitHub PR URLs such as:
 * - https://github.com/owner/repo/pull/123
 * - http://github.com/owner/repo/pull/123/
 */
export function parseGitHubPrUrl(rawUrl: string): ParsedGitHubPrUrl | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  // owner, repo, pull, number
  if (segments.length < 4) return null;
  const [owner, repo, pull, numStr] = segments;
  if (!owner || !repo || pull !== "pull") return null;
  const prNumber = Number.parseInt(numStr ?? "", 10);
  if (!Number.isFinite(prNumber) || prNumber < 1) return null;

  return {
    repoOwner: normalizeRepoSegment(owner),
    repoName: normalizeRepoSegment(repo),
    prNumber,
  };
}

export function buildGitHubPrUrl(repoOwner: string, repoName: string, prNumber: number): string {
  return `https://github.com/${repoOwner}/${repoName}/pull/${String(prNumber)}`;
}
