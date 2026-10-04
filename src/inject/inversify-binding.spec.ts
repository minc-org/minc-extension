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

import { Octokit } from '@octokit/rest';
import { vi, expect, beforeEach, describe, test } from 'vitest';
import { InversifyBinding } from './inversify-binding';
import type { ExtensionContext, TelemetryLogger } from '@podman-desktop/api';
import { ExtensionContextSymbol, TelemetryLoggerSymbol } from './symbol';
import { ProviderManager } from '../manager/provider-manager';

let inversifyBinding: InversifyBinding;

const extensionContextMock = {} as ExtensionContext;
const telemetryLoggerMock = {} as TelemetryLogger;
const octokitMock: Octokit = {} as Octokit;

describe('InversifyBinding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    inversifyBinding = new InversifyBinding(extensionContextMock, telemetryLoggerMock, octokitMock);
  });

  test('should initialize bindings correctly', async () => {
    const container = await inversifyBinding.initBindings();

    expect(container.get(ExtensionContextSymbol)).toBe(extensionContextMock);
    expect(container.get(TelemetryLoggerSymbol)).toBe(telemetryLoggerMock);
    expect(container.get(Octokit)).toBe(octokitMock);
    expect(container.get(ProviderManager)).toBeInstanceOf(ProviderManager);
  });

  test('should dispose of the container', async () => {
    const container = await inversifyBinding.initBindings();

    await inversifyBinding.dispose();

    // bindings gone
    expect(() => container.get(ExtensionContextSymbol)).toThrow();
  });
});

test('should not fail to dispose if not initialized', async () => {
  await expect(
    new InversifyBinding(extensionContextMock, telemetryLoggerMock, octokitMock).dispose(),
  ).resolves.toBeUndefined();
});
