import { templates as templateList } from './templates';
import * as utils from './utils';
import * as types from './types';

const templates = templateList.reduce((a, b) => ({ ...a, [b.key]: Object.assign({}, b) }), {});

export { utils, templates, types };

export function getAllTemplates() {
  return templateList.slice();
}

//Function to get a template by its key
export function getTemplateByKey(key: string) {
  return templateList.slice().find((template) => template.key === key);
}
