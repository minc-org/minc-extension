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

import { inject, injectable } from 'inversify';
import { ExtensionContextSymbol } from '../inject/symbol';
import {
  cli,
  type CliToolSelectUpdate,
  type CliToolUpdate,
  type CliTool,
  type CliToolInstallationSource,
  type ExtensionContext,
  type CliToolInstaller,
} from '@podman-desktop/api';
import { type MincGithubReleaseArtifactMetadata, GitHubHelper } from '../helper/github-helper';
import { FileHelper } from '../helper/file-helper';
import { normalize } from 'node:path';

// handle registration of the cli tool
@injectable()
export class CliToolManager {
  static readonly MINC_CLI_NAME = 'minc';
  static readonly MINC_DISPLAY_NAME = 'Minc';
  static readonly MINC_MARKDOWN = 'Minc MicroShift CLI';

  @inject(ExtensionContextSymbol)
  private extensionContext: ExtensionContext;

  @inject(GitHubHelper)
  private gitHubHelper: GitHubHelper;

  @inject(FileHelper)
  private fileHelper: FileHelper;

  #binary: { path: string; version: string } | undefined = undefined;

  #installationSource: CliToolInstallationSource | undefined;

  #mincPath: string | undefined;

  #mincCli: CliTool | undefined;

  getPath(): string | undefined {
    return this.#mincPath;
  }

  isInstalled(): boolean {
    return !!this.#mincPath;
  }

  async registerCliTool(): Promise<void> {
    // let's try to get system-wide minc install first
    try {
      this.#binary = await this.fileHelper.getMincBinaryInfo('minc');
      const systemPath = this.fileHelper.getSystemBinaryPath('minc');
      this.#installationSource = normalize(this.#binary.path) === normalize(systemPath) ? 'extension' : 'external';
    } catch (err: unknown) {
      console.error(err);
    }

    // if not installed system-wide: let's try to check in the extension storage if minc is not available system-wide
    if (!this.#binary) {
      try {
        this.#binary = await this.fileHelper.getMincBinaryInfo(this.gitHubHelper.getCliStoragePath());
        this.#installationSource = 'extension';
      } catch (err: unknown) {
        console.error(err);
      }
    }

    // if the binary exists (either system-wide or in extension storage), we get its version/path
    if (this.#binary) {
      this.#mincPath = this.#binary.path;
    }

    // we register it
    const cliTool = cli.createCliTool({
      name: CliToolManager.MINC_CLI_NAME,
      images: {
        icon: './icon.png',
      },
      version: this.#binary?.version,
      path: this.#binary?.path,
      displayName: CliToolManager.MINC_DISPLAY_NAME,
      markdownDescription: CliToolManager.MINC_MARKDOWN,
      installationSource: this.#installationSource,
    });

    this.extensionContext.subscriptions.push(cliTool);
    this.setMincCli(cliTool);

    // if the tool has been installed by the user we do not register the updater/installer
    if (this.#installationSource === 'external') {
      return;
    }

    let latestAsset: MincGithubReleaseArtifactMetadata | undefined;
    try {
      latestAsset = await this.gitHubHelper.getLatestVersionAsset();
    } catch (error: unknown) {
      console.error('Error when downloading minc CLI latest release information.', error);
    }
    const latestVersion = latestAsset?.tag ? this.fileHelper.removeVersionPrefix(latestAsset.tag) : undefined;

    const update = this.getUpdate(latestAsset, latestVersion);

    cliTool.registerUpdate(update);

    const installer = this.getInstaller(update, latestVersion);
    cliTool.registerInstaller(installer);
  }

  async installLatest(): Promise<string> {
    // 1. get latest asset
    const latest = await this.gitHubHelper.getLatestVersionAsset();
    // 2. download it
    let cliPath = await this.gitHubHelper.download(latest);

    // 3. try to install system-wide: (can fail)
    try {
      cliPath = await this.fileHelper.installBinaryToSystem(cliPath, CliToolManager.MINC_CLI_NAME);
    } catch (err: unknown) {
      console.log(`${CliToolManager.MINC_CLI_NAME} not updated system-wide. Error: ${String(err)}`);
    }

    // update cli tool
    this.getMincCli()?.updateVersion({
      version: this.fileHelper.removeVersionPrefix(latest.tag),
      path: cliPath,
      installationSource: 'extension',
    });

    // return new path
    return cliPath;
  }

  protected getUpdate(
    latestAsset?: MincGithubReleaseArtifactMetadata,
    latestVersion?: string,
  ): (CliToolUpdate | CliToolSelectUpdate) & { version?: string } {
    // register the updater to allow users to upgrade/downgrade their cli
    let releaseToUpdateTo: MincGithubReleaseArtifactMetadata | undefined;
    let releaseVersionToUpdateTo: string | undefined;

    const update = {
      version: latestVersion !== this.#mincCli?.version ? latestVersion : undefined,
      selectVersion: async (): Promise<string> => {
        const selected = await this.gitHubHelper.promptUserForVersion(this.#binary?.version);
        releaseToUpdateTo = selected;
        releaseVersionToUpdateTo = this.fileHelper.removeVersionPrefix(selected.tag);
        return releaseVersionToUpdateTo;
      },
      doUpdate: async (): Promise<void> => {
        if (!this.#mincCli?.version || !this.#mincPath) {
          throw new Error(`Cannot update ${CliToolManager.MINC_CLI_NAME}. No cli tool installed.`);
        }

        if (!releaseToUpdateTo && latestAsset) {
          releaseToUpdateTo = latestAsset;
          releaseVersionToUpdateTo = latestVersion;
        }

        if (!releaseToUpdateTo || !releaseVersionToUpdateTo) {
          throw new Error(`Cannot update ${this.#mincPath} version ${this.#binary?.version}. No release selected.`);
        }

        // download, install system wide and update cli version
        await this.gitHubHelper.download(releaseToUpdateTo);
        let cliPath = this.gitHubHelper.getCliStoragePath();
        try {
          cliPath = await this.fileHelper.installBinaryToSystem(cliPath, CliToolManager.MINC_CLI_NAME);
        } catch (err: unknown) {
          console.log(`${CliToolManager.MINC_CLI_NAME} not updated system-wide. Error: ${String(err)}`);
        }
        this.#mincCli?.updateVersion({
          version: releaseVersionToUpdateTo,
          installationSource: 'extension',
          path: cliPath,
        });
        if (releaseVersionToUpdateTo === latestVersion) {
          update.version = undefined;
        } else {
          update.version = latestVersion;
        }
        releaseVersionToUpdateTo = undefined;
        releaseToUpdateTo = undefined;
      },
    };

    return update;
  }

  protected getInstaller(update: { version?: string }, latestVersion?: string): CliToolInstaller {
    // if we do not have anything installed, let's add it to the status bar
    let releaseToInstall: MincGithubReleaseArtifactMetadata | undefined;
    let releaseVersionToInstall: string | undefined;

    return {
      selectVersion: async (): Promise<string> => {
        const selected = await this.gitHubHelper.promptUserForVersion();
        releaseToInstall = selected;
        releaseVersionToInstall = this.fileHelper.removeVersionPrefix(selected.tag);
        return releaseVersionToInstall;
      },
      doInstall: async (_logger): Promise<void> => {
        if (this.#mincCli?.version || this.#mincPath) {
          throw new Error(
            `Cannot install ${CliToolManager.MINC_CLI_NAME}. Version ${this.#mincCli?.version} in ${this.#mincPath} is already installed.`,
          );
        }
        if (!releaseToInstall || !releaseVersionToInstall) {
          throw new Error(`Cannot install ${CliToolManager.MINC_CLI_NAME}. No release selected.`);
        }

        // download, install system wide and update cli version
        await this.gitHubHelper.download(releaseToInstall);
        let cliPath = this.gitHubHelper.getCliStoragePath();

        try {
          cliPath = await this.fileHelper.installBinaryToSystem(cliPath, CliToolManager.MINC_CLI_NAME);
        } catch (err: unknown) {
          console.log(`${CliToolManager.MINC_CLI_NAME} not installed system-wide. Error: ${String(err)}`);
        }

        this.#mincCli?.updateVersion({
          version: releaseVersionToInstall,
          path: cliPath,
          installationSource: 'extension',
        });
        this.#mincPath = cliPath;
        if (releaseVersionToInstall === latestVersion) {
          update.version = undefined;
        } else {
          update.version = latestVersion;
        }
        releaseVersionToInstall = undefined;
        releaseToInstall = undefined;
      },
      doUninstall: async (_logger): Promise<void> => {
        if (!this.#mincCli?.version) {
          throw new Error(`Cannot uninstall ${CliToolManager.MINC_CLI_NAME}. No version detected.`);
        }

        // delete the executable stored in the storage folder
        const storagePath = this.gitHubHelper.getCliStoragePath();
        await this.fileHelper.deleteFile(storagePath);

        // delete the executable in the system path
        const systemPath = this.fileHelper.getSystemBinaryPath(CliToolManager.MINC_CLI_NAME);
        await this.fileHelper.deleteExecutableAsAdmin(systemPath);

        // update the version and path to undefined
        this.#mincPath = undefined;
      },
    };
  }

  protected setMincCli(cli: CliTool): void {
    this.#mincCli = cli;
  }

  protected getMincCli(): CliTool | undefined {
    return this.#mincCli;
  }

  protected setMincPath(mincPath: string): void {
    this.#mincPath = mincPath;
  }
}
