/**
 * Tests for directory-handlers.ts — directory listing, file reading, workdir changes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleListDirectory, listDirectoryEntries, handleReadFile, handleChangeWorkDir } from '../../agent/src/directory-handlers.js';
import os from 'os';
import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { readFileForPreview } from '../../agent/src/file-readers.js';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, readdir: vi.fn(), stat: vi.fn() };
});

vi.mock('../../agent/src/file-readers.js', () => ({
  readFileForPreview: vi.fn(),
}));

describe('directory-handlers', () => {
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    send = vi.fn();
    vi.restoreAllMocks();
  });

  describe('listDirectoryEntries', () => {
    it('returns sorted entries, directories first', async () => {
      vi.mocked(readdir).mockResolvedValue([
        { name: 'zebra.txt', isDirectory: () => false },
        { name: 'alpha', isDirectory: () => true },
        { name: 'beta.js', isDirectory: () => false },
        { name: 'gamma', isDirectory: () => true },
      ] as any);

      const entries = await listDirectoryEntries('/test');
      expect(entries).toEqual([
        { name: 'alpha', type: 'directory' },
        { name: 'gamma', type: 'directory' },
        { name: 'beta.js', type: 'file' },
        { name: 'zebra.txt', type: 'file' },
      ]);
    });

    it('skips dotfiles and node_modules', async () => {
      vi.mocked(readdir).mockResolvedValue([
        { name: '.git', isDirectory: () => true },
        { name: 'node_modules', isDirectory: () => true },
        { name: 'src', isDirectory: () => true },
        { name: '.env', isDirectory: () => false },
      ] as any);

      const entries = await listDirectoryEntries('/test');
      expect(entries).toEqual([{ name: 'src', type: 'directory' }]);
    });
  });

  describe('handleListDirectory', () => {
    it('lists drives on Windows when dirPath is empty', async () => {
      const origPlatform = os.platform;
      vi.spyOn(os, 'platform').mockReturnValue('win32');
      vi.mocked(existsSync).mockImplementation((p) => {
        return p === 'C:\\' || p === 'D:\\';
      });

      await handleListDirectory({ dirPath: '' }, '/workdir', send);

      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'directory_listing',
        dirPath: '',
      }));
      const entries = send.mock.calls[0][0].entries;
      expect(entries).toContainEqual({ name: 'C:', type: 'directory' });
      expect(entries).toContainEqual({ name: 'D:', type: 'directory' });

      vi.mocked(os.platform).mockRestore();
    });

    it('lists root on Unix when dirPath is empty', async () => {
      vi.spyOn(os, 'platform').mockReturnValue('linux');
      vi.mocked(readdir).mockResolvedValue([
        { name: 'usr', isDirectory: () => true },
        { name: 'etc', isDirectory: () => true },
      ] as any);

      await handleListDirectory({ dirPath: '' }, '/workdir', send);

      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'directory_listing',
        dirPath: '/',
      }));
    });

    it('sends error on failure', async () => {
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));

      await handleListDirectory({ dirPath: '/nonexistent' }, '/workdir', send);

      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'directory_listing',
        error: 'ENOENT',
        entries: [],
      }));
    });

    it('passes source through', async () => {
      vi.mocked(readdir).mockResolvedValue([] as any);

      await handleListDirectory({ dirPath: '/test', source: 'file-browser' }, '/workdir', send);

      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'directory_listing',
        source: 'file-browser',
      }));
    });
  });

  describe('handleReadFile', () => {
    it('reads file and sends content', async () => {
      vi.mocked(stat).mockResolvedValue({ size: 100 } as any);
      vi.mocked(readFileForPreview).mockResolvedValue({
        content: 'hello world',
        encoding: 'utf8',
        mimeType: 'text/plain',
        truncated: false,
        fileName: 'test.txt',
      });

      await handleReadFile({ filePath: '/test/test.txt' }, '/workdir', send);

      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'file_content',
        content: 'hello world',
        fileName: 'test.txt',
        totalSize: 100,
      }));
    });

    it('sends error response on failure', async () => {
      vi.mocked(stat).mockRejectedValue(new Error('ENOENT'));

      await handleReadFile({ filePath: '/test/missing.txt' }, '/workdir', send);

      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'file_content',
        content: null,
        error: 'ENOENT',
      }));
    });
  });

  describe('handleChangeWorkDir', () => {
    it('updates workDir and sends notification', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      const state = { workDir: '/old' };
      const onListSessions = vi.fn();

      handleChangeWorkDir({ workDir: '/new' }, state, send, onListSessions);

      expect(state.workDir).toBe('/new');
      expect(send).toHaveBeenCalledWith({ type: 'workdir_changed', workDir: '/new' });
      expect(onListSessions).toHaveBeenCalled();
    });

    it('sends error when directory does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const state = { workDir: '/old' };
      const onListSessions = vi.fn();

      handleChangeWorkDir({ workDir: '/nonexistent' }, state, send, onListSessions);

      expect(state.workDir).toBe('/old');
      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('/nonexistent'),
      }));
      expect(onListSessions).not.toHaveBeenCalled();
    });
  });
});
