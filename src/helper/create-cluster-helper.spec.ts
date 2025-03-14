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
import { CreateClusterHelper } from './create-cluster-helper';
import type { TelemetryLogger } from '@podman-desktop/api';
import { process as podmanDesktopProcess } from '@podman-desktop/api';
import { TelemetryLoggerSymbol } from '../inject/symbol';

let createClusterHelper: CreateClusterHelper;

const telemetryLoggerMock = {
  logUsage: vi.fn(),
} as unknown as TelemetryLogger;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();

  // create fresh instance each time
  const container = new Container();
  container.bind(CreateClusterHelper).toSelf().inSingletonScope();
  container.bind(TelemetryLoggerSymbol).toConstantValue(telemetryLoggerMock);

  createClusterHelper = await container.getAsync(CreateClusterHelper);
});

describe('create', () => {
  test('should execute the create command successfully', async () => {
    await createClusterHelper.create('/path/to/minc', {});
    expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('/path/to/minc', ['create'], {
      logger: undefined,
      token: undefined,
    });
    expect(telemetryLoggerMock.logUsage).toHaveBeenCalledWith(
      'createCluster',
      expect.objectContaining({ duration: expect.any(Number) }),
    );
  });

  test('should throw an error if the create command fails', async () => {
    vi.mocked(podmanDesktopProcess.exec).mockRejectedValue(new Error('Execution failed'));

    await expect(createClusterHelper.create('/path/to/minc', {})).rejects.toThrow(
      'Failed to create minc cluster. Execution failed',
    );
    expect(telemetryLoggerMock.logUsage).toHaveBeenCalledWith(
      'createCluster',
      expect.objectContaining({ duration: expect.any(Number), error: expect.any(Error) }),
    );
  });

  test('should handle unknown format error if the create command fails', async () => {
    vi.mocked(podmanDesktopProcess.exec).mockRejectedValue('Execution failed');

    await expect(createClusterHelper.create('/path/to/minc', {})).rejects.toThrow(
      'Failed to create minc cluster. Execution failed',
    );
    expect(telemetryLoggerMock.logUsage).toHaveBeenCalledWith(
      'createCluster',
      expect.objectContaining({ duration: expect.any(Number), error: 'Execution failed' }),
    );
  });
});
