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

import type { NavigationBar } from '@podman-desktop/tests-playwright';
import {
  expect as playExpect,
  ExtensionCardPage,
  test,
  ResourceConnectionCardPage,
  ExtensionState,
  RunnerOptions,
} from '@podman-desktop/tests-playwright';

import { MincExtensionPage } from './model/pages/minc-extension-page';

let extensionInstalled = false;
let extensionCard: ExtensionCardPage;
let resourcesPage: ResourceConnectionCardPage;
const imageName = 'ghcr.io/minc-org/minc-extension:latest';
const extensionLabelMinc = 'minc-org.minc'; //region card
const extensionLabelNameMinc = 'minc'; //details button
const extensionLabelResourcesMinc = 'microshift'; //resource connection card
const skipInstallation = process.env.SKIP_INSTALLATION ?? false;

test.use({
  runnerOptions: new RunnerOptions({ customFolder: 'minc-tests-pd', autoUpdate: false, autoCheckUpdates: false }),
});

test.beforeAll(async ({ runner, page, welcomePage }) => {
  runner.setVideoAndTraceName('minc-extension-installation-e2e');
  await welcomePage.handleWelcomePage(true);
  extensionCard = new ExtensionCardPage(page, extensionLabelNameMinc, extensionLabelMinc);
  resourcesPage = new ResourceConnectionCardPage(page, extensionLabelResourcesMinc);
});

test.afterAll(async ({ runner }) => {
  await runner.close();
  console.log('Runner closed');
});

test.describe
  .serial('MINC extension verification', () => {
    test.describe
      .serial('MINC extension installation', () => {
        // PR check builds extension locally and so it is available already
        test('Go to extensions and check if extension is already installed', async ({ navigationBar }) => {
          const extensions = await navigationBar.openExtensions();
          if (await extensions.extensionIsInstalled(extensionLabelMinc)) {
            console.log('Extension is already installed');
            extensionInstalled = true;
          }
        });

        // we want to skip removing of the extension when we are running tests from PR check
        test('Uninstall previous version of minc extension', async ({ navigationBar }) => {
          test.skip(!extensionInstalled || !!skipInstallation);
          test.setTimeout(60_000);
          await removeExtension(navigationBar);
        });

        // we want to install extension from OCI image (usually using latest tag) after new code was added to the codebase
        // and extension was published already
        test('Extension can be installed using OCI image', async ({ navigationBar }) => {
          test.skip(extensionInstalled); //!!skipInstallation?
          test.setTimeout(200_000);
          const extensions = await navigationBar.openExtensions();
          await extensions.installExtensionFromOCIImage(imageName);
          await extensionCard.card.scrollIntoViewIfNeeded();
          await playExpect(extensionCard.card).toBeVisible();
        });

        test('Extension (card) is installed, present and active', async ({ navigationBar }) => {
          const extensions = await navigationBar.openExtensions();
          const mincExtensionCard = await extensions.getInstalledExtension(extensionLabelNameMinc, extensionLabelMinc);
          await playExpect(mincExtensionCard.card).toBeVisible();
          await mincExtensionCard.card.scrollIntoViewIfNeeded();
          await playExpect(mincExtensionCard.status).toHaveText(ExtensionState.Active);
          await playExpect
            .poll(async () => await extensions.extensionIsInstalled(extensionLabelMinc), { timeout: 30_000 })
            .toBeTruthy();
        });

        test('Extension details show correct status, no error', async ({ page, navigationBar }) => {
          const extensions = await navigationBar.openExtensions();
          const extensionCard = await extensions.getInstalledExtension(extensionLabelNameMinc, extensionLabelMinc);
          await extensionCard.openExtensionDetails('Red Hat OpenShift Local');
          const details = new MincExtensionPage(page);
          await playExpect(details.heading).toBeVisible();
          await playExpect(details.status).toHaveText(ExtensionState.Active);
          const errorTab = details.tabs.getByRole('button', { name: 'Error' });
          // we would like to propagate the error's stack trace into test failure message
          let stackTrace = '';
          if ((await errorTab.count()) > 0) {
            await details.activateTab('Error');
            stackTrace = await details.errorStackTrace.innerText();
          }
          await playExpect(errorTab, `Error Tab was present with stackTrace: ${stackTrace}`).not.toBeVisible();
        });
      });

    test.describe
      .serial('MINC extension handling', () => {
        test('Extension can be disabled', async ({ navigationBar }) => {
          const extensions = await navigationBar.openExtensions();
          await playExpect
            .poll(async () => await extensions.extensionIsInstalled(extensionLabelMinc), { timeout: 30_000 })
            .toBeTruthy();
          const extensionCard = await extensions.getInstalledExtension(extensionLabelNameMinc, extensionLabelMinc);
          await playExpect(extensionCard.status).toHaveText(ExtensionState.Active);
          await extensionCard.disableExtension();
          await playExpect(extensionCard.status).toHaveText(ExtensionState.Disabled);
          //checking dashboard assets
          const dashboard = await navigationBar.openDashboard();
          await playExpect(dashboard.openshiftLocalProvider).toHaveCount(0, { timeout: 15_000 });
          //checking settings/resources assets
          await navigationBar.openSettings();
          await playExpect(resourcesPage.card).toHaveCount(0, { timeout: 15_000 });
          //check settings/preferences assets? not part of the extension yet
        });

        test('Extension can be re-enabled correctly', async ({ navigationBar }) => {
          const extensions = await navigationBar.openExtensions();
          await playExpect
            .poll(async () => await extensions.extensionIsInstalled(extensionLabelMinc), { timeout: 30_000 })
            .toBeTruthy();
          const extensionCard = await extensions.getInstalledExtension(extensionLabelNameMinc, extensionLabelMinc);
          await playExpect(extensionCard.status).toHaveText(ExtensionState.Disabled);
          await extensionCard.enableExtension();
          await playExpect(extensionCard.status).toHaveText(ExtensionState.Active);
          //checking settings/resources assets
          await navigationBar.openSettings();
          await playExpect(resourcesPage.card).toBeVisible();
          //check settings/preferences assets? not part of the extension yet
        });
      });

    test('MINC extension can be removed', async ({ navigationBar }) => {
      await removeExtension(navigationBar);
    });
  });

async function removeExtension(navBar: NavigationBar): Promise<void> {
  const extensions = await navBar.openExtensions();
  const extensionCard = await extensions.getInstalledExtension(extensionLabelNameMinc, extensionLabelMinc);
  await extensionCard.disableExtension();
  await extensionCard.removeExtension();
  await playExpect
    .poll(async () => await extensions.extensionIsInstalled(extensionLabelMinc), { timeout: 15_000 })
    .toBeFalsy();
}
