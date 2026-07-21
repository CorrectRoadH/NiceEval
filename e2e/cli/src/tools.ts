import { tool, type ToolSet } from "ai";
import { z } from "zod";

export function weatherTools(): ToolSet {
  return {
    get_weather: tool({
      description: "Get the current weather for a city.",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ city, condition: "sunny", temperatureC: 24 }),
    }),
  };
}
