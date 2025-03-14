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

import { containerEngine, type ContainerInfo } from '@podman-desktop/api';
import { injectable } from 'inversify';

/**
 * Allow to find all containers with the CLUSTER_LABEL label
 */
@injectable()
export class ClusterSearchHelper {
  static readonly CLUSTER_LABEL = 'io.x-openshift.microshift.cluster';

  async search(): Promise<ContainerInfo[]> {
    const allContainers = await containerEngine.listContainers();

    // search all containers with CLUSTER_LABEL label
    return allContainers.filter(container => {
      return container.Labels?.[ClusterSearchHelper.CLUSTER_LABEL];
    });
  }
}
