/** Aliases apply only to the bundled synthetic demo, never to external packages. */
export const FIXTURE_SKILL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  order_operations: 'math.order_operations',
  nested_parentheses: 'math.parentheses',
  powers: 'math.powers',
  distributivity: 'math.distributivity',
  factorization: 'math.factorization',
  word_problems: 'math.word_problems',
});

export function canonicalFixtureSkillId(bankId: string, skillId: string): string {
  return bankId === 'lutz-maths-demo' && Object.hasOwn(FIXTURE_SKILL_ALIASES, skillId)
    ? FIXTURE_SKILL_ALIASES[skillId]
    : skillId;
}
