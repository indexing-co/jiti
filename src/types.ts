export type Template = {
    key: string;
    name: string;
    description: string;
    disabled: boolean;
    tags: string[];
    params: Param[];
    function: (params: Record<string, unknown>) => string;
};

export type Param = {
    key: string;
    name: string;
    type: "NETWORK" | "ADDRESS";
    multiple?: boolean;
    optional?: boolean;
};