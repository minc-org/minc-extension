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

import { Octokit } from '@octokit/rest'; // Assuming using Octokit from @octokit/rest package
import { vi, expect, beforeEach, describe, test } from 'vitest';
import { InversifyBinding } from './inversify-binding';
import type { ExtensionContext, TelemetryLogger } from '@podman-desktop/api';
import { ExtensionContextSymbol, TelemetryLoggerSymbol } from './symbol';
import { Container } from 'inversify';
import { helpersModule } from '../helper/helper-module';
import { managersModule } from '../manager/manager-module';

let inversifyBinding: InversifyBinding;

const extensionContextMock = {} as ExtensionContext;
const telemetryLoggerMock = {} as TelemetryLogger;
const octokitMock: Octokit = {} as Octokit;

// mock inversify
vi.mock(import('inversify'));

describe('InversifyBinding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    inversifyBinding = new InversifyBinding(extensionContextMock, telemetryLoggerMock, octokitMock);
    vi.mocked(Container.prototype.bind).mockReturnValue({
      toConstantValue: vi.fn(),
    } as unknown as ReturnType<typeof Container.prototype.bind>);
  });

  test('should initialize bindings correctly', async () => {
    // Initialize bindings
    await inversifyBinding.initBindings();

    // check we call bind
    expect(vi.mocked(Container.prototype.bind)).toHaveBeenCalledWith(ExtensionContextSymbol);
    expect(vi.mocked(Container.prototype.bind)).toHaveBeenCalledWith(TelemetryLoggerSymbol);
    expect(vi.mocked(Container.prototype.bind)).toHaveBeenCalledWith(Octokit);

    // expect load of modules
    expect(vi.mocked(Container.prototype.load)).toHaveBeenCalledWith(helpersModule);
    expect(vi.mocked(Container.prototype.load)).toHaveBeenCalledWith(managersModule);
  });

  test('should dispose of the container', async () => {
    const container = await inversifyBinding.initBindings();

    // Dispose of the container
    await inversifyBinding.dispose();

    // instances gone
    expect(container.unbindAll).toHaveBeenCalled();
  });
});
