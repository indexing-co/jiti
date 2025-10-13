import * as allTypes from './types';
import * as allUtils from './utils';
import { templates as templateList } from './templates';

export type Template = allTypes.Template;
export const utils = { ...allUtils };
export const templates = templateList.reduce((a, b) => ({ ...a, [b.key]: Object.assign({}, b) }), {});

export function getAllTemplates() {
  return templateList.slice();
}

// Function to get a template by its key
export function getTemplateByKey(key: string) {
  return templateList.slice().find((template) => template.key === key);
}
