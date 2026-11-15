import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        // Set on stub pages: what the page should cover. The build lists these pages, and a
        // banner tells readers the page is not written yet. Delete it when the page is done.
        todo: z.string().optional(),
      }),
    }),
  }),
};
