import type { ChannelAdapterType } from './config';

export interface DmAdapter {
  /** Shows a typing indicator to `recipientId` (best effort). */
  typing?(recipientId: string): Promise<void>;
  sendText(recipientId: string, text: string): Promise<void>;
  sendImage(recipientId: string, image: Buffer): Promise<void>;
  stop(): Promise<void>;
}

const adapters = new Map<string, DmAdapter>();
const key = (storeId: string, type: ChannelAdapterType) => `${storeId}:${type}`;

export const registerAdapter = (storeId: string, type: ChannelAdapterType, adapter: DmAdapter) => {
  adapters.set(key(storeId, type), adapter);
};
export const unregisterAdapter = (storeId: string, type: ChannelAdapterType, adapter?: DmAdapter) => {
  if (!adapter || adapters.get(key(storeId, type)) === adapter) adapters.delete(key(storeId, type));
};
export const getAdapter = (storeId: string, type: ChannelAdapterType) => adapters.get(key(storeId, type));
