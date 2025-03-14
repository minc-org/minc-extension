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

test('should call deactivate when deactivate is called', async () => {
  // Call activate first to initialize mincExtension
  await activate(extensionContextMock);

  // Call deactivate
  await deactivate();

  // Ensure that the deactivate method was called
  expect(MincExtension.prototype.deactivate).toHaveBeenCalled();
});

test('should set mincExtension to undefined after deactivate is called', async () => {
  // Call activate to initialize the extension
  await activate(extensionContextMock);

  // Call deactivate
  await deactivate();

  if ('mincExtension' in global) {
    // Ensure that mincExtension is set to undefined
    expect(global.mincExtension).toBeUndefined();
  } else {
    assert.fail('mincExtension not found in global');
  }
});
