import { go } from './route.ts';

// Secret words for the cube: right-click it (or hold it on a phone) and type one into its bubble. Each word is one
// line here: the word, and what it does.
export const COMMANDS: Record<string, () => void> = {
  ghost: () => go('#/ghost'),
};

// Runs the command the text spells, if any.
export function runCommand(text: string): boolean {
  const run = COMMANDS[text.trim().toLowerCase()];
  if (!run) return false;
  run();
  return true;
}
