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
  type CancellationToken,
  type Disposable,
  containerEngine,
  type ContainerInfo,
  process,
  type ExtensionContext,
  type KubernetesProviderConnection,
  type Logger,
  type Provider,
  provider,
  type ProviderConnectionLifecycle,
  type ProviderConnectionStatus,
  type ProviderOptions,
  window,
} from '@podman-desktop/api';
import { CreateClusterHelper } from '../helper/create-cluster-helper';
import { ClusterSearchHelper } from '../helper/cluster-search-helper';

import { CliToolManager } from './cli-tool-manager';
import { MincCluster } from './minc-cluster';

/**
 * Responsible to create and manage the registration of the provider
 */
@injectable()
export class ProviderManager {
  // default port
  private static readonly API_MINC_INTERNAL_API_PORT = 6443;

  @inject(ExtensionContextSymbol)
  private extensionContext: ExtensionContext;

  @inject(CliToolManager)
  private cliToolManager: CliToolManager;

  @inject(CreateClusterHelper)
  private createCluster: CreateClusterHelper;

  @inject(ClusterSearchHelper)
  private clusterSearchHelper: ClusterSearchHelper;

  private mincClusters: MincCluster[] = [];

  private registeredKubernetesConnections: {
    connection: KubernetesProviderConnection;
    disposable: Disposable;
  }[] = [];

  async create(): Promise<void> {
    const providerOptions: ProviderOptions = {
      name: 'MicroShift',
      id: 'microshift',
      status: 'unknown',
      images: {
        icon: './icon.png',
        logo: {
          dark: './logo-dark.png',
          light: './logo-light.png',
        },
      },
    };

    // Empty connection descriptive message
    providerOptions.emptyConnectionMarkdownDescription =
      'minc is a MicroShift utility to run a local MicroShift cluster\n using a single-container node providing an easy way to create and manage Kubernetes environments for development and testing.\n\nMore information: [minc-org](https://github.com/minc-org/minc/)';

    const mincProvider = provider.createProvider(providerOptions);

    this.extensionContext.subscriptions.push(mincProvider);

    const disposable = mincProvider.setKubernetesProviderConnectionFactory({
      create: async (params: { [key: string]: unknown }, logger?: Logger, token?: CancellationToken) => {
        // if minc is not installed, let's ask the user to install it
        let cliPath = this.cliToolManager.getPath();
        if (!cliPath) {
          const result = await window.showInformationMessage(
            'minc is not installed, do you want to install the latest version?',
            'Cancel',
            'Confirm',
          );
          if (result !== 'Confirm') {
            throw new Error('Unable to create minc cluster. No minc cli detected');
          }
          cliPath = await this.cliToolManager.installLatest();
        }

        if (!cliPath) {
          throw new Error('minc cli is not installed');
        }

        return this.createCluster.create(cliPath, params, logger, token);
      },
      creationDisplayName: 'Minc cluster',
    });
    this.extensionContext.subscriptions.push(disposable);

    await this.track(mincProvider);
  }

  async searchAndUpdateMincClusters(mincprovider: Provider): Promise<void> {
    const containers = await this.clusterSearchHelper.search();

    await this.updateClusters(mincprovider, containers);
  }

  async track(mincprovider: Provider): Promise<void> {
    // when containers are refreshed, update
    containerEngine.onEvent(async event => {
      if (event.Type === 'container') {
        // needs to search for minc clusters
        await this.searchAndUpdateMincClusters(mincprovider);
      }
    });

    // when a provider is changing, update the status
    provider.onDidUpdateContainerConnection(async () => {
      // needs to search for minc clusters
      await this.searchAndUpdateMincClusters(mincprovider);
    });

    // search when a new container is updated or removed
    provider.onDidRegisterContainerConnection(async () => {
      await this.searchAndUpdateMincClusters(mincprovider);
    });
    provider.onDidUnregisterContainerConnection(async () => {
      await this.searchAndUpdateMincClusters(mincprovider);
    });

    // search for minc clusters on first call
    await this.searchAndUpdateMincClusters(mincprovider);
  }

  // search for clusters
  async updateClusters(provider: Provider, containers: ContainerInfo[]): Promise<void> {
    const mincContainers = containers.map(container => {
      const clusterName = container.Labels[ClusterSearchHelper.CLUSTER_LABEL];
      const clusterStatus = container.State;

      // search the port where the cluster is listening
      const listeningPort = container.Ports.find(
        port => port.PrivatePort === ProviderManager.API_MINC_INTERNAL_API_PORT && port.Type === 'tcp',
      );
      let status: ProviderConnectionStatus;
      if (clusterStatus === 'running') {
        status = 'started';
      } else {
        status = 'stopped';
      }

      return {
        name: clusterName,
        status,
        apiPort: listeningPort?.PublicPort ?? 0,
        engineType: container.engineType,
        engineId: container.engineId,
        id: container.Id,
      };
    });
    this.mincClusters = mincContainers.map(container => {
      return {
        name: container.name,
        status: container.status,
        apiPort: container.apiPort,
        engineType: container.engineType,
        engineId: container.engineId,
        id: container.id,
      };
    });

    for (const cluster of this.mincClusters) {
      const item = this.registeredKubernetesConnections.find(item => item.connection.name === cluster.name);
      const status = (): ProviderConnectionStatus => {
        return cluster.status;
      };
      if (!item) {
        const lifecycle: ProviderConnectionLifecycle = {
          start: async (): Promise<void> => {
            await containerEngine.startContainer(cluster.engineId, cluster.id);
          },
          stop: async (): Promise<void> => {
            await containerEngine.stopContainer(cluster.engineId, cluster.id);
          },
          delete: async (): Promise<void> => {
            const installedPath = this.cliToolManager.getPath();
            if (!installedPath) {
              throw new Error('minc cli is not installed');
            }
            await process.exec(installedPath, ['delete']);
          },
        };
        // create a new connection
        const connection: KubernetesProviderConnection = {
          name: cluster.name,
          status,
          endpoint: {
            apiURL: `https://localhost:${cluster.apiPort}`,
          },
          lifecycle,
        };
        const disposable = provider.registerKubernetesProviderConnection(connection);

        this.registeredKubernetesConnections.push({ connection, disposable });
      } else {
        item.connection.status = status;
        item.connection.endpoint.apiURL = `https://localhost:${cluster.apiPort}`;
      }
    }

    // do we have registeredKubernetesConnections that are not in mincClusters?
    for (const item of this.registeredKubernetesConnections) {
      const cluster = this.mincClusters.find(cluster => cluster.name === item.connection.name);
      if (!cluster) {
        // remove the connection
        item.disposable.dispose();

        // remove the item from the list
        const index = this.registeredKubernetesConnections.indexOf(item);
        if (index > -1) {
          this.registeredKubernetesConnections.splice(index, 1);
        }
      }
    }
  }

  protected getClusters(): MincCluster[] {
    return this.mincClusters;
  }

  protected getRegisteredKubernetesConnections(): {
    connection: KubernetesProviderConnection;
    disposable: Disposable;
  }[] {
    return this.registeredKubernetesConnections;
  }
}
