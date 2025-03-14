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

import { Container } from 'inversify';
import { helpersModule } from '././helper-module';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ClusterSearchHelper } from './cluster-search-helper';
import { CreateClusterHelper } from './create-cluster-helper';
import { GitHubHelper } from './github-helper';
import { FileHelper } from './file-helper';
import { ExtensionContextSymbol, TelemetryLoggerSymbol } from '../inject/symbol';
import type { ExtensionContext, TelemetryLogger } from '@podman-desktop/api';
import { Octokit } from '@octokit/rest';

describe('helpersModule', () => {
  let container: Container;

  beforeEach(async () => {
    vi.resetAllMocks();
    container = new Container();

    // bind other dependencies used by the helpers
    container.bind(ExtensionContextSymbol).toConstantValue({} as ExtensionContext);
    container.bind(TelemetryLoggerSymbol).toConstantValue({} as TelemetryLogger);
    container.bind(Octokit).toConstantValue({} as Octokit);

    // Load the helpersModule bindings into the container
    await container.load(helpersModule);
  });

  test('should bind ClusterSearchHelper as a singleton', () => {
    const helper1 = container.get<ClusterSearchHelper>(ClusterSearchHelper);
    const helper2 = container.get<ClusterSearchHelper>(ClusterSearchHelper);

    // Ensure that both instances are the same (singleton behavior)
    expect(helper1).toBe(helper2);
  });

  test('should bind CreateClusterHelper as a singleton', () => {
    const helper1 = container.get<CreateClusterHelper>(CreateClusterHelper);
    const helper2 = container.get<CreateClusterHelper>(CreateClusterHelper);

    expect(helper1).toBe(helper2);
  });

  test('should bind GitHubHelper as a singleton', () => {
    const helper1 = container.get<GitHubHelper>(GitHubHelper);
    const helper2 = container.get<GitHubHelper>(GitHubHelper);

    expect(helper1).toBe(helper2);
  });

  test('should bind FileHelper as a singleton', () => {
    const helper1 = container.get<FileHelper>(FileHelper);
    const helper2 = container.get<FileHelper>(FileHelper);

    expect(helper1).toBe(helper2);
  });
});
