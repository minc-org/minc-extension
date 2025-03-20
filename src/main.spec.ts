import { MincExtension } from './minc-extension';
import type { ExtensionContext } from '@podman-desktop/api';
import { vi, expect, beforeEach, test, assert } from 'vitest';
import { activate, deactivate } from './main';

let extensionContextMock: ExtensionContext;

vi.mock(import('./minc-extension'));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();

  // Create a mock for the ExtensionContext
  extensionContextMock = {} as ExtensionContext;
});

test('should initialize and activate the MincExtension when activate is called', async () => {
  // Call activate
  await activate(extensionContextMock);

  // Ensure that the MincExtension is instantiated and its activate method is called
  expect(MincExtension.prototype.activate).toHaveBeenCalled();
});
