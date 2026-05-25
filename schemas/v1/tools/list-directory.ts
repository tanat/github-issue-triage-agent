import { z } from 'zod';

export const ListDirectoryInput = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  path: z.string().default('').describe('Directory path within the repo. "" = repository root.'),
  ref: z.string().optional(),
});

export type ListDirectoryInput = z.infer<typeof ListDirectoryInput>;

export const ListDirectoryOutput = z.array(
  z.object({
    name: z.string(),
    type: z.enum(['file', 'dir', 'symlink', 'submodule']),
    size: z.number().int().optional(),
  }),
);
export type ListDirectoryOutput = z.infer<typeof ListDirectoryOutput>;
