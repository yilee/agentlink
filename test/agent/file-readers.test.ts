import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFileForPreview, registerReader, type FileReader } from '../../agent/src/file-readers.js';

const TEST_DIR = join(tmpdir(), `agentlink-test-file-readers-${process.pid}`);

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('file-readers', () => {
  describe('text reader', () => {
    it('reads a .ts file as utf8 text', async () => {
      const filePath = join(TEST_DIR, 'hello.ts');
      const content = 'const x: number = 42;\n';
      writeFileSync(filePath, content);

      const result = await readFileForPreview(filePath, Buffer.byteLength(content));

      expect(result.fileName).toBe('hello.ts');
      expect(result.content).toBe(content);
      expect(result.encoding).toBe('utf8');
      expect(result.mimeType).toBe('text/typescript');
      expect(result.truncated).toBe(false);
    });

    it('reads a .json file with correct MIME', async () => {
      const filePath = join(TEST_DIR, 'config.json');
      const content = '{"key": "value"}';
      writeFileSync(filePath, content);

      const result = await readFileForPreview(filePath, Buffer.byteLength(content));

      expect(result.mimeType).toBe('application/json');
      expect(result.content).toBe(content);
    });

    it('reads a .py file with correct MIME', async () => {
      const filePath = join(TEST_DIR, 'script.py');
      const content = 'print("hello")\n';
      writeFileSync(filePath, content);

      const result = await readFileForPreview(filePath, Buffer.byteLength(content));

      expect(result.mimeType).toBe('text/x-python');
    });

    it('truncates text files exceeding 100 KB', async () => {
      const filePath = join(TEST_DIR, 'large.txt');
      const content = 'x'.repeat(200 * 1024); // 200 KB
      writeFileSync(filePath, content);

      const result = await readFileForPreview(filePath, Buffer.byteLength(content));

      expect(result.truncated).toBe(true);
      expect(result.content!.length).toBe(100 * 1024);
      expect(result.encoding).toBe('utf8');
    });

    it('reads a known filename without extension (Makefile)', async () => {
      const filePath = join(TEST_DIR, 'Makefile');
      const content = 'all:\n\techo hello\n';
      writeFileSync(filePath, content);

      const result = await readFileForPreview(filePath, Buffer.byteLength(content));

      expect(result.fileName).toBe('Makefile');
      expect(result.content).toBe(content);
      expect(result.encoding).toBe('utf8');
      expect(result.mimeType).toBe('text/plain');
    });
  });

  describe('image reader', () => {
    it('reads a .png file as base64', async () => {
      const filePath = join(TEST_DIR, 'icon.png');
      // Minimal valid PNG: 1x1 transparent pixel
      const pngData = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        'base64',
      );
      writeFileSync(filePath, pngData);

      const result = await readFileForPreview(filePath, pngData.length);

      expect(result.fileName).toBe('icon.png');
      expect(result.encoding).toBe('base64');
      expect(result.mimeType).toBe('image/png');
      expect(result.truncated).toBe(false);
      expect(result.content).toBe(pngData.toString('base64'));
    });

    it('returns truncated for images exceeding 5 MB', async () => {
      const filePath = join(TEST_DIR, 'huge.jpg');
      // Don't actually write 5 MB; just pass a large totalSize
      writeFileSync(filePath, 'not-a-real-image');
      const fakeSize = 6 * 1024 * 1024; // 6 MB

      const result = await readFileForPreview(filePath, fakeSize);

      expect(result.fileName).toBe('huge.jpg');
      expect(result.content).toBeNull();
      expect(result.truncated).toBe(true);
      expect(result.mimeType).toBe('image/jpeg');
    });

    it('reads .svg with correct MIME', async () => {
      const filePath = join(TEST_DIR, 'logo.svg');
      const svgData = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      writeFileSync(filePath, svgData);

      const result = await readFileForPreview(filePath, svgData.length);

      expect(result.encoding).toBe('base64');
      expect(result.mimeType).toBe('image/svg+xml');
    });
  });

  describe('binary reader (fallback)', () => {
    it('returns metadata only for unknown binary extensions', async () => {
      const filePath = join(TEST_DIR, 'data.bin');
      const content = Buffer.alloc(200 * 1024); // 200 KB — too large for text fallback
      writeFileSync(filePath, content);

      const result = await readFileForPreview(filePath, content.length);

      expect(result.fileName).toBe('data.bin');
      expect(result.content).toBeNull();
      expect(result.encoding).toBe('utf8');
      expect(result.mimeType).toBe('application/octet-stream');
      expect(result.truncated).toBe(false);
    });

    it('falls back to text reader for small unknown-extension files', async () => {
      const filePath = join(TEST_DIR, 'data.xyz');
      const content = 'some small content';
      writeFileSync(filePath, content);

      const result = await readFileForPreview(filePath, Buffer.byteLength(content));

      expect(result.content).toBe(content);
      expect(result.encoding).toBe('utf8');
    });
  });

  describe('unknown extension without dot (no extension)', () => {
    it('reads small extensionless file as text', async () => {
      const filePath = join(TEST_DIR, 'README');
      const content = 'This is a readme\n';
      writeFileSync(filePath, content);

      const result = await readFileForPreview(filePath, Buffer.byteLength(content));

      expect(result.content).toBe(content);
      expect(result.encoding).toBe('utf8');
    });
  });

  describe('registerReader (extensibility)', () => {
    it('allows registering a custom reader', async () => {
      const filePath = join(TEST_DIR, 'doc.custom');
      writeFileSync(filePath, 'custom content');

      const customReader: FileReader = {
        maxSize: 1024,
        async read(_filePath, _totalSize) {
          return {
            content: 'custom-transformed',
            encoding: 'utf8' as const,
            mimeType: 'text/x-custom',
            truncated: false,
          };
        },
      };

      registerReader(['.custom'], customReader);

      const result = await readFileForPreview(filePath, 14);

      expect(result.content).toBe('custom-transformed');
      expect(result.mimeType).toBe('text/x-custom');
    });
  });

  describe('error handling', () => {
    it('throws for non-existent file', async () => {
      const filePath = join(TEST_DIR, 'does-not-exist.ts');

      await expect(readFileForPreview(filePath, 100)).rejects.toThrow();
    });
  });
});
