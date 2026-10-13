import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import fixture from './fixtures/lutz-maths-demo.json';
import legacyFixture from './fixtures/lutz-maths-demo-v1.json';
import { canonicalFixtureSkillId, FIXTURE_SKILL_ALIASES } from './fixture-migrations';
import profiles from './fixtures/profiles.json';
import profileSchema from './schemas/student-profile.schema.json';
import { parseQuestionBank, parseStudentProfile } from './validation';

const freshBank = () => structuredClone(fixture);

describe('Question bank import boundary', () => {
  it('accepts all five answer types in the 48-question synthetic fixture', () => {
    const bank = parseQuestionBank(freshBank());
    expect(bank.questions).toHaveLength(48);
    expect(bank.questionCount).toBe(12);
    expect(bank.isDemo).toBe(true);
    expect(new Set(bank.questions.map((question) => question.questionType)).size).toBe(5);
  });

  it.each([
    ['points', 0],
    ['points', Number.NaN],
    ['points', Number.POSITIVE_INFINITY],
    ['difficulty', 5],
    ['explanationSteps', []],
    ['sourceRefs', []],
    ['acceptedAnswers', []],
    ['hint', '   '],
    ['estimatedSeconds', 0],
    ['questionType', 'javascript'],
  ])('rejects invalid %s', (field, value) => {
    const bank = freshBank();
    Object.assign(bank.questions[0], { [String(field)]: value });
    expect(() => parseQuestionBank(bank)).toThrow(/Invalid question bank/);
  });

  it('rejects unknown version and unexpected properties instead of silently dropping them', () => {
    expect(() => parseQuestionBank({ ...freshBank(), schemaVersion: '2.0' })).toThrow();
    expect(() => parseQuestionBank({ ...freshBank(), privateKey: 'not-allowed' })).toThrow();
  });

  it.each([
    ['skillIds', ['unknown'], 'unknown skill'],
    ['sourceRefs', ['missing_page'], 'unknown source'],
    ['correctAnswer', '20', 'correctAnswer'],
    ['acceptedAnswers', ['19', '20'], 'disagree'],
    ['acceptedAnswers', ['19', 'NaN'], 'finite numbers'],
    ['acceptedAnswers', ['19', '1 9'], 'finite numbers'],
    ['subject', 'svt', 'subject differs'],
  ])('rejects invalid semantic relation in %s', (field, value, message) => {
    const bank = freshBank();
    Object.assign(bank.questions[0], { [String(field)]: value });
    expect(() => parseQuestionBank(bank)).toThrow(String(message));
  });

  it('detects duplicates despite spacing and multiplication symbol variants', () => {
    const bank = freshBank();
    bank.questions[1].question = '  Berechne: 7+3 · 4  ';
    expect(() => parseQuestionBank(bank)).toThrow(/duplicate/);
  });

  it('rejects repeated question IDs', () => {
    const bank = freshBank();
    bank.questions[1].id = bank.questions[0].id;
    expect(() => parseQuestionBank(bank)).toThrow(/duplicate/);
  });

  it('rejects repeated skill IDs', () => {
    const bank = freshBank();
    bank.skills.push({ ...bank.skills[0] });
    expect(() => parseQuestionBank(bank)).toThrow(/duplicate/);
  });

  it('rejects an exam longer than its question pool', () => {
    const bank = freshBank();
    bank.questionCount = bank.questions.length + 1;
    expect(() => parseQuestionBank(bank)).toThrow(/pool size/);
  });

  it('keeps fixture provenance visible', () => {
    const bank = freshBank();
    bank.isDemo = false;
    expect(() => parseQuestionBank(bank)).toThrow(/isDemo/);
  });

  it('requires exactly one correct multiple-choice ID', () => {
    const bank = freshBank();
    const question = bank.questions.find(
      (question) => question.questionType === 'multiple_choice',
    )!;
    question.acceptedAnswers = ['a', 'b'];
    expect(() => parseQuestionBank(bank)).toThrow(/one correct choice ID/);
  });

  it('requires multiple-choice options and rejects them on numeric questions', () => {
    const bank = freshBank();
    const question = bank.questions.find(
      (question) => question.questionType === 'multiple_choice',
    )!;
    const options = question.choices;
    delete question.choices;
    expect(() => parseQuestionBank(bank)).toThrow();
    const second = freshBank();
    second.questions[0].choices = options;
    expect(() => parseQuestionBank(second)).toThrow();
  });

  it('accepts numerically identical decimal answer variants', () => {
    const bank = freshBank();
    bank.questions[0].acceptedAnswers = ['19', '19,0', '19.00'];
    expect(() => parseQuestionBank(bank)).not.toThrow();
  });

  it('does not merge distinct numeric answers through floating point rounding', () => {
    const bank = freshBank();
    bank.questions[0].correctAnswer = '9007199254740992';
    bank.questions[0].acceptedAnswers = ['9007199254740992', '9007199254740993'];
    expect(() => parseQuestionBank(bank)).toThrow(/disagree/);
  });
});

describe('Local profiles', () => {
  it('provides Max, Lutz and Ben with valid profile contracts', () => {
    const validate = new Ajv().compile(profileSchema);
    expect(profiles.map((profile) => profile.id)).toEqual(['max', 'lutz', 'ben']);
    for (const profile of profiles) {
      expect(validate(profile)).toBe(true);
      expect(parseStudentProfile(profile)).toEqual(profile);
    }
  });

  it.each([
    { ...profiles[0], name: '   ' },
    { ...profiles[0], subjects: ['maths', 'maths'] },
    { ...profiles[0], id: '../../oops' },
    { ...profiles[0], preferredLanguage: 'German' },
    { ...profiles[0], extra: 'unsupported' },
  ])('rejects malformed profiles before persistence', (profile) => {
    expect(() => parseStudentProfile(profile)).toThrow(/Invalid student profile/);
  });
});

describe('Phase 2 additive content contracts', () => {
  it('continues to accept the exact Phase 1 package without modifying its snapshot', () => {
    const source = structuredClone(legacyFixture);
    const before = JSON.stringify(source);
    expect(parseQuestionBank(source).version).toBe(1);
    expect(JSON.stringify(source)).toBe(before);
    expect(source.questions).toHaveLength(20);
  });

  it('has enough varied questions in all six skill groups', () => {
    const bank = parseQuestionBank(freshBank());
    expect(bank.version).toBe(2);
    expect(bank.skills.map((skill) => skill.id)).toEqual([
      'math.order_operations',
      'math.parentheses',
      'math.powers',
      'math.distributivity',
      'math.factorization',
      'math.word_problems',
    ]);
    for (const skill of bank.skills) {
      const questions = bank.questions.filter((question) => question.skillIds.includes(skill.id));
      expect(questions.length).toBeGreaterThanOrEqual(5);
      expect(new Set(questions.map((question) => question.difficulty))).toEqual(
        new Set([1, 2, 3, 4]),
      );
      expect(skill.subject).toBe(bank.subject);
    }
  });

  it('rejects a skill explicitly assigned to a different subject', () => {
    const bank = freshBank();
    bank.skills[0].subject = 'english';
    expect(() => parseQuestionBank(bank)).toThrow(/skill subject differs/);
  });

  it('preserves the original twenty questions except their deliberate skill aliases', () => {
    const bank = parseQuestionBank(freshBank());
    for (const original of legacyFixture.questions) {
      const current = bank.questions.find((question) => question.id === original.id)!;
      expect(current).toEqual({
        ...original,
        skillIds: original.skillIds.map((id) => canonicalFixtureSkillId(bank.id, id)),
      });
    }
  });

  it('scopes aliases to the demo without touching imported package skill IDs', () => {
    expect(canonicalFixtureSkillId('lutz-maths-demo', 'nested_parentheses')).toBe(
      'math.parentheses',
    );
    expect(canonicalFixtureSkillId('external-package', 'powers')).toBe('powers');
    expect(canonicalFixtureSkillId('lutz-maths-demo', 'math.powers')).toBe('math.powers');
    expect(canonicalFixtureSkillId('lutz-maths-demo', 'constructor')).toBe('constructor');
    expect(Object.isFrozen(FIXTURE_SKILL_ALIASES)).toBe(true);
  });
});
