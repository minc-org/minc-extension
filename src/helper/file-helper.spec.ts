/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { FileHelper } from './file-helper';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Container } from 'inversify';
import type { RunResult } from '@podman-desktop/api';
import { env, process as podmanDesktopProcess } from '@podman-desktop/api';
import { afterEach } from 'node:test';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

vi.mock(import('node:fs'));
vi.mock(import('node:fs/promises'));
vi.mock(import('node:os'));
vi.mock(import('node:path'));

let fileHelper: FileHelper;
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();

  vi.mocked(env).isLinux = false;
  vi.mocked(env).isWindows = false;
  vi.mocked(env).isMac = false;

  // create fresh instance each time
  const container = new Container();
  container.bind(FileHelper).toSelf().inSingletonScope();

  fileHelper = await container.getAsync(FileHelper);
});

describe('getMincPath', () => {
  const originalProcessEnv = process.env;
  beforeEach(() => {
    process.env = {};
  });

  afterEach(() => {
    process.env = originalProcessEnv;
  });

  test('should return default path on macOS if no custom PATH', async () => {
    vi.mocked(env).isMac = true;
    const mincPath = fileHelper.getMincPath();
    expect(mincPath).toBe('/opt/podman/bin:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin');
  });

  test('should return additional path on macOS if custom PATH', async () => {
    vi.mocked(env).isMac = true;
    process.env.PATH = '/custom/path';
    const mincPath = fileHelper.getMincPath();
    expect(mincPath).toBe('/custom/path:/opt/podman/bin:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin');
  });

  test('should return default PATH if not macOS', async () => {
    vi.mocked(env).isWindows = true;
    process.env.PATH = '/custom/path';
    const mincPath = fileHelper.getMincPath();
    expect(mincPath).toBe('/custom/path');
  });
});

describe('getMincBinaryInfo', () => {
  test('should return version and path for an absolute executable', async () => {
    vi.mocked(isAbsolute).mockReturnValue(true);
    vi.mocked(podmanDesktopProcess.exec).mockResolvedValue({ stdout: 'version: 0.0.3' } as RunResult);

    const result = await fileHelper.getMincBinaryInfo('/usr/local/bin/minc');
    expect(result).toEqual({
      version: '0.0.3',
      path: '/usr/local/bin/minc',
    });
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('/usr/local/bin/minc', ['version']);
  });

  test('should return version and resolved path for a relative executable', async () => {
    vi.mocked(isAbsolute).mockReturnValue(false);
    vi.spyOn(fileHelper, 'getMincPath').mockReturnValue('/custom/path');
    vi.mocked(podmanDesktopProcess.exec).mockResolvedValue({ stdout: 'version: 0.0.4' } as RunResult);
    vi.spyOn(fileHelper, 'whereBinary').mockResolvedValue('/resolved/path/minc');

    const result = await fileHelper.getMincBinaryInfo('minc');
    expect(result).toEqual({
      version: '0.0.4',
      path: '/resolved/path/minc',
    });
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('minc', ['version'], { env: { PATH: '/custom/path' } });
    expect(fileHelper.whereBinary).toHaveBeenCalledWith('minc');
  });

  test('should return version and resolved path for a relative executable with no minc path', async () => {
    vi.mocked(isAbsolute).mockReturnValue(false);
    vi.spyOn(fileHelper, 'getMincPath').mockReturnValue(undefined);
    vi.mocked(podmanDesktopProcess.exec).mockResolvedValue({ stdout: 'version: 0.0.4' } as RunResult);
    vi.spyOn(fileHelper, 'whereBinary').mockResolvedValue('/resolved/path/minc');

    const result = await fileHelper.getMincBinaryInfo('minc');
    expect(result).toEqual({
      version: '0.0.4',
      path: '/resolved/path/minc',
    });
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('minc', ['version'], { env: { PATH: '' } });
    expect(fileHelper.whereBinary).toHaveBeenCalledWith('minc');
  });

  test('should handle errors from podmanDesktopProcess.exec', async () => {
    vi.mocked(isAbsolute).mockReturnValue(true);
    vi.mocked(podmanDesktopProcess.exec).mockRejectedValue(new Error('Execution failed'));

    await expect(fileHelper.getMincBinaryInfo('/usr/local/bin/minc')).rejects.toThrow('Execution failed');
  });
});

describe('parseMincVersion', () => {
  test('should return version from minc version output', async () => {
    const version = fileHelper.parseMincVersion('version: 0.0.4');
    expect(version).toBe('0.0.4');
  });

  test('should throw error if invalid', async () => {
    expect(() => fileHelper.parseMincVersion('invalid output')).toThrowError('malformed minc output');
  });
});

describe('whereBinary', () => {
  test('should return path calling which on Linux', async () => {
    vi.mocked(env).isLinux = true;
    vi.spyOn(fileHelper, 'getMincPath').mockReturnValue(undefined);
    const resolvedWhichPath = '/this/is/the/full/linux/minc-path';
    vi.mocked(podmanDesktopProcess.exec).mockResolvedValue({ stdout: resolvedWhichPath } as RunResult);

    const computedPath = await fileHelper.whereBinary('minc');
    expect(computedPath).toBe(resolvedWhichPath);
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith(
      'which',
      ['minc'],
      expect.objectContaining({ env: { PATH: expect.any(String) } }),
    );
  });

  test('should return path calling which on mac', async () => {
    vi.mocked(env).isMac = true;
    const resolvedWhichPath = '/this/is/the/full/mac/minc-path';
    vi.mocked(podmanDesktopProcess.exec).mockResolvedValue({ stdout: resolvedWhichPath } as RunResult);

    const computedPath = await fileHelper.whereBinary('minc');
    expect(computedPath).toBe(resolvedWhichPath);
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith(
      'which',
      ['minc'],
      expect.objectContaining({ env: { PATH: expect.any(String) } }),
    );
  });

  test('should return executable if not able to execute which', async () => {
    vi.mocked(env).isMac = true;
    vi.mocked(podmanDesktopProcess.exec).mockRejectedValue(new Error('fake error executing which'));

    const computedPath = await fileHelper.whereBinary('minc');
    expect(computedPath).toBe('minc');
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith(
      'which',
      ['minc'],
      expect.objectContaining({ env: { PATH: expect.any(String) } }),
    );
  });

  test('should return path calling where on windows', async () => {
    vi.mocked(env).isWindows = true;
    const resolvedWhichPath = 'c:\\this\\is\\the\\full\\windows\\minc-path.exe';
    vi.mocked(podmanDesktopProcess.exec).mockResolvedValue({ stdout: resolvedWhichPath } as RunResult);

    const computedPath = await fileHelper.whereBinary('minc.exe');
    expect(computedPath).toBe(resolvedWhichPath);
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith(
      'where.exe',
      ['minc.exe'],
      expect.objectContaining({ env: { PATH: expect.any(String) } }),
    );
  });

  test('should return executable if not able to execute which', async () => {
    vi.mocked(env).isWindows = true;
    vi.mocked(podmanDesktopProcess.exec).mockRejectedValue(new Error('fake error executing which'));

    const computedPath = await fileHelper.whereBinary('minc.exe');
    expect(computedPath).toBe('minc.exe');
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith(
      'where.exe',
      ['minc.exe'],
      expect.objectContaining({ env: { PATH: expect.any(String) } }),
    );
  });
});

describe('getSystemBinaryPath', () => {
  beforeEach(() => {
    vi.mocked(join).mockImplementation((...args: string[]) => args.join('/'));
  });

  test('should return path from homedir on Windows', async () => {
    vi.mocked(env).isWindows = true;
    vi.mocked(homedir).mockReturnValue('c:\\users\\testuser');
    const sysPath = fileHelper.getSystemBinaryPath('minc.exe');
    // replace all backslashes with forward slashes
    expect(sysPath.replace(/\\/g, '/')).toBe('c:/users/testuser/AppData/Local/Microsoft/WindowsApps/minc.exe');
  });

  test('should return path from with .exe suffix on Windows', async () => {
    vi.mocked(env).isWindows = true;
    vi.mocked(homedir).mockReturnValue('c:\\users\\testuser');
    const sysPath = fileHelper.getSystemBinaryPath('minc');
    // should also have the .exe appended
    expect(sysPath).toContain('minc.exe');
  });

  test('should return path from local bin dir on mac', async () => {
    vi.mocked(env).isMac = true;
    const sysPath = fileHelper.getSystemBinaryPath('minc');
    // replace all backslashes with forward slashes
    expect(sysPath.replace(/\\/g, '/')).toBe('/usr/local/bin/minc');
  });

  test('should return path from local bin dir on linux', async () => {
    vi.mocked(env).isLinux = true;
    const sysPath = fileHelper.getSystemBinaryPath('minc');
    // replace all backslashes with forward slashes
    expect(sysPath.replace(/\\/g, '/')).toBe('/usr/local/bin/minc');
  });

  test('should return error if no OS', async () => {
    expect(() => fileHelper.getSystemBinaryPath('minc')).toThrowError('unsupported platform');
  });
});

describe('installBinaryToSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should make binary executable on Linux/Mac and copy it', async () => {
    vi.mocked(env).isMac = true;
    vi.spyOn(fileHelper, 'getSystemBinaryPath').mockReturnValue('/usr/local/bin/testBinary');

    const fakeBinaryPath = '/fake/binary/path';
    const fakeBinary = 'fakeBinary';
    const result = await fileHelper.installBinaryToSystem(fakeBinaryPath, fakeBinary);
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('chmod', ['+x', fakeBinaryPath]);
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('cp', [fakeBinaryPath, '/usr/local/bin/testBinary'], {
      isAdmin: true,
    });
    expect(result).toBe('/usr/local/bin/testBinary');
  });

  test('should copy binary on Windows without chmod', async () => {
    vi.mocked(env).isWindows = true;
    vi.spyOn(fileHelper, 'getSystemBinaryPath').mockReturnValue('C:\\Users\\AppData\\Local\\testBinary.exe');

    const fakeBinaryPath = 'C:\\testBinary.exe';
    const fakeBinary = 'fakeBinary';

    const result = await fileHelper.installBinaryToSystem(fakeBinaryPath, fakeBinary);
    expect(podmanDesktopProcess.exec).not.toHaveBeenCalledWith('chmod', expect.anything());
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith(
      'copy',
      [`"${fakeBinaryPath}"`, '"C:\\Users\\AppData\\Local\\testBinary.exe"'],
      { isAdmin: true },
    );
    expect(result).toBe('C:\\Users\\AppData\\Local\\testBinary.exe');
  });

  test('should throw an error if chmod fails', async () => {
    vi.mocked(env).isMac = true;
    vi.mocked(podmanDesktopProcess.exec).mockRejectedValueOnce(new Error('chmod failed'));
    const fakeBinaryPath = '/fake/binary/path';
    const fakeBinary = 'fakeBinary';
    await expect(fileHelper.installBinaryToSystem(fakeBinaryPath, fakeBinary)).rejects.toThrow(
      'Error making binary executable: Error: chmod failed',
    );
  });

  test('should throw an error if copying the binary fails', async () => {
    vi.mocked(env).isLinux = true;
    vi.spyOn(fileHelper, 'getSystemBinaryPath').mockReturnValue('/usr/local/bin/testBinary');

    vi.mocked(podmanDesktopProcess.exec).mockResolvedValueOnce({} as RunResult); // chmod success
    const copyError = new Error('copy failed');
    vi.mocked(podmanDesktopProcess.exec).mockRejectedValueOnce(copyError);

    const fakeBinaryPath = '/fake/binary/path';
    const fakeBinary = 'fakeBinary';
    await expect(fileHelper.installBinaryToSystem(fakeBinaryPath, fakeBinary)).rejects.toThrow(copyError);
  });
});

describe('removeVersionPrefix', () => {
  test('should remove prefix v from version string', () => {
    expect(fileHelper.removeVersionPrefix('v1.2.3')).toBe('1.2.3');
  });

  test('should return the same string if no v prefix', () => {
    expect(fileHelper.removeVersionPrefix('1.2.3')).toBe('1.2.3');
  });

  test('should handle multiple v occurrences correctly', () => {
    expect(fileHelper.removeVersionPrefix('vv1.2.3')).toBe('v1.2.3');
  });

  test('should trim whitespace after removing v', () => {
    expect(fileHelper.removeVersionPrefix('v1.2.3 ')).toBe('1.2.3');
  });

  test('should return an empty string if input is just v', () => {
    expect(fileHelper.removeVersionPrefix('v')).toBe('');
  });

  test('should return an empty string if input is empty', () => {
    expect(fileHelper.removeVersionPrefix('')).toBe('');
  });
});

describe('deleteFile', () => {
  test('should delete file if it exists', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    await fileHelper.deleteFile('/path/to/file');
    expect(unlink).toHaveBeenCalledWith('/path/to/file');
  });

  test('should not attempt to delete a non-existing file', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await fileHelper.deleteFile('/path/to/nonexistent');
    expect(unlink).not.toHaveBeenCalled();
  });

  test('should attempt to delete as admin if permission error EACCESS occurs', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(unlink).mockRejectedValue({ code: 'EACCES' });
    vi.spyOn(fileHelper, 'deleteFileAsAdmin').mockResolvedValue(undefined);

    await fileHelper.deleteFile('/path/to/file');
    expect(fileHelper.deleteFileAsAdmin).toHaveBeenCalledWith('/path/to/file');
  });

  test('should attempt to delete as admin if permission error EPERM occurs', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(unlink).mockRejectedValue({ code: 'EPERM' });
    vi.spyOn(fileHelper, 'deleteFileAsAdmin').mockResolvedValue(undefined);

    await fileHelper.deleteFile('/path/to/file');
    expect(fileHelper.deleteFileAsAdmin).toHaveBeenCalledWith('/path/to/file');
  });

  test('should throw error if unlink fails with an unknown error', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(unlink).mockRejectedValue(new Error('Unexpected error'));

    await expect(fileHelper.deleteFile('/path/to/file')).rejects.toThrow('Unexpected error');
  });
});

describe('deleteFileAsAdmin', () => {
  test('should delete file using rm on non-Windows systems', async () => {
    vi.mocked(env).isMac = true;
    await fileHelper.deleteFileAsAdmin('/path/to/file');
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('rm', ['/path/to/file'], { isAdmin: true });
  });

  test('should delete file using del on Windows', async () => {
    vi.mocked(env).isWindows = true;
    await fileHelper.deleteFileAsAdmin('C:\\path\\to\\file');
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('del', ['C:\\path\\to\\file'], { isAdmin: true });
  });

  test('should throw an error if deletion fails', async () => {
    vi.mocked(podmanDesktopProcess.exec).mockRejectedValue(new Error('Deletion failed'));
    await expect(fileHelper.deleteFileAsAdmin('/path/to/file')).rejects.toThrow('Deletion failed');
  });
});

describe('deleteExecutableAsAdmin', () => {
  test('should delete executable using rm on non-Windows systems if it exists', async () => {
    vi.mocked(env).isMac = true;
    vi.mocked(podmanDesktopProcess.exec).mockResolvedValueOnce({ stdout: '/usr/local/bin/testBinary' } as RunResult);

    await fileHelper.deleteExecutableAsAdmin('testBinary');
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('which', ['testBinary']);
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('rm', ['testBinary'], { isAdmin: true });
  });

  test('should delete executable using del on Windows if it exists', async () => {
    vi.mocked(env).isWindows = true;
    vi.mocked(podmanDesktopProcess.exec).mockResolvedValueOnce({
      stdout: 'C:\\Program Files\\testBinary.exe',
    } as RunResult);

    await fileHelper.deleteExecutableAsAdmin('testBinary.exe');
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('where.exe', ['testBinary.exe']);
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('del', ['testBinary.exe'], { isAdmin: true });
  });

  test('should not attempt to delete if executable does not exist', async () => {
    vi.mocked(podmanDesktopProcess.exec).mockRejectedValueOnce({ stderr: 'not found' });

    await fileHelper.deleteExecutableAsAdmin('nonexistentBinary');
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('which', ['nonexistentBinary']);
    expect(podmanDesktopProcess.exec).not.toHaveBeenCalledWith('rm', expect.anything(), expect.anything());
    expect(podmanDesktopProcess.exec).not.toHaveBeenCalledWith('del', expect.anything(), expect.anything());
  });

  test('should not attempt to delete if executable does not exist unknown error', async () => {
    vi.mocked(podmanDesktopProcess.exec).mockRejectedValueOnce({});

    await fileHelper.deleteExecutableAsAdmin('nonexistentBinary');
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('which', ['nonexistentBinary']);
    expect(podmanDesktopProcess.exec).not.toHaveBeenCalledWith('rm', expect.anything(), expect.anything());
    expect(podmanDesktopProcess.exec).not.toHaveBeenCalledWith('del', expect.anything(), expect.anything());
  });

  test('should throw an error if deletion fails', async () => {
    vi.mocked(podmanDesktopProcess.exec).mockResolvedValueOnce({ stdout: '/usr/local/bin/testBinary' } as RunResult);
    vi.mocked(podmanDesktopProcess.exec).mockRejectedValueOnce(new Error('Deletion failed'));

    await expect(fileHelper.deleteExecutableAsAdmin('testBinary')).rejects.toThrow('Deletion failed');
  });
});
