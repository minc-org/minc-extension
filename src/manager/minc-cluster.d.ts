import type { ProviderConnectionStatus } from '@podman-desktop/api';

export interface MincCluster {
  id: string;
  engineId: string;
  name: string;
  status: ProviderConnectionStatus;
  apiPort: number;
  engineType: 'podman' | 'docker';
}
