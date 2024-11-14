import { Template, Param } from "../types";

const allBlocks: Template = {
  key: "allBlocks",
  name: "All Blocks",
  description: "Get all blocks with all available fields",
  tags: ["EVM", "TRANSACTIONS"],
  disabled: false,
  params: [],
  function: () => {
    return `
      function allBlocks(block, _ctx) {
      return block;
    }`;
  },
};

export default allBlocks;