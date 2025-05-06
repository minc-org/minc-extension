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

import { process, type CancellationToken, type Logger, type TelemetryLogger } from '@podman-desktop/api';

import { inject, injectable } from 'inversify';
import { TelemetryLoggerSymbol } from '../inject/symbol';

@injectable()
export class CreateClusterHelper {
  @inject(TelemetryLoggerSymbol)
  private telemetryLogger: TelemetryLogger;

  async create(
    mincCliPath: string,
    params: { [key: string]: unknown },
    logger?: Logger,
    token?: CancellationToken,
  ): Promise<void> {
    const telemetryOptions: Record<string, unknown> = {};

    // grab http host port
    let httpHostPort = 80;
    if (
      params['microshift.cluster.creation.http.port'] &&
      ['string', 'number'].includes(typeof params['microshift.cluster.creation.http.port'])
    ) {
      httpHostPort = Number(params['microshift.cluster.creation.http.port']);
    }

    // grab https host port
    let httpsHostPort = 443;
    if (
      params['microshift.cluster.creation.https.port'] &&
      ['string', 'number'].includes(typeof params['microshift.cluster.creation.https.port'])
    ) {
      httpsHostPort = Number(params['microshift.cluster.creation.https.port']);
    }

    // now execute the command to create the cluster
    const startTime = performance.now();
    try {
      await process.exec(
        mincCliPath,
        ['create', '--http-port', String(httpHostPort), '--https-port', String(httpsHostPort)],
        {
          logger,
          token,
        },
      );
    } catch (error: unknown) {
      telemetryOptions.error = error;
      let errorMessage = '';

      if (error && typeof error === 'object' && 'message' in error) {
        errorMessage = String(error.message);
      } else {
        errorMessage = String(error);
      }

      throw new Error(`Failed to create minc cluster. ${errorMessage}`);
    } finally {
      const endTime = performance.now();
      telemetryOptions.duration = endTime - startTime;
      this.telemetryLogger.logUsage('createCluster', telemetryOptions);
    }
  }
}
