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

import { isAbsolute, join } from 'node:path';
import process from 'node:process';
import { env, process as podmanDesktopProcess } from '@podman-desktop/api';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';

/**
 * Manages file operation like parsing, deleting, copying, moving, etc.
 */
export class FileHelper {
  static readonly MACOS_EXTRA_PATH = '/opt/podman/bin:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin';
  static readonly LOCAL_BIN_DIR = '/usr/local/bin';

  getMincPath(): string | undefined {
    const processEnv = process.env;
    if (env.isMac) {
      if (!processEnv.PATH) {
        return FileHelper.MACOS_EXTRA_PATH;
      }
      return processEnv.PATH.concat(':').concat(FileHelper.MACOS_EXTRA_PATH);
    }
    return processEnv.PATH;
  }

  /**
   * Return the version and the path of an executable
   * @param executable
   */
  async getMincBinaryInfo(executable: string): Promise<{ version: string; path: string }> {
    // if absolute we do not include PATH
    if (isAbsolute(executable)) {
      const { stdout } = await podmanDesktopProcess.exec(executable, ['version']);
      return {
        version: this.parseMincVersion(stdout),
        path: executable,
      };
    }

    const mincPath = this.getMincPath() ?? '';
    const { stdout } = await podmanDesktopProcess.exec(executable, ['version'], { env: { PATH: mincPath } });
    return {
      version: this.parseMincVersion(stdout),
      path: await this.whereBinary(executable), // we need to where/which the executable to find its real path
    };
  }

  /**
   * Take as input the stdout of `minc version`
   * @param raw
   */
  parseMincVersion(raw: string): string {
    if (raw.startsWith('version: ')) {
      return raw.substring(9);
    }
    throw new Error('malformed minc output');
  }

  /**
   * Given an executable name will find where it is installed on the system
   * @param executable
   */
  async whereBinary(executable: string): Promise<string> {
    const mincPath = this.getMincPath() ?? '';
    // grab full path for Linux and mac
    if (env.isLinux || env.isMac) {
      try {
        const { stdout: fullPath } = await podmanDesktopProcess.exec('which', [executable], {
          env: { PATH: mincPath },
        });
        return fullPath;
      } catch (err) {
        console.warn('Error getting full path', err);
      }
    } else if (env.isWindows) {
      // grab full path for Windows
      try {
        const { stdout: fullPath } = await podmanDesktopProcess.exec('where.exe', [executable], {
          env: { PATH: mincPath },
        });
        // remove all line break/carriage return characters from full path
        return fullPath.replace(/(\r\n|\n|\r)/gm, '');
      } catch (err) {
        console.warn('Error getting full path', err);
      }
    }

    return executable;
  }

  getSystemBinaryPath(binaryName: string): string {
    if (env.isWindows) {
      return join(
        homedir(),
        'AppData',
        'Local',
        'Microsoft',
        'WindowsApps',
        binaryName.endsWith('.exe') ? binaryName : `${binaryName}.exe`,
      );
    }

    if (env.isLinux || env.isMac) {
      return join(FileHelper.LOCAL_BIN_DIR, binaryName);
    }
    throw new Error(`unsupported platform: ${process.platform}.`);
  }

  // Takes a binary path (e.g. /tmp/minc) and installs it to the system. Renames it based on binaryName
  async installBinaryToSystem(binaryPath: string, binaryName: string): Promise<string> {
    // Before copying the file, make sure it's executable (chmod +x) for Linux and Mac
    if (env.isLinux || env.isMac) {
      try {
        await podmanDesktopProcess.exec('chmod', ['+x', binaryPath]);
      } catch (error) {
        throw new Error(`Error making binary executable: ${error}`);
      }
    }

    // Create the appropriate destination path (Windows uses AppData/Local, Linux and Mac use /usr/local/bin)
    // and the appropriate command to move the binary to the destination path
    const destinationPath: string = this.getSystemBinaryPath(binaryName);
    let command: string;
    let args: string[];
    if (env.isWindows) {
      command = 'copy';
      args = [`"${binaryPath}"`, `"${destinationPath}"`];
    } else {
      command = 'cp';
      args = [binaryPath, destinationPath];
    }

    try {
      // Use admin prileges / ask for password for copying to /usr/local/bin
      await podmanDesktopProcess.exec(command, args, { isAdmin: true });
      return destinationPath;
    } catch (error) {
      console.error(`Failed to install '${binaryName}' binary: ${error}`);
      throw error;
    }
  }

  removeVersionPrefix(version: string): string {
    return version.replace('v', '').trim();
  }

  async deleteFile(filePath: string): Promise<void> {
    if (filePath && existsSync(filePath)) {
      try {
        await unlink(filePath);
      } catch (error: unknown) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error.code === 'EACCES' || error.code === 'EPERM')
        ) {
          await this.deleteFileAsAdmin(filePath);
        } else {
          throw error;
        }
      }
    }
  }

  async deleteFileAsAdmin(filePath: string): Promise<void> {
    const args: string[] = [filePath];
    const command = env.isWindows ? 'del' : 'rm';

    try {
      // Use admin privileges
      await podmanDesktopProcess.exec(command, args, { isAdmin: true });
    } catch (error) {
      console.error(`Failed to uninstall '${filePath}': ${error}`);
      throw error;
    }
  }

  async deleteExecutableAsAdmin(filePath: string): Promise<void> {
    const command = env.isWindows ? 'del' : 'rm';
    const checkCommand = env.isWindows ? 'where.exe' : 'which';
    let fileExistsPath = '';

    try {
      const { stdout: fullPath } = await podmanDesktopProcess.exec(checkCommand, [filePath]);
      fileExistsPath = fullPath;
    } catch (err) {
      if (err && typeof err === 'object' && 'stderr' in err) {
        console.log(err.stderr);
      } else {
        console.warn(`Error checking minc ${filePath} path`, err);
      }
    }

    if (fileExistsPath) {
      try {
        // Use admin privileges
        await podmanDesktopProcess.exec(command, [filePath], { isAdmin: true });
      } catch (error) {
        console.error(`Failed to uninstall '${filePath}': ${error}`);
        throw error;
      }
    }
  }
}
