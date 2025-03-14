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
import { Container } from 'inversify';
import type { ContainerInfo } from '@podman-desktop/api';
import { containerEngine } from '@podman-desktop/api';
import { ClusterSearchHelper } from './cluster-search-helper';

let clusterSearchHelper: ClusterSearchHelper;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();

  // create fresh instance each time
  const container = new Container();
  container.bind(ClusterSearchHelper).toSelf().inSingletonScope();

  clusterSearchHelper = await container.getAsync(ClusterSearchHelper);
});

describe('search', () => {
  test('should return containers with the CLUSTER_LABEL', async () => {
    const containers: ContainerInfo[] = [
      { Id: '1', Labels: { 'io.x-openshift.microshift.cluster': 'true' } },
      { Id: '2', Labels: {} },
      { Id: '3', Labels: { 'some-other-label': 'value' } },
      { Id: '4', Labels: { 'io.x-openshift.microshift.cluster': 'true' } },
    ] as ContainerInfo[];
    vi.mocked(containerEngine.listContainers).mockResolvedValue(containers);

    const result = await clusterSearchHelper.search();
    expect(result).toHaveLength(2);
    expect(result.map(c => c.Id)).toEqual(['1', '4']);
  });

  test('should return an empty array if no containers have the CLUSTER_LABEL', async () => {
    const containers: ContainerInfo[] = [
      { Id: '1', Labels: {} },
      { Id: '2', Labels: { 'some-other-label': 'value' } },
    ] as ContainerInfo[];
    vi.mocked(containerEngine.listContainers).mockResolvedValue(containers);

    const result = await clusterSearchHelper.search();

    expect(result).toHaveLength(0);
  });

  test('should return an empty array if there are no containers', async () => {
    vi.mocked(containerEngine.listContainers).mockResolvedValue([]);

    const result = await clusterSearchHelper.search();
    expect(result).toHaveLength(0);
  });

  test('should handle errors from listContainers', async () => {
    vi.mocked(containerEngine.listContainers).mockRejectedValue(new Error('Failed to list containers'));

    await expect(new ClusterSearchHelper().search()).rejects.toThrow('Failed to list containers');
  });
});
