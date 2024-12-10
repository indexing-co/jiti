import { Template, Param } from "../types";

const tokenTransfers: Template = {
  key: "tokenTransfers",
  name: "Token Transfers",
  description: "Get all blocks for a set of token types.",
  tags: ["EVM", "NFTs", "ERC20", "ERC721"],
  disabled: false,
  params: [],
  function: () => {
    return `
      function tokenTransfers(block, _ctx) {
      return block;
    }`;
  },
};

export default tokenTransfers;