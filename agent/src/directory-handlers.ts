// ── Filesystem handlers for directory listing, file reading, workdir changes ──
import os from 'os';
import { existsSync } from 'fs';
import { readdir, stat, writeFile, mkdir } from 'fs/promises';
import { resolve, isAbsolute, basename, extname, sep } from 'path';
import { readFileForPreview, TEXT_EXTENSIONS, TEXT_FILENAMES } from './file-readers.js';

type SendFn = (msg: Record<string, unknown>) => void;

export async function handleListDirectory(
  msg: { dirPath: string; source?: string },
  workDir: string,
  send: SendFn,
): Promise<void> {
  const dirPath = msg.dirPath || '';
  const source = msg.source;

  try {
    // Empty path: list drives (Windows) or root (Unix)
    if (!dirPath) {
      if (os.platform() === 'win32') {
        const drives: { name: string; type: string }[] = [];
        for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
          const drivePath = letter + ':\\';
          if (existsSync(drivePath)) {
            drives.push({ name: letter + ':', type: 'directory' });
          }
        }
        send({ type: 'directory_listing', dirPath: '', entries: drives, source });
        return;
      }
      // Unix: list root
      const entries = await listDirectoryEntries('/');
      send({ type: 'directory_listing', dirPath: '/', entries, source });
      return;
    }

    const resolved = isAbsolute(dirPath) ? resolve(dirPath) : resolve(workDir, dirPath);
    const entries = await listDirectoryEntries(resolved);
    send({ type: 'directory_listing', dirPath: resolved, entries, source });
  } catch (err) {
    const error = err as Error;
    send({ type: 'directory_listing', dirPath, entries: [], error: error.message, source });
  }
}

export async function listDirectoryEntries(dirPath: string): Promise<{ name: string; type: string }[]> {
  const items = await readdir(dirPath, { withFileTypes: true });
  const entries: { name: string; type: string }[] = [];

  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    if (item.name === 'node_modules') continue;
    entries.push({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

export async function handleReadFile(
  msg: { filePath: string },
  workDir: string,
  send: SendFn,
): Promise<void> {
  const filePath = msg.filePath;
  try {
    const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(workDir, filePath);
    const stats = await stat(resolved);
    const result = await readFileForPreview(resolved, stats.size);

    send({
      type: 'file_content',
      filePath: resolved,
      fileName: result.fileName,
      content: result.content,
      encoding: result.encoding,
      mimeType: result.mimeType,
      truncated: result.truncated,
      totalSize: stats.size,
    });
  } catch (err) {
    send({
      type: 'file_content',
      filePath,
      fileName: basename(filePath),
      content: null,
      encoding: 'utf8',
      mimeType: 'application/octet-stream',
      truncated: false,
      totalSize: 0,
      error: (err as Error).message,
    });
  }
}

export function handleChangeWorkDir(
  msg: { workDir: string },
  state: { workDir: string },
  send: SendFn,
  onListSessions: () => void,
): void {
  let newDir = msg.workDir;

  // Expand ~ to user home directory
  if (newDir === '~' || newDir.startsWith('~/') || newDir.startsWith('~\\')) {
    newDir = resolve(os.homedir(), newDir.slice(2));
  }

  if (!existsSync(newDir)) {
    send({ type: 'error', message: `Directory does not exist: ${newDir}` });
    return;
  }

  // Only update agent-side workDir — existing conversations keep running in their own workDir
  state.workDir = newDir;
  console.log(`[AgentLink] Working directory changed to: ${newDir}`);

  // Notify web client (server intercepts to update its state)
  send({ type: 'workdir_changed', workDir: newDir });

  // Auto-refresh session list for new directory
  onListSessions();
}

const MAX_FILE_EDIT_SIZE = 500 * 1024; // 500 KB

export async function handleUpdateFile(
  msg: { filePath: string; content: string },
  workDir: string,
  send: SendFn,
): Promise<void> {
  const { filePath, content } = msg;

  try {
    const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(workDir, filePath);

    // Security: must be under workDir
    const normalizedWorkDir = resolve(workDir);
    if (!resolved.startsWith(normalizedWorkDir + sep) && resolved !== normalizedWorkDir) {
      send({ type: 'file_updated', filePath, success: false,
             error: 'Cannot edit files outside the working directory' });
      return;
    }

    // File must already exist (no creating new files)
    await stat(resolved);

    // Must be a known text file type
    const ext = extname(resolved).toLowerCase();
    const fileName = basename(resolved);
    if (!TEXT_EXTENSIONS.has(ext) && !TEXT_FILENAMES.has(fileName) && ext !== '') {
      send({ type: 'file_updated', filePath, success: false,
             error: 'Only text files can be edited' });
      return;
    }

    // Content size limit
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > MAX_FILE_EDIT_SIZE) {
      send({ type: 'file_updated', filePath, success: false,
             error: 'Content exceeds 500 KB limit' });
      return;
    }

    await writeFile(resolved, content, 'utf8');
    send({ type: 'file_updated', filePath: resolved, success: true });
  } catch (err) {
    send({ type: 'file_updated', filePath, success: false,
           error: (err as Error).message });
  }
}

function isValidName(name: string): boolean {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    return false;
  }
  return true;
}

export async function handleCreateFile(
  msg: { dirPath: string; fileName: string },
  workDir: string,
  send: SendFn,
): Promise<void> {
  const { dirPath, fileName } = msg;

  try {
    if (!isValidName(fileName)) {
      send({ type: 'file_created', success: false, error: 'Invalid file name' });
      return;
    }

    const resolvedDir = isAbsolute(dirPath) ? resolve(dirPath) : resolve(workDir, dirPath);
    const normalizedWorkDir = resolve(workDir);

    // Security: parent must be under workDir
    if (!resolvedDir.startsWith(normalizedWorkDir + sep) && resolvedDir !== normalizedWorkDir) {
      send({ type: 'file_created', success: false,
             error: 'Cannot create files outside the working directory' });
      return;
    }

    // Parent directory must exist
    try {
      const dirStat = await stat(resolvedDir);
      if (!dirStat.isDirectory()) {
        send({ type: 'file_created', success: false, error: 'Parent path is not a directory' });
        return;
      }
    } catch {
      send({ type: 'file_created', success: false, error: 'Parent directory does not exist' });
      return;
    }

    const targetPath = resolve(resolvedDir, fileName);

    // Must not already exist
    if (existsSync(targetPath)) {
      send({ type: 'file_created', success: false, error: 'File already exists' });
      return;
    }

    await writeFile(targetPath, '', 'utf8');
    send({ type: 'file_created', success: true, filePath: targetPath });
  } catch (err) {
    send({ type: 'file_created', success: false, error: (err as Error).message });
  }
}

export async function handleCreateDirectory(
  msg: { dirPath: string; dirName: string },
  workDir: string,
  send: SendFn,
): Promise<void> {
  const { dirPath, dirName } = msg;

  try {
    if (!isValidName(dirName)) {
      send({ type: 'directory_created', success: false, error: 'Invalid folder name' });
      return;
    }

    const resolvedDir = isAbsolute(dirPath) ? resolve(dirPath) : resolve(workDir, dirPath);
    const normalizedWorkDir = resolve(workDir);

    // Security: parent must be under workDir
    if (!resolvedDir.startsWith(normalizedWorkDir + sep) && resolvedDir !== normalizedWorkDir) {
      send({ type: 'directory_created', success: false,
             error: 'Cannot create folders outside the working directory' });
      return;
    }

    // Parent directory must exist
    try {
      const dirStat = await stat(resolvedDir);
      if (!dirStat.isDirectory()) {
        send({ type: 'directory_created', success: false, error: 'Parent path is not a directory' });
        return;
      }
    } catch {
      send({ type: 'directory_created', success: false, error: 'Parent directory does not exist' });
      return;
    }

    const targetPath = resolve(resolvedDir, dirName);

    // Must not already exist
    if (existsSync(targetPath)) {
      send({ type: 'directory_created', success: false, error: 'Folder already exists' });
      return;
    }

    await mkdir(targetPath);
    send({ type: 'directory_created', success: true, dirPath: targetPath });
  } catch (err) {
    send({ type: 'directory_created', success: false, error: (err as Error).message });
  }
}
