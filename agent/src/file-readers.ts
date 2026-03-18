import { open, readFile as fsReadFile } from 'fs/promises';
import { extname, basename } from 'path';

/** Result returned by every reader */
export interface FileReadResult {
  content: string | null;
  encoding: 'utf8' | 'base64';
  mimeType: string;
  truncated: boolean;
}

/** A reader that handles a specific category of files */
export interface FileReader {
  maxSize: number;
  read(filePath: string, totalSize: number): Promise<FileReadResult>;
}

// ── Reader registry ────────────────────────────────────────────

const readers = new Map<string, FileReader>();

/** Register a reader for one or more file extensions (including the dot). */
export function registerReader(extensions: string[], reader: FileReader): void {
  for (const ext of extensions) {
    readers.set(ext.toLowerCase(), reader);
  }
}

/** Look up the reader for a given extension. Falls back to a heuristic. */
function resolveReader(ext: string, totalSize: number): FileReader {
  const reader = readers.get(ext.toLowerCase());
  if (reader) return reader;

  // No extension or unknown extension: try text if small enough
  if (ext === '' || totalSize <= textReader.maxSize) return textReader;

  return binaryReader;
}

// ── Text reader ────────────────────────────────────────────────

export const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.json5',
  '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.css', '.scss', '.less',
  '.md', '.txt', '.log', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.py', '.rb', '.rs', '.go', '.java', '.c', '.h', '.cpp', '.hpp', '.cs',
  '.swift', '.kt', '.lua', '.r', '.sql', '.graphql', '.proto',
  '.env', '.ini', '.cfg', '.conf', '.vue', '.svelte',
  '.gitignore', '.dockerignore', '.editorconfig',
]);

export const TEXT_FILENAMES = new Set([
  'Makefile', 'Dockerfile', 'Vagrantfile', 'Gemfile', 'Rakefile',
  'LICENSE', 'CHANGELOG', 'AUTHORS',
]);

const textReader: FileReader = {
  maxSize: 500 * 1024, // 500 KB
  async read(filePath, totalSize) {
    const bytesToRead = Math.min(totalSize, this.maxSize);
    const buf = Buffer.alloc(bytesToRead);
    const fd = await open(filePath, 'r');
    try {
      await fd.read(buf, 0, bytesToRead, 0);
    } finally {
      await fd.close();
    }
    return {
      content: buf.toString('utf8'),
      encoding: 'utf8' as const,
      mimeType: MIME_TYPES[extname(filePath).toLowerCase()] || 'text/plain',
      truncated: totalSize > this.maxSize,
    };
  },
};

// ── Image reader ───────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp',
]);

const imageReader: FileReader = {
  maxSize: 5 * 1024 * 1024, // 5 MB
  async read(filePath, totalSize) {
    if (totalSize > this.maxSize) {
      return {
        content: null,
        encoding: 'base64' as const,
        mimeType: MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
        truncated: true,
      };
    }
    const buf = await fsReadFile(filePath);
    return {
      content: buf.toString('base64'),
      encoding: 'base64' as const,
      mimeType: MIME_TYPES[extname(filePath).toLowerCase()] || 'image/png',
      truncated: false,
    };
  },
};

// ── Binary reader (fallback — metadata only) ───────────────────

const binaryReader: FileReader = {
  maxSize: 0,
  async read(filePath) {
    return {
      content: null,
      encoding: 'utf8' as const,
      mimeType: MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      truncated: false,
    };
  },
};

// ── MIME type lookup ───────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.ts': 'text/typescript', '.tsx': 'text/tsx', '.js': 'text/javascript',
  '.json': 'application/json', '.md': 'text/markdown', '.html': 'text/html',
  '.css': 'text/css', '.py': 'text/x-python', '.rs': 'text/x-rust',
  '.go': 'text/x-go', '.java': 'text/x-java', '.c': 'text/x-c',
  '.cpp': 'text/x-c++', '.rb': 'text/x-ruby', '.sh': 'text/x-shellscript',
  '.yaml': 'text/yaml', '.yml': 'text/yaml', '.xml': 'text/xml',
  '.sql': 'text/x-sql', '.txt': 'text/plain', '.log': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp',
};

// ── Register built-in readers ──────────────────────────────────

registerReader([...TEXT_EXTENSIONS], textReader);
registerReader([...IMAGE_EXTENSIONS], imageReader);

// ── Public API ─────────────────────────────────────────────────

/** Main entry point — called by connection.ts handleReadFile. */
export async function readFileForPreview(
  filePath: string,
  totalSize: number,
): Promise<FileReadResult & { fileName: string }> {
  const ext = extname(filePath).toLowerCase();
  const fileName = basename(filePath);

  const reader = (ext === '' && TEXT_FILENAMES.has(fileName))
    ? textReader
    : resolveReader(ext, totalSize);

  const result = await reader.read(filePath, totalSize);
  return { ...result, fileName };
}
