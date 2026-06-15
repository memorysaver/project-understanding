import { z } from "zod";

/**
 * The structured Digest the LLM must produce from a paper's full text.
 * Each field is a list of short, self-contained bullet points. This schema is
 * passed to `llm.complete` so the provider returns validated JSON, and it is the
 * contract that downstream stages (stylist, publisher) read.
 */
export const digestSchema = z.object({
  contributions: z.array(z.string()).min(1),
  methods: z.array(z.string()).min(1),
  results: z.array(z.string()).min(1),
});

export type DigestContent = z.infer<typeof digestSchema>;
