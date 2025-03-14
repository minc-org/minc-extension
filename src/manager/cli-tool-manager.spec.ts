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
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Container, injectable, injectFromBase } from 'inversify';
import { CliToolManager } from './cli-tool-manager';
import type {
  CliTool,
  CliToolInstaller,
  CliToolSelectUpdate,
  CliToolUpdate,
  ExtensionContext,
  Logger,
  TelemetryLogger,
} from '@podman-desktop/api';
import { cli } from '@podman-desktop/api';
import { ExtensionContextSymbol, TelemetryLoggerSymbol } from '../inject/symbol';
import { GitHubHelper, type MincGithubReleaseArtifactMetadata } from '../helper/github-helper';
import { FileHelper } from '../helper/file-helper';
import { normalize } from 'node:path';

let cliToolManager: TestCliToolManager;

vi.mock(import('node:path'));

@injectable()
@injectFromBase()
class TestCliToolManager extends CliToolManager {
  public getMincCli(): CliTool | undefined {
    return super.getMincCli();
  }

  public setMincCli(cliTool: CliTool): void {
    super.setMincCli(cliTool);
  }

  public setMincPath(mincPath: string): void {
    super.setMincPath(mincPath);
  }

  public getUpdate(
    latestAsset?: MincGithubReleaseArtifactMetadata,
    latestVersion?: string,
  ): (CliToolUpdate | CliToolSelectUpdate) & { version?: string } {
    return super.getUpdate(latestAsset, latestVersion);
  }

  public getInstaller(update: { version?: string }, latestVersion?: string): CliToolInstaller {
    return super.getInstaller(update, latestVersion);
  }
}

const telemetryLoggerMock = {
  logUsage: vi.fn(),
} as unknown as TelemetryLogger;

const extensionContextMock: ExtensionContext = {
  subscriptions: [],
} as unknown as ExtensionContext;

const githubHelperMock = {
  getCliStoragePath: vi.fn(),
  getLatestVersionAsset: vi.fn(),
  download: vi.fn(),
  promptUserForVersion: vi.fn(),
} as unknown as GitHubHelper;

const fileHelperMock = {
  getMincBinaryInfo: vi.fn(),
  deleteFile: vi.fn(),
  deleteExecutableAsAdmin: vi.fn(),
  getSystemBinaryPath: vi.fn(),
  installBinaryToSystem: vi.fn(),
  removeVersionPrefix: vi.fn(),
} as unknown as FileHelper;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();

  // create fresh instance each time
  const container = new Container();
  container.bind(TelemetryLoggerSymbol).toConstantValue(telemetryLoggerMock);
  container.bind(ExtensionContextSymbol).toConstantValue(extensionContextMock);
  container.bind(GitHubHelper).toConstantValue(githubHelperMock);
  container.bind(FileHelper).toConstantValue(fileHelperMock);

  // clear subscriptions
  extensionContextMock.subscriptions.length = 0;

  container.bind(TestCliToolManager).toSelf();

  cliToolManager = await container.getAsync<TestCliToolManager>(TestCliToolManager);
});

test('should initialize with undefined path', () => {
  expect(cliToolManager.getPath()).toBeUndefined();
});

test('should return false for isInstalled initially', () => {
  expect(cliToolManager.isInstalled()).toBeFalsy();
});

describe('registerCliTool', () => {
  test('registerCliTool but not already system wide installed', async () => {
    const localPathCliStorage = 'fake-cli-storage-path/bin/minc';
    // first time, reject
    vi.mocked(fileHelperMock.getMincBinaryInfo).mockRejectedValueOnce(new Error('does not exist'));

    // second time, resolve from the storage path
    vi.mocked(fileHelperMock.getMincBinaryInfo).mockResolvedValueOnce({ path: localPathCliStorage, version: '0.0.4' });

    const registerUpdate = vi.fn();
    const registerInstaller = vi.fn();
    vi.mocked(cli.createCliTool).mockReturnValue({
      name: 'minc',
      displayName: 'Minc',
      version: '0.0.4',
      registerUpdate,
      registerInstaller,
    } as unknown as CliTool);

    // there is a new version
    vi.mocked(githubHelperMock.getLatestVersionAsset).mockResolvedValue({
      tag: 'v0.0.88',
    } as unknown as MincGithubReleaseArtifactMetadata);
    vi.mocked(fileHelperMock.removeVersionPrefix).mockReturnValue('0.0.88');
    vi.mocked(githubHelperMock.getCliStoragePath).mockReturnValue(localPathCliStorage);

    await cliToolManager.registerCliTool();

    expect(cliToolManager.getPath()).toBe(localPathCliStorage);
    expect(cliToolManager.isInstalled()).toBe(true);

    expect(registerUpdate).toHaveBeenCalled();
    expect(registerInstaller).toHaveBeenCalled();

    expect(githubHelperMock.getLatestVersionAsset).toHaveBeenCalled();
    expect(extensionContextMock.subscriptions).toHaveLength(1);

    expect(cli.createCliTool).toHaveBeenCalledWith({
      name: 'minc',
      images: { icon: './icon.png' },
      displayName: 'Minc',
      version: '0.0.4',
      installationSource: 'extension',
      markdownDescription: 'Minc MicroShift CLI',
      path: localPathCliStorage,
    });

    // now check the register Update
    const update: CliToolUpdate = registerUpdate.mock.calls[0][0];
    expect(update).toBeDefined();
    expect(update.version).toBe('0.0.88');
  });

  test('registerCliTool should attempt to fetch binary information', async () => {
    vi.mocked(normalize).mockImplementation((path: string) => path);
    vi.mocked(fileHelperMock.getMincBinaryInfo).mockResolvedValue({
      path: '/another/system/path/minc',
      version: '0.0.4',
    });
    vi.mocked(fileHelperMock.getSystemBinaryPath).mockReturnValue('/usr/local/bin/minc');

    const registerUpdate = vi.fn();
    const registerInstaller = vi.fn();
    vi.mocked(cli.createCliTool).mockReturnValue({
      name: 'minc',
      displayName: 'Minc',
      version: '0.0.4',
      registerUpdate,
      registerInstaller,
    } as unknown as CliTool);

    await cliToolManager.registerCliTool();

    expect(cli.createCliTool).toHaveBeenCalledWith({
      name: 'minc',
      images: { icon: './icon.png' },
      displayName: 'Minc',
      version: '0.0.4',
      installationSource: 'external',
      markdownDescription: 'Minc MicroShift CLI',
      path: '/another/system/path/minc',
    });

    expect(cliToolManager.getPath()).toBe('/another/system/path/minc');
    expect(cliToolManager.isInstalled()).toBe(true);

    expect(registerUpdate).not.toHaveBeenCalled();
    expect(registerInstaller).not.toHaveBeenCalled();

    expect(githubHelperMock.getLatestVersionAsset).not.toHaveBeenCalled();
    expect(extensionContextMock.subscriptions).toHaveLength(1);
  });

  test('registerCliTool fail with normalize', async () => {
    vi.mocked(normalize).mockImplementation((path: string) => path);
    vi.mocked(fileHelperMock.getMincBinaryInfo).mockResolvedValue({ path: '/usr/local/bin/minc', version: '0.0.4' });
    vi.mocked(fileHelperMock.getSystemBinaryPath).mockReturnValue('/usr/local/bin/minc');

    vi.mocked(githubHelperMock.getLatestVersionAsset).mockRejectedValueOnce(new Error('fake error'));

    const registerUpdate = vi.fn();
    const registerInstaller = vi.fn();
    vi.mocked(cli.createCliTool).mockReturnValue({
      name: 'minc',
      displayName: 'Minc',
      version: '0.0.4',
      registerUpdate,
      registerInstaller,
    } as unknown as CliTool);

    await cliToolManager.registerCliTool();

    expect(cli.createCliTool).toHaveBeenCalledWith({
      name: 'minc',
      images: { icon: './icon.png' },
      displayName: 'Minc',
      version: '0.0.4',
      installationSource: 'extension',
      markdownDescription: 'Minc MicroShift CLI',
      path: '/usr/local/bin/minc',
    });

    expect(cliToolManager.getPath()).toBe('/usr/local/bin/minc');
    expect(cliToolManager.isInstalled()).toBeTruthy();
  });

  test('registerCliTool failing to get binary info from storage', async () => {
    vi.mocked(normalize).mockImplementation((path: string) => path);
    vi.mocked(fileHelperMock.getMincBinaryInfo).mockRejectedValue(new Error('fake error'));
    vi.mocked(fileHelperMock.getSystemBinaryPath).mockReturnValue('/usr/local/bin/minc');

    vi.mocked(githubHelperMock.getLatestVersionAsset).mockRejectedValueOnce(new Error('fake error'));

    const registerUpdate = vi.fn();
    const registerInstaller = vi.fn();
    vi.mocked(cli.createCliTool).mockReturnValue({
      name: 'minc',
      displayName: 'Minc',
      version: '0.0.4',
      registerUpdate,
      registerInstaller,
    } as unknown as CliTool);

    await cliToolManager.registerCliTool();

    expect(cli.createCliTool).toHaveBeenCalledWith({
      name: 'minc',
      images: { icon: './icon.png' },
      displayName: 'Minc',
      version: undefined,
      installationSource: undefined,
      markdownDescription: 'Minc MicroShift CLI',
      path: undefined,
    });

    expect(cliToolManager.getPath()).toBe(undefined);
    expect(cliToolManager.isInstalled()).toBeFalsy();
  });
});

describe('installLatest', () => {
  test('installLatest should download and install latest version', async () => {
    const mockLatestRelease = { tag: 'v0.0.3' };
    vi.mocked(githubHelperMock.getLatestVersionAsset).mockResolvedValue(
      mockLatestRelease as unknown as MincGithubReleaseArtifactMetadata,
    );
    const fakePath = 'fake-minc';
    vi.mocked(githubHelperMock.download).mockResolvedValue(fakePath);
    vi.mocked(fileHelperMock.installBinaryToSystem).mockResolvedValue('/usr/local/bin/minc');

    // register a fake cliTool
    const fakeCliTool = {
      updateVersion: vi.fn(),
    } as unknown as CliTool;
    cliToolManager.setMincCli(fakeCliTool);

    vi.mocked(fileHelperMock.removeVersionPrefix).mockReturnValue('0.0.3');

    const installedPath = await cliToolManager.installLatest();

    expect(installedPath).toBe('/usr/local/bin/minc');

    // check we called update version on mincCli
    expect(fakeCliTool.updateVersion).toHaveBeenCalledWith({
      installationSource: 'extension',
      path: '/usr/local/bin/minc',
      version: '0.0.3',
    });
  });

  test('installLatest without being to install system wide', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log');
    consoleLogSpy.mockReturnValue();
    const mockLatestRelease = { tag: 'v0.0.3' };
    vi.mocked(githubHelperMock.getLatestVersionAsset).mockResolvedValue(
      mockLatestRelease as unknown as MincGithubReleaseArtifactMetadata,
    );
    const fakePath = 'fake-minc';
    vi.mocked(githubHelperMock.download).mockResolvedValue(fakePath);
    vi.mocked(fileHelperMock.installBinaryToSystem).mockRejectedValue(
      new Error('fake error when installing in system'),
    );

    // register a fake cliTool
    const fakeCliTool = {
      updateVersion: vi.fn(),
    } as unknown as CliTool;
    cliToolManager.setMincCli(fakeCliTool);

    vi.mocked(fileHelperMock.removeVersionPrefix).mockReturnValue('0.0.3');

    const installedPath = await cliToolManager.installLatest();

    // expect it's not a system path
    expect(installedPath).toBe(fakePath);

    // check we called update version on mincCli
    expect(fakeCliTool.updateVersion).toHaveBeenCalledWith({
      installationSource: 'extension',
      path: fakePath,
      version: '0.0.3',
    });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'minc not updated system-wide. Error: Error: fake error when installing in system',
    );
  });
});

describe('getUpdate', () => {
  test('should return an update object with version when latestVersion differs', () => {
    const latestVersion = '1.1.0';
    const update = cliToolManager.getUpdate(undefined, latestVersion);
    expect(update.version).toBe(latestVersion);
  });

  test('should return an update object without version when latestVersion matches current version', () => {
    const latestVersion = '1.0.0'; // Same as current version
    cliToolManager.setMincCli({ version: '1.0.0' } as CliTool);

    const update = cliToolManager.getUpdate(undefined, latestVersion);
    expect(update.version).toBeUndefined();
  });

  test('should select a version and remove prefix', async () => {
    vi.mocked(githubHelperMock.promptUserForVersion).mockResolvedValue({
      tag: 'v1.2.0',
    } as MincGithubReleaseArtifactMetadata);
    vi.mocked(fileHelperMock.removeVersionPrefix).mockImplementation((version: string) => version.replace('v', ''));
    const update = cliToolManager.getUpdate() as CliToolSelectUpdate;
    const selectedVersion = await update.selectVersion();

    expect(selectedVersion).toBe('1.2.0');
    expect(fileHelperMock.removeVersionPrefix).toHaveBeenCalledWith('v1.2.0');
  });

  test('should select a version with existing binary', async () => {
    vi.mocked(githubHelperMock.promptUserForVersion).mockResolvedValue({
      tag: 'v1.3.0',
    } as MincGithubReleaseArtifactMetadata);
    vi.mocked(fileHelperMock.removeVersionPrefix).mockImplementation((version: string) => version.replace('v', ''));

    vi.mocked(normalize).mockImplementation((path: string) => path);
    vi.mocked(fileHelperMock.getMincBinaryInfo).mockResolvedValue({ path: '/mock/minc', version: '1.2.3' });
    vi.mocked(fileHelperMock.getSystemBinaryPath).mockReturnValue('/mock/other-minc');
    await cliToolManager.registerCliTool();

    const update = cliToolManager.getUpdate() as CliToolSelectUpdate;
    const selectedVersion = await update.selectVersion();

    expect(selectedVersion).toBe('1.3.0');
    expect(fileHelperMock.removeVersionPrefix).toHaveBeenCalledWith('v1.3.0');
  });

  test('should throw an error if no CLI tool is installed during update', async () => {
    const update = cliToolManager.getUpdate();
    await expect(update.doUpdate({} as Logger)).rejects.toThrow('Cannot update minc. No cli tool installed.');
  });

  test('should throw an error if no release selected', async () => {
    const update = cliToolManager.getUpdate();
    await expect(update.doUpdate({} as Logger)).rejects.toThrow('Cannot update minc. No cli tool installed.');
  });

  test('should throw an error if no release is selected', async () => {
    const updateVersionMock = vi.fn();

    cliToolManager.setMincCli({ version: '1.2.0', updateVersion: updateVersionMock } as unknown as CliTool);
    cliToolManager.setMincPath('fake-minc-path');

    const update = cliToolManager.getUpdate();
    await expect(update.doUpdate({} as Logger)).rejects.toThrow(
      'Cannot update fake-minc-path version undefined. No release selected.',
    );
  });

  test('should throw an error if no release is selected with existing binary', async () => {
    const updateVersionMock = vi.fn();

    vi.mocked(githubHelperMock.promptUserForVersion).mockResolvedValue({
      tag: 'v1.3.0',
    } as MincGithubReleaseArtifactMetadata);
    vi.mocked(fileHelperMock.removeVersionPrefix).mockImplementation((version: string) => version.replace('v', ''));

    vi.mocked(normalize).mockImplementation((path: string) => path);
    vi.mocked(fileHelperMock.getMincBinaryInfo).mockResolvedValue({ path: '/mock/minc', version: '1.2.3' });
    vi.mocked(fileHelperMock.getSystemBinaryPath).mockReturnValue('/mock/other-minc');
    await cliToolManager.registerCliTool();

    cliToolManager.setMincCli({ version: '1.2.0', updateVersion: updateVersionMock } as unknown as CliTool);
    cliToolManager.setMincPath('fake-minc-path');

    const update = cliToolManager.getUpdate();
    await expect(update.doUpdate({} as Logger)).rejects.toThrow(
      'Cannot update fake-minc-path version 1.2.3. No release selected',
    );
  });

  test('should perform update when a release is selected', async () => {
    const latestAsset: MincGithubReleaseArtifactMetadata = { tag: 'v1.3.0' } as MincGithubReleaseArtifactMetadata;
    const latestVersion = '1.3.0';
    const updateVersionMock = vi.fn();
    cliToolManager.setMincCli({ version: '1.2.0', updateVersion: updateVersionMock } as unknown as CliTool);
    cliToolManager.setMincPath('fake-minc-path');
    vi.mocked(githubHelperMock.getCliStoragePath).mockReturnValue('cli-storage-minc-path');
    vi.mocked(fileHelperMock.installBinaryToSystem).mockResolvedValue('/mock/system/path');
    const update = cliToolManager.getUpdate(latestAsset, latestVersion);
    await update.doUpdate({} as Logger);

    expect(githubHelperMock.download).toHaveBeenCalledWith(latestAsset);
    expect(fileHelperMock.installBinaryToSystem).toHaveBeenCalledWith('cli-storage-minc-path', 'minc');

    expect(updateVersionMock).toHaveBeenCalledWith({
      version: '1.3.0',
      installationSource: 'extension',
      path: '/mock/system/path',
    });
  });

  test('should perform update when a release and not latest version', async () => {
    const latestAsset: MincGithubReleaseArtifactMetadata = { tag: 'v1.3.0' } as MincGithubReleaseArtifactMetadata;
    const latestVersion = '1.4.0';
    const updateVersionMock = vi.fn();
    cliToolManager.setMincCli({ version: '1.2.0', updateVersion: updateVersionMock } as unknown as CliTool);
    cliToolManager.setMincPath('fake-minc-path');

    vi.mocked(githubHelperMock.getCliStoragePath).mockReturnValue('cli-storage-minc-path');
    vi.mocked(fileHelperMock.installBinaryToSystem).mockResolvedValue('/mock/system/path');

    const update = cliToolManager.getUpdate(latestAsset, latestVersion);

    // call select version first
    vi.mocked(githubHelperMock.promptUserForVersion).mockResolvedValue({
      tag: 'v1.3.0',
    } as MincGithubReleaseArtifactMetadata);
    vi.mocked(fileHelperMock.removeVersionPrefix).mockImplementation((version: string) => version.replace('v', ''));
    await (update as CliToolSelectUpdate).selectVersion();

    await update.doUpdate({} as Logger);

    expect(githubHelperMock.download).toHaveBeenCalledWith(latestAsset);
    expect(fileHelperMock.installBinaryToSystem).toHaveBeenCalledWith('cli-storage-minc-path', 'minc');

    expect(updateVersionMock).toHaveBeenCalledWith({
      version: '1.3.0',
      installationSource: 'extension',
      path: '/mock/system/path',
    });
  });

  test('should log an error if system-wide installation fails', async () => {
    const updateVersionMock = vi.fn();
    cliToolManager.setMincCli({ version: '1.2.0', updateVersion: updateVersionMock } as unknown as CliTool);
    cliToolManager.setMincPath('fake-minc-path');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(fileHelperMock.installBinaryToSystem).mockRejectedValue(new Error('Permission denied'));

    const latestAsset: MincGithubReleaseArtifactMetadata = { tag: 'v1.3.0' } as MincGithubReleaseArtifactMetadata;
    const latestVersion = '1.3.0';

    const update = cliToolManager.getUpdate(latestAsset, latestVersion);
    await update.doUpdate({} as Logger);

    expect(consoleSpy).toHaveBeenCalledWith('minc not updated system-wide. Error: Error: Permission denied');

    consoleSpy.mockRestore();
  });
});

describe('getInstaller', () => {
  test('should select a version and remove prefix', async () => {
    const updateMock = { version: '1.2.0' };
    vi.mocked(githubHelperMock.promptUserForVersion).mockResolvedValue({
      tag: 'v1.3.0',
    } as MincGithubReleaseArtifactMetadata);
    vi.mocked(fileHelperMock.removeVersionPrefix).mockImplementation((version: string) => version.replace('v', ''));

    const installer = cliToolManager.getInstaller(updateMock);
    const selectedVersion = await installer.selectVersion();

    expect(selectedVersion).toBe('1.3.0');
    expect(fileHelperMock.removeVersionPrefix).toHaveBeenCalledWith('v1.3.0');
  });

  test('should throw an error if CLI is already installed', async () => {
    const updateMock = { version: '1.2.0' };
    cliToolManager.setMincPath('/mock/minc');
    cliToolManager.setMincCli({ version: '1.2.0' } as CliTool);

    const installer = cliToolManager.getInstaller(updateMock);
    await expect(installer.doInstall({} as Logger)).rejects.toThrow(
      'Cannot install minc. Version 1.2.0 in /mock/minc is already installed.',
    );
  });

  test('should throw an error if no release is selected', async () => {
    const updateMock = { version: '1.2.0' };

    const installer = cliToolManager.getInstaller(updateMock);
    await expect(installer.doInstall({} as Logger)).rejects.toThrow('Cannot install minc. No release selected.');
  });

  test('should install CLI when release is selected', async () => {
    const updateMock = { version: '1.2.0' };
    vi.mocked(githubHelperMock.promptUserForVersion).mockResolvedValue({
      tag: 'v1.3.0',
    } as MincGithubReleaseArtifactMetadata);
    vi.mocked(fileHelperMock.removeVersionPrefix).mockImplementation((version: string) => version.replace('v', ''));

    const latestVersion = '1.3.0';
    const releaseToInstall: MincGithubReleaseArtifactMetadata = { tag: 'v1.3.0' } as MincGithubReleaseArtifactMetadata;

    const updateVersionMock = vi.fn();
    cliToolManager.setMincCli({ updateVersion: updateVersionMock } as unknown as CliTool);

    vi.mocked(githubHelperMock.getCliStoragePath).mockReturnValue('/mock/path');
    vi.mocked(fileHelperMock.installBinaryToSystem).mockResolvedValue('/mock/system/path');

    const installer = cliToolManager.getInstaller(updateMock, latestVersion);
    await installer.selectVersion(); // Select the release
    await installer.doInstall({} as Logger);

    expect(githubHelperMock.download).toHaveBeenCalledWith(releaseToInstall);
    expect(fileHelperMock.installBinaryToSystem).toHaveBeenCalledWith('/mock/path', 'minc');
    expect(updateVersionMock).toHaveBeenCalledWith({
      version: '1.3.0',
      path: '/mock/system/path',
      installationSource: 'extension',
    });

    expect(updateMock.version).toBeUndefined(); // Ensure update is reset if latest
  });

  test('should install CLI when release is selected but not latest', async () => {
    const updateMock = { version: '1.2.0' };
    vi.mocked(githubHelperMock.promptUserForVersion).mockResolvedValue({
      tag: 'v1.4.0',
    } as MincGithubReleaseArtifactMetadata);
    vi.mocked(fileHelperMock.removeVersionPrefix).mockImplementation((version: string) => version.replace('v', ''));

    const latestVersion = '1.4.0';

    const updateVersionMock = vi.fn();
    cliToolManager.setMincCli({ updateVersion: updateVersionMock } as unknown as CliTool);

    vi.mocked(githubHelperMock.getCliStoragePath).mockReturnValue('/mock/path');
    vi.mocked(fileHelperMock.installBinaryToSystem).mockResolvedValue('/mock/system/path');

    const installer = cliToolManager.getInstaller(updateMock, latestVersion);

    vi.mocked(githubHelperMock.promptUserForVersion).mockResolvedValue({
      tag: 'v1.3.0',
    } as MincGithubReleaseArtifactMetadata);
    vi.mocked(fileHelperMock.removeVersionPrefix).mockImplementation((version: string) => version.replace('v', ''));

    await installer.selectVersion(); // Select the release
    await installer.doInstall({} as Logger);

    expect(fileHelperMock.installBinaryToSystem).toHaveBeenCalledWith('/mock/path', 'minc');
  });

  test('should log an error if system-wide installation fails', async () => {
    const updateMock = { version: '1.2.0' };
    vi.mocked(githubHelperMock.promptUserForVersion).mockResolvedValue({
      tag: 'v1.3.0',
    } as MincGithubReleaseArtifactMetadata);
    vi.mocked(fileHelperMock.removeVersionPrefix).mockImplementation((version: string) => version.replace('v', ''));

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(fileHelperMock.installBinaryToSystem).mockRejectedValue(new Error('Permission denied'));

    const latestVersion = '1.3.0';

    const installer = cliToolManager.getInstaller(updateMock, latestVersion);
    await installer.selectVersion();
    await installer.doInstall({} as Logger);

    expect(consoleSpy).toHaveBeenCalledWith('minc not installed system-wide. Error: Error: Permission denied');

    consoleSpy.mockRestore();
  });

  test('should throw an error if no CLI version is detected during uninstallation', async () => {
    const updateMock = { version: '1.2.0' };
    const installer = cliToolManager.getInstaller(updateMock);
    await expect(installer.doUninstall({} as Logger)).rejects.toThrow('Cannot uninstall minc. No version detected.');
  });

  test('should uninstall CLI and update state', async () => {
    const updateMock = { version: '1.2.0' };
    cliToolManager.setMincPath('/mock/minc');
    cliToolManager.setMincCli({ version: '1.2.0' } as CliTool);
    vi.mocked(githubHelperMock.getCliStoragePath).mockReturnValue('cli-storage-minc-path');
    vi.mocked(fileHelperMock.getSystemBinaryPath).mockReturnValue('/mock/system/bin/minc');

    const installer = cliToolManager.getInstaller(updateMock);
    await installer.doUninstall({} as Logger);

    expect(fileHelperMock.deleteFile).toHaveBeenCalledWith('cli-storage-minc-path');
    expect(fileHelperMock.deleteExecutableAsAdmin).toHaveBeenCalledWith('/mock/system/bin/minc');
    expect(cliToolManager.getPath()).toBeUndefined();
  });
});
