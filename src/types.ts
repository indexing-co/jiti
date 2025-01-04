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
};

export type Param = {
  key: string;
  name: string;
  type: 'NETWORK' | 'ADDRESS' | 'STRING';
  multiple?: boolean;
  optional?: boolean;
};
