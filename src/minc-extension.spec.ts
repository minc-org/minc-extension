import { MincExtension } from './minc-extension';
import type { ExtensionContext } from '@podman-desktop/api';
import { vi, expect, beforeEach, test } from 'vitest';
import { ProviderManager } from './manager/provider-manager';
import { CliToolManager } from './manager/cli-tool-manager';
import type { Container } from 'inversify';

let extensionContextMock: ExtensionContext;
let mincExtension: TestMincExtension;

vi.mock(import('./manager/provider-manager'));
vi.mock(import('./manager/cli-tool-manager'));

class TestMincExtension extends MincExtension {
  public async deferActivate(): Promise<void> {
    return super.deferActivate();
  }

  public getContainer(): Container | undefined {
    return super.getContainer();
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();

  // Create a mock for the ExtensionContext
  extensionContextMock = {} as ExtensionContext;
  mincExtension = new TestMincExtension(extensionContextMock);
});

test('should activate correctly', async () => {
  await mincExtension.activate();
  expect(mincExtension.getContainer()?.get(ProviderManager)).toBeInstanceOf(ProviderManager);
  expect(mincExtension.getContainer()?.get(CliToolManager)).toBeInstanceOf(CliToolManager);
});

test('should call deferActivate correctly', async () => {
  await mincExtension.activate();

  // check we called the registration methods
  await vi.waitFor(() => expect(CliToolManager.prototype.registerCliTool).toHaveBeenCalled());
  await vi.waitFor(() => expect(ProviderManager.prototype.create).toHaveBeenCalled());
});

test('should deactivate correctly', async () => {
  await mincExtension.activate();

  expect(mincExtension.getContainer()?.isBound(ProviderManager)).toBeTruthy();
  expect(mincExtension.getContainer()?.isBound(CliToolManager)).toBeTruthy();

  await mincExtension.deactivate();

  // check the bindings are gone
  expect(mincExtension.getContainer()?.isBound(ProviderManager)).toBeFalsy();
  expect(mincExtension.getContainer()?.isBound(CliToolManager)).toBeFalsy();
});
