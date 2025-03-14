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

import * as path from 'node:path';

import type { RestEndpointMethodTypes } from '@octokit/rest';
import { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GitHubHelper } from './github-helper';
import { Container } from 'inversify';
import mincGithubReleaseAllJson from '../../tests/resources/minc-github-release-all.json';
import mincGithubReleaseAssetJson from '../../tests/resources/minc-github-release-assets.json';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { existsSync } from 'node:fs';
import { ExtensionContextSymbol } from '../inject/symbol';
import type { ExtensionContext } from '@podman-desktop/api';
import { env, window } from '@podman-desktop/api';

let githubHelper: GitHubHelper;

vi.mock(import('node:os'));
vi.mock(import('node:fs'));
vi.mock(import('node:fs/promises'));

const octokitMock: Octokit = {
  repos: {
    listReleases: vi.fn(),
    listReleaseAssets: vi.fn(),
    getReleaseAsset: vi.fn(),
  },
} as unknown as Octokit;
type ListReleasesResponse = RestEndpointMethodTypes['repos']['listReleases']['response'];
type ListReleasesAssetsResponse = RestEndpointMethodTypes['repos']['listReleaseAssets']['response'];
type GetReleaseAssetResponse = RestEndpointMethodTypes['repos']['getReleaseAsset']['response'];

const extensionContextMock: ExtensionContext = {
  storagePath: 'fake-path',
} as unknown as ExtensionContext;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();

  vi.mocked(env).isLinux = false;
  vi.mocked(env).isWindows = false;
  vi.mocked(env).isMac = false;

  // create fresh instance each time
  const container = new Container();
  container.bind(Octokit).toConstantValue(octokitMock);
  container.bind(ExtensionContextSymbol).toConstantValue(extensionContextMock);
  container.bind(GitHubHelper).toSelf().inSingletonScope();

  githubHelper = await container.getAsync(GitHubHelper);
});

describe('grabLatestsReleasesMetadata', () => {
  test('return latest 4 releases', async () => {
    vi.mocked(octokitMock.repos.listReleases).mockResolvedValue({
      data: mincGithubReleaseAllJson,
    } as ListReleasesResponse);
    const releases = await githubHelper.grabLatestsReleasesMetadata();
    expect(releases).toBeDefined();
    expect(releases.length).toBe(4);
  });

  test('return latest 4 releases without a name', async () => {
    const mincGithubReleaseAllJsonWithoutName = structuredClone(mincGithubReleaseAllJson);
    for (const release of mincGithubReleaseAllJsonWithoutName) {
      const releaseOpt: { name?: string } = release;
      releaseOpt.name = undefined;
    }

    vi.mocked(octokitMock.repos.listReleases).mockResolvedValue({
      data: mincGithubReleaseAllJsonWithoutName,
    } as ListReleasesResponse);
    const releases = await githubHelper.grabLatestsReleasesMetadata();
    expect(releases).toBeDefined();
    expect(releases.length).toBe(4);
    // name in this case is the tag
    expect(releases[0].label).toBe('v0.0.4');
  });
});

describe('promptUserForVersion', () => {
  test('return selected version', async () => {
    vi.mocked(octokitMock.repos.listReleases).mockResolvedValue({
      data: mincGithubReleaseAllJson,
    } as ListReleasesResponse);
    const lastReleaseAsset = await githubHelper.getLatestVersionAsset();

    vi.mocked(window.showQuickPick).mockResolvedValue(lastReleaseAsset);

    const release = await githubHelper.promptUserForVersion();

    expect(vi.mocked(window.showQuickPick)).toBeCalledWith(expect.any(Array), {
      placeHolder: 'Select minc version to download',
    });

    expect(release).toBeDefined();
    expect(release.id).toBe(lastReleaseAsset.id);
  });

  test('return selected version with a predefined tag', async () => {
    vi.mocked(octokitMock.repos.listReleases).mockResolvedValue({
      data: mincGithubReleaseAllJson,
    } as ListReleasesResponse);
    const lastReleaseAsset = await githubHelper.getLatestVersionAsset();

    vi.mocked(window.showQuickPick).mockResolvedValue(lastReleaseAsset);

    const release = await githubHelper.promptUserForVersion('v0.0.2');

    expect(vi.mocked(window.showQuickPick)).toBeCalledWith(expect.any(Array), {
      placeHolder: 'Select minc version to download',
    });

    expect(release).toBeDefined();
    expect(release.id).toBe(lastReleaseAsset.id);
  });

  test('throw error if no version is selected', async () => {
    vi.mocked(octokitMock.repos.listReleases).mockResolvedValue({
      data: mincGithubReleaseAllJson,
    } as ListReleasesResponse);
    vi.mocked(window.showQuickPick).mockResolvedValue(undefined);
    await expect(() => githubHelper.promptUserForVersion()).rejects.toThrowError('No version selected');
  });
});

describe('getReleaseAssetId', () => {
  beforeEach(async () => {
    vi.mocked(octokitMock.repos.listReleases).mockResolvedValue({
      data: mincGithubReleaseAllJson,
    } as ListReleasesResponse);
    vi.mocked(octokitMock.repos.listReleaseAssets).mockResolvedValue({
      data: mincGithubReleaseAssetJson,
    } as ListReleasesAssetsResponse);
  });

  test('macOS x86_64', async () => {
    const result = await githubHelper.getReleaseAssetId(205352522, 'darwin', 'x64');
    expect(result).toBeDefined();
    expect(result).toBe(236859140);
  });

  test('macOS arm64', async () => {
    const result = await githubHelper.getReleaseAssetId(205352522, 'darwin', 'arm64');
    expect(result).toBeDefined();
    expect(result).toBe(236859169);
  });

  test('windows x86_64', async () => {
    const result = await githubHelper.getReleaseAssetId(205352522, 'win32', 'x64');
    expect(result).toBeDefined();
    expect(result).toBe(236859221);
  });

  test('linux x86_64', async () => {
    const result = await githubHelper.getReleaseAssetId(205352522, 'linux', 'x64');
    expect(result).toBeDefined();
    expect(result).toBe(236859183);
  });

  test('linux arm64', async () => {
    const result = await githubHelper.getReleaseAssetId(205352522, 'linux', 'arm64');
    expect(result).toBeDefined();
    expect(result).toBe(236859201);
  });

  test('invalid', async () => {
    await expect(githubHelper.getReleaseAssetId(205352522, 'invalid', 'invalid')).rejects.toThrow();
  });
});

describe('getCliStoragePath', () => {
  test('return minc.exe path for windows', async () => {
    vi.mocked(env).isWindows = true;
    const path = githubHelper.getCliStoragePath();
    expect(path.endsWith('minc.exe')).toBeTruthy();
  });
  test('return minc path for mac', async () => {
    vi.mocked(env).isMac = true;
    const path = githubHelper.getCliStoragePath();
    expect(path.endsWith('minc')).toBeTruthy();
  });
  test('return minc path for linux', async () => {
    vi.mocked(env).isLinux = true;
    const path = githubHelper.getCliStoragePath();
    expect(path.endsWith('minc')).toBeTruthy();
  });
});

describe('install', () => {
  beforeEach(async () => {
    vi.mocked(octokitMock.repos.listReleaseAssets).mockResolvedValue({
      data: mincGithubReleaseAssetJson,
    } as ListReleasesAssetsResponse);
  });
  test('should download file on win system', async () => {
    vi.mocked(octokitMock.repos.listReleases).mockResolvedValue({
      data: mincGithubReleaseAllJson,
    } as ListReleasesResponse);
    const lastReleaseAsset = await githubHelper.getLatestVersionAsset();

    vi.mocked(platform).mockReturnValue('win32');
    vi.mocked(arch).mockReturnValue('x64');
    const downloadReleaseAssetMock = vi.spyOn(githubHelper, 'downloadReleaseAsset').mockResolvedValue();
    const output = await githubHelper.download(lastReleaseAsset);
    expect(output).toStrictEqual(path.join(githubHelper.getCliStoragePath()));
    expect(downloadReleaseAssetMock).toBeCalledWith(236859221, expect.any(String));
    expect(vi.mocked(chmod)).not.toBeCalled();
  });
  test('should download and set permissions on file on non-win system', async () => {
    (env.isMac as unknown as boolean) = true;

    vi.mocked(octokitMock.repos.listReleases).mockResolvedValue({
      data: mincGithubReleaseAllJson,
    } as ListReleasesResponse);
    const lastRelease = await githubHelper.getLatestVersionAsset();

    vi.mocked(platform).mockReturnValue('darwin');
    vi.mocked(arch).mockReturnValue('x64');
    vi.mocked(existsSync).mockReturnValue(true);
    const downloadReleaseAssetMock = vi.spyOn(githubHelper, 'downloadReleaseAsset').mockResolvedValue();
    await githubHelper.download(lastRelease);
    expect(downloadReleaseAssetMock).toBeCalledWith(236859140, expect.any(String));
    expect(vi.mocked(chmod)).toBeCalledWith(expect.any(String), 0o755);
  });
});

describe('downloadReleaseAsset', () => {
  test('should download the file if parent folder does exist', async () => {
    vi.mocked(octokitMock.repos.getReleaseAsset).mockResolvedValue({
      data: 'foo',
    } as unknown as GetReleaseAssetResponse);

    // mock fs
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(writeFile).mockResolvedValue();

    // generate a temporary file
    const destFile = '/fake/path/to/file';
    await githubHelper.downloadReleaseAsset(123, destFile);
    // check that parent director has been checked
    expect(existsSync).toBeCalledWith('/fake/path/to');

    // check that we've written the file
    expect(writeFile).toBeCalledWith(destFile, Buffer.from('foo'));
  });

  test('should download the file if parent folder does not exist', async () => {
    vi.mocked(octokitMock.repos.getReleaseAsset).mockResolvedValue({
      data: 'foo',
    } as unknown as GetReleaseAssetResponse);

    // mock fs
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(mkdir).mockResolvedValue('');
    vi.mocked(writeFile).mockResolvedValue();

    // generate a temporary file
    const destFile = '/fake/path/to/file';
    await githubHelper.downloadReleaseAsset(123, destFile);
    // check that parent director has been checked
    expect(existsSync).toBeCalledWith('/fake/path/to');

    // check that we've created the parent folder
    expect(mkdir).toBeCalledWith('/fake/path/to', { recursive: true });

    // check that we've written the file
    expect(writeFile).toBeCalledWith(destFile, Buffer.from('foo'));
  });
});
