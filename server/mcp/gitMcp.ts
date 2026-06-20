import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitMcpInput = {
  query?: string;
};

export type GitMcpFileStatus = {
  path: string;
  index: string;
  working_tree: string;
  status: string;
};

export type GitMcpResult = {
  success: boolean;
  summary: string;
  mode: "status_summary";
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  is_dirty: boolean;
  counts: {
    modified: number;
    added: number;
    deleted: number;
    renamed: number;
    untracked: number;
    conflicted: number;
    total: number;
  };
  files: GitMcpFileStatus[];
  recent_commits: Array<{
    hash: string;
    subject: string;
  }>;
  next_step: string;
};

const MAX_FILES = 120;
const MAX_COMMITS = 5;

export async function runGitMcp(_input: GitMcpInput = {}): Promise<GitMcpResult> {
  const [branchInfo, statusOutput, commitsOutput] = await Promise.all([
    readBranchInfo(),
    git(["status", "--porcelain=v1", "-b"]),
    git(["log", `-${MAX_COMMITS}`, "--pretty=format:%h%x09%s"]).catch(() => "")
  ]);
  const files = parseStatusFiles(statusOutput).slice(0, MAX_FILES);
  const counts = countStatuses(files);
  const isDirty = counts.total > 0;
  return {
    success: true,
    summary: isDirty
      ? `Git MCP found ${counts.total} changed files on ${branchInfo.branch}.`
      : `Git MCP found a clean working tree on ${branchInfo.branch}.`,
    mode: "status_summary",
    branch: branchInfo.branch,
    upstream: branchInfo.upstream,
    ahead: branchInfo.ahead,
    behind: branchInfo.behind,
    is_dirty: isDirty,
    counts,
    files,
    recent_commits: parseCommits(commitsOutput),
    next_step: isDirty
      ? "请先审阅改动摘要；需要提交时可让 Embex 生成提交说明，但 Git MCP 当前只读，不会自动提交。"
      : "当前工作区干净，可继续开发下一步功能。"
  };
}

async function readBranchInfo() {
  const output = await git(["status", "--porcelain=v1", "-b"]);
  const firstLine = output.split(/\r?\n/).find(Boolean) || "## unknown";
  const match = firstLine.match(/^##\s+(.+?)(?:\.\.\.(.+?))?(?:\s+\[(.+)\])?$/);
  const branch = (match?.[1] || "unknown").trim();
  const upstream = match?.[2]?.trim();
  const divergence = match?.[3] || "";
  const ahead = Number(divergence.match(/ahead\s+(\d+)/)?.[1] || 0);
  const behind = Number(divergence.match(/behind\s+(\d+)/)?.[1] || 0);
  return { branch, upstream, ahead, behind };
}

async function git(args: string[]) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: process.cwd(),
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return String(stdout || "");
}

function parseStatusFiles(output: string): GitMcpFileStatus[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("## "))
    .map((line) => {
      const index = line.slice(0, 1);
      const workingTree = line.slice(1, 2);
      const rawPath = line.slice(3).trim();
      return {
        path: normalizeGitPath(rawPath),
        index: index || " ",
        working_tree: workingTree || " ",
        status: describeStatus(index, workingTree)
      };
    })
    .filter((item) => item.path);
}

function countStatuses(files: GitMcpFileStatus[]): GitMcpResult["counts"] {
  const counts = {
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    conflicted: 0,
    total: files.length
  };
  for (const file of files) {
    const code = `${file.index}${file.working_tree}`;
    if (code === "??") counts.untracked += 1;
    else if (/[AU]U|U[ADU]|AA|DD/.test(code)) counts.conflicted += 1;
    else if (file.index === "R" || file.working_tree === "R") counts.renamed += 1;
    else if (file.index === "A" || file.working_tree === "A") counts.added += 1;
    else if (file.index === "D" || file.working_tree === "D") counts.deleted += 1;
    else if (file.index === "M" || file.working_tree === "M") counts.modified += 1;
  }
  return counts;
}

function parseCommits(output: string) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, ...rest] = line.split("\t");
      return {
        hash: String(hash || "").trim(),
        subject: rest.join("\t").trim()
      };
    })
    .filter((item) => item.hash);
}

function describeStatus(index: string, workingTree: string) {
  const code = `${index}${workingTree}`;
  if (code === "??") return "untracked";
  if (/[AU]U|U[ADU]|AA|DD/.test(code)) return "conflicted";
  if (index === "R" || workingTree === "R") return "renamed";
  if (index === "A" || workingTree === "A") return "added";
  if (index === "D" || workingTree === "D") return "deleted";
  if (index === "M" || workingTree === "M") return "modified";
  return "changed";
}

function normalizeGitPath(value: string) {
  return value
    .replace(/^"|"$/g, "")
    .replace(/\\/g, "/");
}
