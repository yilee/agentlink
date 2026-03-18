// ── Filesystem handlers for directory listing, file reading, workdir changes ──
import os from 'os';
import { existsSync } from 'fs';
import { readdir, stat, writeFile } from 'fs/promises';
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
  const newDir = msg.workDir;

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
