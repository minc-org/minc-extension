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
import { assert, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';
import { Container, injectable, injectFromBase } from 'inversify';
import { CliToolManager } from './cli-tool-manager';
import {
  containerEngine,
  type ContainerInfo,
  type ContainerJSONEvent,
  type Disposable,
  type KubernetesProviderConnection,
  type LifecycleContext,
  type Provider,
  provider,
  type RegisterContainerConnectionEvent,
  type UnregisterContainerConnectionEvent,
  type UpdateContainerConnectionEvent,
  window,
  type ExtensionContext,
  type TelemetryLogger,
  env,
  type RunResult,
  type AuditResult,
  type ProviderConnectionStatus,
  type ContainerProviderConnection,
  type ProviderContainerConnection,
  extensions,
  type Extension,
} from '@podman-desktop/api';
import { ExtensionContextSymbol, TelemetryLoggerSymbol } from '../inject/symbol';
import { ProviderManager } from './provider-manager';
import { ClusterSearchHelper } from '../helper/cluster-search-helper';
import { CreateClusterHelper } from '../helper/create-cluster-helper';
import type { MincCluster } from './minc-cluster';
import { process as podmanDesktopProcess } from '@podman-desktop/api';

let providerManager: TestProviderManager;

vi.mock(import('node:path'));

@injectable()
@injectFromBase()
class TestProviderManager extends ProviderManager {
  public getClusters(): MincCluster[] {
    return super.getClusters();
  }

  public getRegisteredKubernetesConnections(): {
    connection: KubernetesProviderConnection;
    disposable: Disposable;
  }[] {
    return super.getRegisteredKubernetesConnections();
  }

  public async auditRecords(): Promise<AuditResult> {
    return super.auditRecords();
  }
}

const telemetryLoggerMock = {
  logUsage: vi.fn(),
} as unknown as TelemetryLogger;

const extensionContextMock: ExtensionContext = {
  subscriptions: [],
} as unknown as ExtensionContext;

const cliToolManagerMock = {
  installLatest: vi.fn(),
  getPath: vi.fn(),
} as unknown as CliToolManager;

const createClusterHelperMock = {
  create: vi.fn(),
} as unknown as CreateClusterHelper;

const clusterSearchHelperMock = {
  search: vi.fn(),
} as unknown as ClusterSearchHelper;

const providerMock = {
  registerKubernetesProviderConnection: vi.fn(),
  setKubernetesProviderConnectionFactory: vi.fn(),
} as unknown as Provider;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();

  // create fresh instance each time
  const container = new Container();
  container.bind(TelemetryLoggerSymbol).toConstantValue(telemetryLoggerMock);
  container.bind(ExtensionContextSymbol).toConstantValue(extensionContextMock);
  container.bind(CliToolManager).toConstantValue(cliToolManagerMock);
  container.bind(CreateClusterHelper).toConstantValue(createClusterHelperMock);
  container.bind(ClusterSearchHelper).toConstantValue(clusterSearchHelperMock);

  // clear subscriptions
  extensionContextMock.subscriptions.length = 0;

  container.bind(TestProviderManager).toSelf();

  providerManager = await container.getAsync<TestProviderManager>(TestProviderManager);

  vi.mocked(clusterSearchHelperMock.search).mockResolvedValue([]);

  vi.mocked(provider.createProvider).mockReturnValue(providerMock);
});

test('should create provider and register Kubernetes provider connection factory', async () => {
  await providerManager.create();

  expect(provider.createProvider).toHaveBeenCalled();
  expect(extensionContextMock.subscriptions.length).toBeGreaterThan(0);
});

test('should prompt user if minc CLI is missing', async () => {
  vi.mocked(cliToolManagerMock.installLatest).mockResolvedValue('/mock/path');

  vi.mocked(window.showInformationMessage).mockResolvedValue('Confirm');

  const spyAudit = vi.spyOn(providerManager, 'auditRecords');
  spyAudit.mockResolvedValue({ records: [] });

  await providerManager.create();

  // now grab the connection factory
  const connectionFactory = vi.mocked(providerMock.setKubernetesProviderConnectionFactory).mock.calls[0][0];
  if (connectionFactory && typeof connectionFactory.create === 'function') {
    await connectionFactory.create({});
  }

  const auditRecords = vi.mocked(providerMock.setKubernetesProviderConnectionFactory).mock.calls[0][1];
  if (auditRecords && typeof connectionFactory.create === 'function') {
    await auditRecords.auditItems({});
  }

  expect(spyAudit).toHaveBeenCalled();

  expect(window.showInformationMessage).toHaveBeenCalledWith(
    'minc is not installed, do you want to install the latest version?',
    'Cancel',
    'Confirm',
  );
  expect(cliToolManagerMock.installLatest).toHaveBeenCalled();

  expect(createClusterHelperMock.create).toHaveBeenCalledWith('/mock/path', {}, undefined, undefined);
});

test('should throw error if user cancels minc installation', async () => {
  vi.mocked(window.showInformationMessage).mockResolvedValue('Cancel');

  await providerManager.create();

  // now grab the connection factory
  const connectionFactory = vi.mocked(providerMock.setKubernetesProviderConnectionFactory).mock.calls[0][0];
  if (connectionFactory && typeof connectionFactory.create === 'function') {
    await expect(connectionFactory.create({})).rejects.toThrow('Unable to create minc cluster. No minc cli detected');
  } else {
    assert.fail('connectionFactory.create is not a function');
  }
});

test('should throw error if minc cli is not installed', async () => {
  vi.mocked(window.showInformationMessage).mockResolvedValue('Confirm');

  await providerManager.create();

  // now grab the connection factory
  const connectionFactory = vi.mocked(providerMock.setKubernetesProviderConnectionFactory).mock.calls[0][0];
  if (connectionFactory && typeof connectionFactory.create === 'function') {
    await expect(connectionFactory.create({})).rejects.toThrow('minc cli is not installed');
  } else {
    assert.fail('connectionFactory.create is not a function');
  }
});

test('should track clusters when provider events occur', async () => {
  const mincProviderMock = {
    onDidUpdateContainerConnection: vi.fn(cb => cb()),
    onDidRegisterContainerConnection: vi.fn(cb => cb()),
    onDidUnregisterContainerConnection: vi.fn(cb => cb()),
  };

  await providerManager.track(mincProviderMock as unknown as Provider);

  expect(clusterSearchHelperMock.search).toHaveBeenCalled();
});

test('should update clusters based on container data', async () => {
  const providerMock = {
    registerKubernetesProviderConnection: vi.fn(),
  };

  const mockContainers = [
    {
      Labels: { 'microshift-cluster': 'test-cluster' },
      State: 'running',
      Ports: [{ PrivatePort: 6443, PublicPort: 12345, Type: 'tcp' }],
      engineType: 'docker',
      engineId: 'engine1',
      Id: 'container1',
    },
    {
      Labels: { 'microshift-cluster': 'test2-cluster' },
      State: 'stopped',
      Ports: [{ PrivatePort: 6443, Type: 'tcp' }],
      engineType: 'docker',
      engineId: 'engine1',
      Id: 'container2',
    },
  ];

  await providerManager.updateClusters(
    providerMock as unknown as Provider,
    mockContainers as unknown as ContainerInfo[],
  );

  expect(providerManager.getClusters()).toHaveLength(2);
  expect(providerManager.getRegisteredKubernetesConnections()).toHaveLength(1);
  expect(providerMock.registerKubernetesProviderConnection).toHaveBeenCalled();

  // grab argument of providerMock.registerKubernetesProviderConnection
  const connection: KubernetesProviderConnection = vi.mocked(providerMock.registerKubernetesProviderConnection).mock
    .calls[0][0];

  // check lifecycle of the connection
  expect(connection.lifecycle).toBeDefined();
  // check start
  if (!connection.lifecycle?.start) {
    assert.fail('connection.lifecycle.start is not defined');
  }
  await connection.lifecycle?.start({} as unknown as LifecycleContext);
  expect(containerEngine.startContainer).toHaveBeenCalledWith('engine1', 'container1');

  // check stop
  if (!connection.lifecycle?.stop) {
    assert.fail('connection.lifecycle.stop is not defined');
  }
  await connection.lifecycle?.stop({} as unknown as LifecycleContext);
  expect(containerEngine.stopContainer).toHaveBeenCalledWith('engine1', 'container1');

  // delete
  if (!connection.lifecycle?.delete) {
    assert.fail('connection.lifecycle.stop is not defined');
  }
  await expect(connection.lifecycle?.delete()).rejects.toThrow('minc cli is not installed');

  // now if path is provided
  vi.mocked(cliToolManagerMock.getPath).mockReturnValue('/mock/path');
  await connection.lifecycle?.delete();
  expect(podmanDesktopProcess.exec).toHaveBeenCalledWith('/mock/path', ['delete']);

  // check status
  expect(connection.status()).toBe('stopped');
});

test('should remove stale Kubernetes connections', async () => {
  const connections = providerManager.getRegisteredKubernetesConnections();
  connections.push(
    ...[
      {
        connection: { name: 'old-cluster' } as KubernetesProviderConnection,
        disposable: { dispose: vi.fn() },
      },
    ],
  );

  await providerManager.updateClusters(providerMock, []);

  expect(providerManager.getRegisteredKubernetesConnections()).toHaveLength(0);
});

describe('track', () => {
  const mincProviderMock = {} as unknown as Provider;
  let spySearchAndUpdateMincClusters: MockInstance<ProviderManager['searchAndUpdateMincClusters']>;
  beforeEach(async () => {
    // track searchAndUpdateMincClusters
    spySearchAndUpdateMincClusters = vi.spyOn(providerManager, 'searchAndUpdateMincClusters');
  });

  test('should track containerEngine onEvent', async () => {
    await providerManager.track(mincProviderMock);

    // wait callback is called
    await vi.waitFor(() => expect(vi.mocked(containerEngine.onEvent)).toBeCalled());
    // now grab the callback
    const onEventCallback = vi.mocked(containerEngine.onEvent).mock.calls[0][0];
    const containerJsonEvent: ContainerJSONEvent = { Type: 'container' } as unknown as ContainerJSONEvent;
    onEventCallback?.(containerJsonEvent);

    expect(spySearchAndUpdateMincClusters).toHaveBeenCalledWith(mincProviderMock);
  });

  test('should track provider onDidUpdateContainerConnection event', async () => {
    await providerManager.track(mincProviderMock);

    // wait callback is called
    await vi.waitFor(() => expect(provider.onDidUpdateContainerConnection).toBeCalled());
    // now grab the callback
    const onDidUpdateContainerConnectionCallback = vi.mocked(provider.onDidUpdateContainerConnection).mock.calls[0][0];
    const onDidUpdateContainerConnectionCallbackEvent: UpdateContainerConnectionEvent = {
      providerId: 'foo',
    } as unknown as UpdateContainerConnectionEvent;
    onDidUpdateContainerConnectionCallback?.(onDidUpdateContainerConnectionCallbackEvent);

    expect(spySearchAndUpdateMincClusters).toHaveBeenCalled();
  });

  test('should track provider onDidRegisterContainerConnection event', async () => {
    await providerManager.track(mincProviderMock);

    // wait callback is called
    await vi.waitFor(() => expect(provider.onDidRegisterContainerConnection).toBeCalled());

    // now grab the callback
    const onDidRegisterContainerConnectionCallback = vi.mocked(provider.onDidRegisterContainerConnection).mock
      .calls[0][0];
    const onDidRegisterContainerConnectionCallbackEvent: RegisterContainerConnectionEvent = {
      providerId: 'foo',
    } as unknown as RegisterContainerConnectionEvent;
    onDidRegisterContainerConnectionCallback?.(onDidRegisterContainerConnectionCallbackEvent);

    expect(spySearchAndUpdateMincClusters).toHaveBeenCalled();
  });

  test('should track provider onDidUnregisterContainerConnection event', async () => {
    await providerManager.track(mincProviderMock);

    // wait callback is called
    await vi.waitFor(() => expect(provider.onDidUnregisterContainerConnection).toBeCalled());
    // now grab the callback
    const onDidUnregisterContainerConnectionCallback = vi.mocked(provider.onDidUnregisterContainerConnection).mock
      .calls[0][0];
    const onDidRegisterContainerConnectionCallbackEvent: UnregisterContainerConnectionEvent = {
      providerId: 'foo',
    } as unknown as UnregisterContainerConnectionEvent;
    onDidUnregisterContainerConnectionCallback?.(onDidRegisterContainerConnectionCallbackEvent);

    expect(spySearchAndUpdateMincClusters).toHaveBeenCalled();
  });
});

describe('auditRecords', () => {
  test('should return empty records on Linux if running as root', async () => {
    vi.mocked(env).isLinux = true;
    vi.mocked(podmanDesktopProcess.exec).mockResolvedValue({ stdout: '0' } as RunResult);

    const result = await providerManager.auditRecords();
    expect(result.records).toEqual([]);
  });

  test('should return warning on Linux if running as non-root', async () => {
    vi.mocked(env).isLinux = true;
    vi.mocked(podmanDesktopProcess.exec).mockResolvedValue({ stdout: '1000' } as RunResult);

    const result = await providerManager.auditRecords();
    expect(result.records).toEqual([
      {
        type: 'error',
        record: 'MINC requires a rootful podman. It is not possible to create a minc cluster in rootless mode.',
      },
    ]);
  });

  test('should return warning if Podman extension is not installed', async () => {
    vi.mocked(env).isLinux = false;
    vi.mocked(env).isMac = true;
    vi.mocked(provider.getContainerConnections).mockReturnValue([
      {
        connection: {
          status: (): ProviderConnectionStatus => 'started',
          type: 'podman',
        } as unknown as ContainerProviderConnection,
      } as unknown as ProviderContainerConnection,
    ]);

    vi.mocked(extensions.getExtension).mockReturnValue(undefined);

    const result = await providerManager.auditRecords();
    expect(result.records).toContainEqual({
      type: 'warning',
      record: 'Podman extension is not installed. Minc is only working with a podman container engine for now.',
    });
  });

  test('should return error if Podman is rootless', async () => {
    vi.mocked(env).isLinux = false;
    vi.mocked(env).isMac = true;
    vi.mocked(provider.getContainerConnections).mockReturnValue([
      {
        connection: {
          status: (): ProviderConnectionStatus => 'started',
          type: 'podman',
        } as unknown as ContainerProviderConnection,
      } as unknown as ProviderContainerConnection,
    ]);

    const mockExec = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ host: { security: { rootless: true } } }),
    });

    vi.mocked(extensions.getExtension).mockReturnValue({
      exports: { exec: mockExec },
    } as unknown as Extension<unknown>);

    const result = await providerManager.auditRecords();
    expect(result.records).toContainEqual({
      type: 'error',
      record: 'MINC requires a rootful Podman Machine. Please start a rootful Podman machine and try again.',
    });
  });

  test('should return warning if rootless info is undefined', async () => {
    vi.mocked(env).isLinux = false;
    vi.mocked(env).isMac = true;

    vi.mocked(provider.getContainerConnections).mockReturnValue([
      {
        connection: {
          status: () => 'started',
          type: 'podman',
        } as unknown as ContainerProviderConnection,
      } as unknown as ProviderContainerConnection,
    ]);

    const mockExec = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ host: { security: {} } }),
    });

    vi.mocked(extensions.getExtension).mockReturnValue({
      exports: { exec: mockExec },
    } as unknown as Extension<unknown>);

    const result = await providerManager.auditRecords();
    expect(result.records).toContainEqual({
      type: 'warning',
      record: 'Unable to check if podman is using rootless or rootful with host.security.rootless',
    });
  });

  test('should return warning if Podman exec throws error', async () => {
    vi.mocked(env).isLinux = false;
    vi.mocked(env).isMac = true;

    vi.mocked(provider.getContainerConnections).mockReturnValue([
      {
        connection: {
          status: () => 'started',
          type: 'podman',
        } as unknown as ContainerProviderConnection,
      } as unknown as ProviderContainerConnection,
    ]);

    const mockExec = vi.fn().mockRejectedValue(new Error('command failed'));

    vi.mocked(extensions.getExtension).mockReturnValue({
      exports: { exec: mockExec },
    } as unknown as Extension<unknown>);

    const result = await providerManager.auditRecords();
    expect(result.records[0].type).toBe('warning');
    expect(result.records[0].record).toContain('Unable to check if podman is using rootless or rootful');
  });
});
