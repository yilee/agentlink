import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readdirSync, statSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { pathToProjectFolder } from './history.js';

interface MemoryFileInfo {
  name: string;
  size: number;
  lastModified: number;
}

function getMemoryDir(workDir: string): string {
  const projectsDir = join(homedir(), '.claude', 'projects');
  const projectFolder = pathToProjectFolder(workDir);
  return join(projectsDir, projectFolder, 'memory');
}

export function listMemoryFiles(workDir: string): { memoryDir: string | null; files: MemoryFileInfo[] } {
  const memoryDir = getMemoryDir(workDir);
  if (!existsSync(memoryDir)) {
    return { memoryDir: null, files: [] };
  }
  const files: MemoryFileInfo[] = [];
  for (const name of readdirSync(memoryDir)) {
    if (!name.endsWith('.md')) continue;
    const filePath = join(memoryDir, name);
    try {
      const stats = statSync(filePath);
      if (stats.isFile()) {
        files.push({ name, size: stats.size, lastModified: stats.mtime.getTime() });
      }
    } catch { /* skip */ }
  }
  // Sort: MEMORY.md first, then alphabetical
  files.sort((a, b) => {
    if (a.name === 'MEMORY.md') return -1;
    if (b.name === 'MEMORY.md') return 1;
    return a.name.localeCompare(b.name);
  });
  return { memoryDir, files };
}

export function updateMemoryFile(workDir: string, filename: string, content: string): { success: boolean; error?: string } {
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { success: false, error: 'Invalid filename' };
  }
  const memoryDir = getMemoryDir(workDir);
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }
  try {
    writeFileSync(join(memoryDir, filename), content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function deleteMemoryFile(workDir: string, filename: string): { success: boolean; error?: string } {
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { success: false, error: 'Invalid filename' };
  }
  const memoryDir = getMemoryDir(workDir);
  const filePath = join(memoryDir, filename);
  if (!existsSync(filePath)) {
    return { success: false, error: 'File not found' };
  }
  try {
    unlinkSync(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
