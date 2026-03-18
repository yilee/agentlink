// ── Git handlers for repository status, diff viewing, and write operations ──
import { execFile } from 'child_process';
import { resolve, isAbsolute, normalize, sep } from 'path';

type SendFn = (msg: Record<string, unknown>) => void;

interface GitFileEntry {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'C' | '?';
  oldPath?: string;
}

// Helper: execute a git command and return stdout
function gitExec(args: string[], cwd: string, timeoutMs = 10000): Promise<string> {
  return new Promise((res, rej) => {
    execFile('git', args, { cwd, timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) rej(err);
      else res(stdout.trim());
    });
  });
}

// Validate that a file path is relative and within workDir (security)
function validatePath(filePath: string, workDir: string): string | null {
  if (!filePath || isAbsolute(filePath) || filePath.includes('..')) return null;
  const resolved = resolve(workDir, filePath);
  const normalizedWorkDir = normalize(workDir) + sep;
  const normalizedResolved = normalize(resolved);
  if (!normalizedResolved.startsWith(normalizedWorkDir) && normalizedResolved !== normalize(workDir)) return null;
  return resolved;
}

// Parse git status --porcelain=v2 output into staged, modified, untracked arrays
function parsePorcelainV2(output: string): {
  staged: GitFileEntry[];
  modified: GitFileEntry[];
  untracked: GitFileEntry[];
} {
  const staged: GitFileEntry[] = [];
  const modified: GitFileEntry[] = [];
  const untracked: GitFileEntry[] = [];

  if (!output) return { staged, modified, untracked };

  for (const line of output.split('\n')) {
    if (line.startsWith('1 ')) {
      // Ordinary changed entry: 1 XY sub mH mI mW hH hI path
      const parts = line.split(' ');
      const xy = parts[1];
      const path = parts.slice(8).join(' ');
      const x = xy[0]; // staged status
      const y = xy[1]; // unstaged status

      if (x !== '.') {
        staged.push({ path, status: x as GitFileEntry['status'] });
      }
      if (y !== '.') {
        modified.push({ path, status: y as GitFileEntry['status'] });
      }
    } else if (line.startsWith('2 ')) {
      // Renamed/copied entry: 2 XY sub mH mI mW hH hI X_score path\toldPath
      const parts = line.split(' ');
      const xy = parts[1];
      const xScore = parts[8]; // e.g. R100 or C050
      const pathPart = parts.slice(9).join(' ');
      const [path, oldPath] = pathPart.split('\t');
      const x = xy[0];
      const y = xy[1];

      // Determine rename vs copy from the score prefix
      const rcStatus = xScore.startsWith('C') ? 'C' : 'R';

      if (x !== '.') {
        staged.push({ path, status: rcStatus as GitFileEntry['status'], oldPath });
      }
      if (y !== '.') {
        modified.push({ path, status: y as GitFileEntry['status'] });
      }
    } else if (line.startsWith('? ')) {
      // Untracked file
      const path = line.slice(2);
      untracked.push({ path, status: '?' });
    }
  }

  return { staged, modified, untracked };
}

export async function handleGitStatus(
  _msg: { type: string; [key: string]: unknown },
  workDir: string,
  send: SendFn,
): Promise<void> {
  // Check if workDir is inside a git repository
  try {
    await gitExec(['rev-parse', '--is-inside-work-tree'], workDir);
  } catch {
    send({
      type: 'git_status_result',
      isRepo: false,
      branch: null,
      detachedHead: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      untracked: [],
    });
    return;
  }

  try {
    const results = await Promise.allSettled([
      gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], workDir),
      gitExec(['rev-parse', '--short', 'HEAD'], workDir),
      gitExec(['rev-parse', '--abbrev-ref', '@{upstream}'], workDir),
      gitExec(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], workDir),
      gitExec(['status', '--porcelain=v2'], workDir),
    ]);

    // Branch name — "HEAD" means detached
    const branchResult = results[0];
    const branchName = branchResult.status === 'fulfilled' ? branchResult.value : null;

    // Short hash for detached HEAD display
    const shortHashResult = results[1];
    const shortHash = shortHashResult.status === 'fulfilled' ? shortHashResult.value : null;

    const isDetached = branchName === 'HEAD';
    const branch = isDetached ? null : branchName;
    const detachedHead = isDetached ? shortHash : null;

    // Upstream — may fail if no tracking branch is configured
    const upstreamResult = results[2];
    const upstream = upstreamResult.status === 'fulfilled' ? upstreamResult.value : null;

    // Ahead/behind — may fail if no upstream
    let ahead = 0;
    let behind = 0;
    const countResult = results[3];
    if (countResult.status === 'fulfilled') {
      const parts = countResult.value.split('\t');
      ahead = parseInt(parts[0], 10) || 0;
      behind = parseInt(parts[1], 10) || 0;
    }

    // Parse porcelain v2 status output
    const statusResult = results[4];
    const statusOutput = statusResult.status === 'fulfilled' ? statusResult.value : '';
    const { staged, modified, untracked } = parsePorcelainV2(statusOutput);

    send({
      type: 'git_status_result',
      isRepo: true,
      branch,
      detachedHead,
      upstream,
      ahead,
      behind,
      staged,
      modified,
      untracked,
    });
  } catch (err) {
    send({
      type: 'git_status_result',
      isRepo: true,
      branch: null,
      detachedHead: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      untracked: [],
      error: (err as Error).message,
    });
  }
}

export async function handleGitDiff(
  msg: { filePath: string; staged?: boolean; untracked?: boolean; type: string; [key: string]: unknown },
  workDir: string,
  send: SendFn,
): Promise<void> {
  const filePath = msg.filePath;
  const staged = msg.staged || false;
  const untracked = msg.untracked || false;

  // Validate path is relative and within workDir
  if (!validatePath(filePath, workDir)) {
    send({
      type: 'git_diff_result',
      filePath,
      staged,
      diff: '',
      binary: false,
      error: 'Invalid file path: must be relative and within the working directory.',
    });
    return;
  }

  try {
    let args: string[];
    if (staged) {
      args = ['diff', '--cached', '--', filePath];
    } else if (untracked) {
      args = ['diff', '--no-index', '/dev/null', filePath];
    } else {
      args = ['diff', '--', filePath];
    }

    let stdout: string;
    try {
      stdout = await gitExec(args, workDir);
    } catch (err) {
      const execErr = err as { code?: number; stdout?: string };
      // git diff --no-index exits with code 1 when differences are found (expected)
      if (untracked && execErr.code === 1 && typeof execErr.stdout === 'string' && execErr.stdout.length > 0) {
        stdout = execErr.stdout.trim();
      } else {
        throw err;
      }
    }

    const binary = stdout.includes('Binary files');

    send({
      type: 'git_diff_result',
      filePath,
      staged,
      diff: stdout,
      binary,
    });
  } catch (err) {
    send({
      type: 'git_diff_result',
      filePath,
      staged,
      diff: '',
      binary: false,
      error: (err as Error).message,
    });
  }
}

// ── Write operations ──

export async function handleGitStage(
  msg: { files: string[]; type: string; [key: string]: unknown },
  workDir: string,
  send: SendFn,
): Promise<void> {
  const files = msg.files;
  if (!Array.isArray(files) || files.length === 0) {
    send({ type: 'git_stage_result', success: false, error: 'No files specified.' });
    return;
  }

  for (const f of files) {
    if (!validatePath(f, workDir)) {
      send({ type: 'git_stage_result', success: false, error: `Invalid file path: ${f}` });
      return;
    }
  }

  try {
    await gitExec(['add', '--', ...files], workDir);
    send({ type: 'git_stage_result', success: true });
  } catch (err) {
    send({ type: 'git_stage_result', success: false, error: (err as Error).message });
  }
}

export async function handleGitUnstage(
  msg: { files: string[]; type: string; [key: string]: unknown },
  workDir: string,
  send: SendFn,
): Promise<void> {
  const files = msg.files;
  if (!Array.isArray(files) || files.length === 0) {
    send({ type: 'git_unstage_result', success: false, error: 'No files specified.' });
    return;
  }

  for (const f of files) {
    if (!validatePath(f, workDir)) {
      send({ type: 'git_unstage_result', success: false, error: `Invalid file path: ${f}` });
      return;
    }
  }

  try {
    await gitExec(['restore', '--staged', '--', ...files], workDir);
    send({ type: 'git_unstage_result', success: true });
  } catch (err) {
    send({ type: 'git_unstage_result', success: false, error: (err as Error).message });
  }
}

export async function handleGitDiscard(
  msg: { files: string[]; type: string; [key: string]: unknown },
  workDir: string,
  send: SendFn,
): Promise<void> {
  const files = msg.files;
  if (!Array.isArray(files) || files.length === 0) {
    send({ type: 'git_discard_result', success: false, error: 'No files specified.' });
    return;
  }

  for (const f of files) {
    if (!validatePath(f, workDir)) {
      send({ type: 'git_discard_result', success: false, error: `Invalid file path: ${f}` });
      return;
    }
  }

  try {
    await gitExec(['checkout', '--', ...files], workDir);
    send({ type: 'git_discard_result', success: true });
  } catch (err) {
    send({ type: 'git_discard_result', success: false, error: (err as Error).message });
  }
}

export async function handleGitCommit(
  msg: { message: string; type: string; [key: string]: unknown },
  workDir: string,
  send: SendFn,
): Promise<void> {
  const commitMessage = msg.message;
  if (!commitMessage || typeof commitMessage !== 'string' || !commitMessage.trim()) {
    send({ type: 'git_commit_result', success: false, error: 'Commit message is required.' });
    return;
  }

  try {
    const stdout = await gitExec(['commit', '-m', commitMessage.trim()], workDir, 30000);
    send({ type: 'git_commit_result', success: true, output: stdout });
  } catch (err) {
    send({ type: 'git_commit_result', success: false, error: (err as Error).message });
  }
}
