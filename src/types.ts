export type Template = {
  key: string;
  name: string;
  description: string;
  disabled: boolean;
  tags: string[];
  params: Param[];
  transform: (
    payload: Record<string, unknown>,
    _ctx?: Record<string, unknown> & { params: Record<string, unknown> }
  ) => unknown;
  tests: TemplateTest[];
};

export type Param = {
  key: string;
  name: string;
  type: 'NETWORK' | 'ADDRESS' | 'STRING' | 'NUMBER' | 'BOOLEAN';
  multiple?: boolean;
  optional?: boolean;
  values?: string[];
  default?: string;
};

export type TemplateTest = {
  params: Record<string, unknown>;
  payload: `https://${string}` | Record<string, unknown>;
  output: unknown;
};

export type SubTemplate = {
  match: (payload: Record<string, unknown>) => boolean;
  transform: Template['transform'];
  tests: Template['tests'];
};
