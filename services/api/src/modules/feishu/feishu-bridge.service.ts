import { Inject, Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { adminAssistants, feishuBots, feishuInbox, type Database } from '@qitu/database';
import type { FeishuBridgeStatus } from '@qitu/contracts';
import { DATABASE_TOKEN } from '../../database';
import { decryptModelSecret, readModelSecretKey } from '../../common/secrets/model-secret';
import { DEFAULT_FEISHU_ASSISTANT_ID } from './feishu.service';
import { FeishuInboxService } from './feishu-inbox.service';
import { FeishuSocketFactory, type FeishuSocket } from './feishu-socket.factory';

interface BridgeEntry { fingerprint: string; socket: FeishuSocket; lastReceivedAt?: string }

@Injectable()
export class FeishuBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeishuBridgeService.name);
  private readonly connections = new Map<string, BridgeEntry>();
  private readonly errors = new Map<string, string>();
  private timer?: ReturnType<typeof setInterval>;
  private reconciling = false;
  private stopped = false;
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Database | null,
    private readonly factory: FeishuSocketFactory,
    private readonly inbox: FeishuInboxService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.reconcile().catch(() => this.logger.warn('Feishu bridge storage unavailable')); }, 5_000);
    this.timer.unref();
    void this.reconcile().catch(() => this.logger.warn('Feishu bridge startup deferred'));
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.closeAll();
  }

  private closeAll(): void {
    for (const entry of this.connections.values()) entry.socket.close();
    this.connections.clear();
  }

  async reconcile(): Promise<void> {
    if (this.stopped || this.reconciling || !this.db) return;
    this.reconciling = true;
    try {
      const bots = await this.db.select().from(feishuBots).where(and(eq(feishuBots.enabled, true), eq(feishuBots.inboundEnabled, true)));
      const assistants = await this.db.select({ id: adminAssistants.id }).from(adminAssistants).where(eq(adminAssistants.enabled, true));
      if (this.stopped) return;
      const eligible = bots.filter((bot) => bot.appId && bot.appSecretEncrypted && assistants.some((assistant) => assistant.id === bot.assistantId));
      const desired = new Set(eligible.map((bot) => bot.assistantId));
      for (const [id, entry] of this.connections) {
        if (!desired.has(id)) { entry.socket.close(); this.connections.delete(id); }
      }
      this.errors.clear();
      for (const bot of eligible) {
        const previous = this.connections.get(bot.assistantId);
        if (eligible.some((other) => other.id !== bot.id && other.appId === bot.appId && other.domain === bot.domain)) {
          previous?.socket.close(); this.connections.delete(bot.assistantId);
          this.errors.set(bot.assistantId, 'FEISHU_APP_BOUND_MULTIPLE_ASSISTANTS');
          continue;
        }
        const fingerprint = createHash('sha256').update(JSON.stringify([bot.appId, bot.appSecretEncrypted, bot.domain])).digest('hex');
        if (previous?.fingerprint === fingerprint && previous.socket.state() !== 'failed') continue;
        previous?.socket.close(); this.connections.delete(bot.assistantId);
        try {
          const key = readModelSecretKey();
          if (!key || !bot.appSecretEncrypted || !bot.appId) throw new Error('FEISHU_CREDENTIAL_UNAVAILABLE');
          const appId = bot.appId;
          const socket = this.factory.create({
            appId, appSecret: decryptModelSecret(bot.appSecretEncrypted, key), domain: bot.domain === 'lark' ? 'lark' : 'feishu',
            receive: async (payload) => {
              const accepted = await this.inbox.receive(bot.assistantId, appId, payload);
              const current = this.connections.get(bot.assistantId);
              if (accepted && current?.fingerprint === fingerprint) current.lastReceivedAt = new Date().toISOString();
            },
          });
          const entry: BridgeEntry = { fingerprint, socket };
          this.connections.set(bot.assistantId, entry);
          void socket.start().catch(() => {
            if (this.connections.get(bot.assistantId) !== entry) return;
            socket.close(); this.connections.delete(bot.assistantId);
            this.errors.set(bot.assistantId, 'FEISHU_CONNECTION_FAILED');
          });
        } catch {
          this.errors.set(bot.assistantId, 'FEISHU_CREDENTIAL_UNAVAILABLE');
          this.logger.warn({ code: 'FEISHU_CREDENTIAL_UNAVAILABLE', assistantId: bot.assistantId });
        }
      }
    } catch (error) { this.closeAll(); throw error; }
    finally { this.reconciling = false; }
  }

  async status(assistantId: string): Promise<FeishuBridgeStatus> {
    if (!this.db) throw new ServiceUnavailableException('Feishu bridge storage unavailable');
    const entry = this.connections.get(assistantId);
    const state = entry?.socket.state();
    const [lastReply] = await this.db.select({ at: feishuInbox.updatedAt }).from(feishuInbox)
      .where(and(eq(feishuInbox.assistantId, assistantId), eq(feishuInbox.status, 'sent'))).orderBy(desc(feishuInbox.updatedAt)).limit(1);
    const errorCode = this.errors.get(assistantId) ?? (state === 'failed' ? 'FEISHU_CONNECTION_FAILED' : undefined);
    return {
      assistantId, state: errorCode ? 'error' : state === 'connected' ? 'connected' : state === 'reconnecting' ? 'reconnecting' : entry ? 'starting' : 'stopped',
      ...(errorCode ? { errorCode } : {}), lastReceivedAt: entry?.lastReceivedAt, lastReplyAt: lastReply?.at.toISOString(),
      reportingSupported: assistantId === DEFAULT_FEISHU_ASSISTANT_ID,
    };
  }
}
