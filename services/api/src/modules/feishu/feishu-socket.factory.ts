import { Injectable } from '@nestjs/common';
import { Domain, EventDispatcher, LoggerLevel, WSClient } from '@larksuiteoapi/node-sdk';
import type { FeishuDomain } from '@qitu/contracts';

export interface FeishuSocket {
  start(): Promise<void>;
  close(): void;
  state(): 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
}

@Injectable()
export class FeishuSocketFactory {
  create(input: { appId: string; appSecret: string; domain: FeishuDomain; receive: (payload: unknown) => Promise<void> }): FeishuSocket {
    // The SDK can log connection URLs and provider payloads. Diagnostics use our bounded codes instead.
    const quietLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {}, trace: () => {} };
    const client = new WSClient({
      appId: input.appId, appSecret: input.appSecret, domain: input.domain === 'lark' ? Domain.Lark : Domain.Feishu,
      autoReconnect: true, handshakeTimeoutMs: 10_000, loggerLevel: LoggerLevel.error, logger: quietLogger,
    });
    const dispatcher = new EventDispatcher({ logger: quietLogger }).register({ 'im.message.receive_v1': input.receive });
    return {
      start: () => client.start({ eventDispatcher: dispatcher }),
      close: () => client.close({ force: true }),
      state: () => client.getConnectionStatus().state,
    };
  }
}
