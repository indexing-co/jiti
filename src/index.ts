import { templates } from './templates';
import * as utils from './utils';
import * as types from './types';

export { utils, types };

export function getAllTemplates() {
  return templates;
}

export function getTemplateByKey(key: string) {
  return templates.find((template) => template.key === key);
}
