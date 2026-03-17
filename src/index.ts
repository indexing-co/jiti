import * as allUtils from './utils';
import * as allTemplates from './templates';

export * from './types';
export * from './types/beats';
export type { NetworkTransfer } from './templates/token-transfers/types';
export type { HubEventMessage } from './utils/snapchain-parse-event';
export const utils = { ...allUtils };
export const templates = { ...allTemplates };

export function getAllTemplates() {
  return Object.values(allTemplates).slice();
}

export function getTemplateByKey(key: string) {
  return templates[key];
}
