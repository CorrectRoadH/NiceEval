import { tool, type ToolSet } from "ai";
import { z } from "zod";

export function stockTools(): ToolSet {
  return {
    get_stock_price: tool({
      description: "Look up the current stock price for a ticker symbol.",
      inputSchema: z.object({ symbol: z.string() }),
      execute: async ({ symbol }) => ({ symbol, price: 42.17, currency: "USD" }),
    }),
  };
}
