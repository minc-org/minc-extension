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
import * as os from 'node:os';
import * as path from 'node:path';

import { Octokit } from '@octokit/rest';
import { inject, injectable } from 'inversify';
import { ExtensionContextSymbol } from '../inject/symbol';
import { env, window, type ExtensionContext, type QuickPickItem } from '@podman-desktop/api';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface AssetInfo {
  id: number;
  name: string;
}

export interface MincGithubReleaseArtifactMetadata extends QuickPickItem {
  tag: string;
  id: number;
}

/**
 * Helper class to interact with GitHub REST API with Octokit
 */
@injectable()
export class GitHubHelper {
  private static readonly GITHUB_OWNER = 'minc-org';
  private static readonly GITHUB_REPOSITORY = 'minc';

  private static readonly WINDOWS_X64_PLATFORM = 'win32-x64';
  private static readonly WINDOWS_X64_ASSET_NAME = 'minc.exe';

  private static readonly LINUX_X64_PLATFORM = 'linux-x64';
  private static readonly LINUX_X64_ASSET_NAME = 'minc_linux_amd64';

  private static readonly LINUX_ARM64_PLATFORM = 'linux-arm64';
  private static readonly LINUX_ARM64_ASSET_NAME = 'minc_linux_arm64';

  private static readonly MACOS_X64_PLATFORM = 'darwin-x64';
  private static readonly MACOS_X64_ASSET_NAME = 'minc_darwin_amd64';

  private static readonly MACOS_ARM64_PLATFORM = 'darwin-arm64';
  private static readonly MACOS_ARM64_ASSET_NAME = 'minc_darwin_arm64';

  @inject(ExtensionContextSymbol)
  private extensionContext: ExtensionContext;

  @inject(Octokit)
  private octokit: Octokit;

  #assetNames = new Map<string, string>();

  constructor() {
    this.#assetNames.set(GitHubHelper.WINDOWS_X64_PLATFORM, GitHubHelper.WINDOWS_X64_ASSET_NAME);

    this.#assetNames.set(GitHubHelper.LINUX_X64_PLATFORM, GitHubHelper.LINUX_X64_ASSET_NAME);
    this.#assetNames.set(GitHubHelper.LINUX_ARM64_PLATFORM, GitHubHelper.LINUX_ARM64_ASSET_NAME);

    this.#assetNames.set(GitHubHelper.MACOS_X64_PLATFORM, GitHubHelper.MACOS_X64_ASSET_NAME);
    this.#assetNames.set(GitHubHelper.MACOS_ARM64_PLATFORM, GitHubHelper.MACOS_ARM64_ASSET_NAME);
  }

  // Get the latest version of minc from GitHub Releases
  // and return the artifact metadata
  async getLatestVersionAsset(): Promise<MincGithubReleaseArtifactMetadata> {
    const latestReleases = await this.grabLatestsReleasesMetadata();
    // from biggest to smallest
    return latestReleases[0];
  }

  // Provides last 5 majors releases from GitHub using the GitHub API
  // return name, tag and id of the release
  async grabLatestsReleasesMetadata(): Promise<MincGithubReleaseArtifactMetadata[]> {
    // Grab last 5 majors releases from GitHub using the GitHub API

    const lastReleases = await this.octokit.repos.listReleases({
      owner: GitHubHelper.GITHUB_OWNER,
      repo: GitHubHelper.GITHUB_REPOSITORY,
    });

    // keep only releases and not pre-releases
    lastReleases.data = lastReleases.data.filter(release => !release.prerelease);

    // keep only the last 4 releases
    lastReleases.data = lastReleases.data.slice(0, 5);

    return lastReleases.data.map(release => {
      return {
        label: release.name ?? release.tag_name,
        tag: release.tag_name,
        id: release.id,
      };
    });
  }

  async promptUserForVersion(currentMincTag?: string): Promise<MincGithubReleaseArtifactMetadata> {
    // Get the latest releases
    let lastReleasesMetadata = await this.grabLatestsReleasesMetadata();
    // if the user already has an installed version, we remove it from the list
    if (currentMincTag) {
      lastReleasesMetadata = lastReleasesMetadata.filter(release => release.tag.slice(1) !== currentMincTag);
    }

    // Show the quickpick
    const selectedRelease = await window.showQuickPick(lastReleasesMetadata, {
      placeHolder: 'Select minc version to download',
    });

    if (selectedRelease) {
      return selectedRelease;
    }
    throw new Error('No version selected');
  }

  // Get the asset id of a given release number for a given operating system and architecture
  // operatingSystem: win32, darwin, linux (see os.platform())
  // arch: x64, arm64 (see os.arch())
  async getReleaseAssetId(releaseId: number, operatingSystem: string, arch: string): Promise<number> {
    let selectedArch = arch;
    if (arch === 'x64') {
      selectedArch = 'amd64';
    }

    const listOfAssets = await this.octokit.repos.listReleaseAssets({
      owner: GitHubHelper.GITHUB_OWNER,
      repo: GitHubHelper.GITHUB_REPOSITORY,
      release_id: releaseId,
    });

    const searchedAssetName = operatingSystem === 'win32' ? 'minc.exe' : `minc_${operatingSystem}_${selectedArch}`;

    // search for the right asset
    const asset = listOfAssets.data.find(asset => searchedAssetName === asset.name);
    if (!asset) {
      throw new Error(`No asset found for ${operatingSystem} and ${arch}`);
    }

    return asset.id;
  }

  getCliStoragePath(): string {
    const storageBinFolder = path.resolve(this.extensionContext.storagePath, 'bin');
    let fileExtension = '';
    if (env.isWindows) {
      fileExtension = '.exe';
    }
    return path.resolve(storageBinFolder, `minc${fileExtension}`);
  }

  async download(release: MincGithubReleaseArtifactMetadata): Promise<string> {
    // Get asset id
    const assetId = await this.getReleaseAssetId(release.id, os.platform(), os.arch());

    // Get the storage and check to see if it exists before we download minc
    const storageBinFolder = path.resolve(this.extensionContext.storagePath, 'bin');
    if (!existsSync(storageBinFolder)) {
      await mkdir(storageBinFolder, { recursive: true });
    }

    const mincDownloadLocation = this.getCliStoragePath();

    // Download the asset and make it executable
    await this.downloadReleaseAsset(assetId, mincDownloadLocation);
    // make executable
    if (env.isLinux || env.isMac) {
      // eslint-disable-next-line sonarjs/file-permissions
      await chmod(mincDownloadLocation, 0o755);
    }

    return mincDownloadLocation;
  }

  async downloadReleaseAsset(assetId: number, destination: string): Promise<void> {
    const asset = await this.octokit.repos.getReleaseAsset({
      owner: GitHubHelper.GITHUB_OWNER,
      repo: GitHubHelper.GITHUB_REPOSITORY,
      asset_id: assetId,
      headers: {
        accept: 'application/octet-stream',
      },
    });

    // check the parent folder exists
    const parentFolder = path.dirname(destination);

    if (!existsSync(parentFolder)) {
      await mkdir(parentFolder, { recursive: true });
    }
    // write the file
    await writeFile(destination, Buffer.from(asset.data as unknown as ArrayBuffer));
  }
}
