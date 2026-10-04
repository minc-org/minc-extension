import { MincExtension } from './minc-extension';
import type { ExtensionContext } from '@podman-desktop/api';
import { vi, expect, beforeEach, test } from 'vitest';
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

test('should call deactivate when deactivate is called', async () => {
  // Call activate first to initialize mincExtension
  await activate(extensionContextMock);

  // Call deactivate
  await deactivate();

  // Ensure that the deactivate method was called
  expect(MincExtension.prototype.deactivate).toHaveBeenCalled();
});

test('should release mincExtension after deactivate is called', async () => {
  await activate(extensionContextMock);
  await deactivate();

  // a second deactivate has no extension left to deactivate
  await deactivate();
  expect(MincExtension.prototype.deactivate).toHaveBeenCalledOnce();
});
