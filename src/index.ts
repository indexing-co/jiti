import { templates as templateList } from './templates';

export * as utils from './utils';
export * as types from './types';

export const templates = templateList.reduce((a, b) => ({ ...a, [b.key]: Object.assign({}, b) }), {});

export function getAllTemplates() {
  return templateList.slice();
}

//Function to get a template by its key
export function getTemplateByKey(key: string) {
  return templateList.slice().find((template) => template.key === key);
}
