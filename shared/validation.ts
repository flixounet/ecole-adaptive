import Ajv from 'ajv';
import bankSchema from './schemas/question-bank.schema.json';
import profileSchema from './schemas/student-profile.schema.json';
import type { QuestionBank, StudentProfile } from './types';

const ajv = new Ajv({ allErrors: true, strict: true });
const validateShape = ajv.compile<QuestionBank>(bankSchema);
const validateProfileShape = ajv.compile<StudentProfile>(profileSchema);

export function parseStudentProfile(input: unknown): StudentProfile {
  if (!validateProfileShape(input)) {
    const details = (validateProfileShape.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid value'}`)
      .join('; ');
    throw new Error(`Invalid student profile: ${details}`);
  }
  return input;
}

/** Only textual normalization here; answer evaluation belongs to the engine. */
function normalized(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/gu, '')
    .replace(/[−–]/gu, '-')
    .replace(/[×·]/gu, '*')
    .replace(/,/gu, '.');
}

function checkUnique(values: string[], label: string, errors: string[]): void {
  if (new Set(values).size !== values.length) errors.push(`${label}: duplicate entries`);
}

function canonicalDecimal(value: string): string {
  const negative = value.startsWith('-');
  const unsigned = value.replace(/^[+-]/u, '');
  const [whole, fraction = ''] = unsigned.split('.');
  const integer = whole.replace(/^0+/u, '') || '0';
  const tail = fraction.replace(/0+$/u, '');
  const magnitude = tail ? `${integer}.${tail}` : integer;
  return negative && magnitude !== '0' ? `-${magnitude}` : magnitude;
}

/** Validate before saving/importing a package. Reject rather than repair bad data. */
export function parseQuestionBank(input: unknown): QuestionBank {
  if (!validateShape(input)) {
    const details = (validateShape.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid value'}`)
      .join('; ');
    throw new Error(`Invalid question bank: ${details}`);
  }
  const bank = input;
  const errors: string[] = [];
  const skillIds = new Set(bank.skills.map((skill) => skill.id));
  const sourceIds = new Set(bank.sourceRefs.map((source) => source.id));
  checkUnique(
    bank.skills.map((skill) => skill.id),
    'skills',
    errors,
  );
  checkUnique(
    bank.sourceRefs.map((source) => source.id),
    'sourceRefs',
    errors,
  );
  checkUnique(
    bank.questions.map((question) => question.id),
    'questions.id',
    errors,
  );
  checkUnique(
    bank.questions.map((question) => normalized(question.question)),
    'questions.question',
    errors,
  );
  if (bank.questionCount > bank.questions.length)
    errors.push('questionCount exceeds question pool size');
  if (!bank.isDemo && bank.sourceRefs.some((source) => source.kind === 'fixture')) {
    errors.push('A package containing fixture sources must be marked isDemo');
  }

  for (const skill of bank.skills) {
    if (skill.subject !== undefined && skill.subject !== bank.subject) {
      errors.push(`${skill.id}: skill subject differs from bank`);
    }
  }

  for (const question of bank.questions) {
    const label = question.id;
    if (question.subject !== bank.subject) errors.push(`${label}: subject differs from bank`);
    for (const id of question.skillIds) {
      if (!skillIds.has(id)) errors.push(`${label}: unknown skill ${id}`);
    }
    for (const id of question.sourceRefs) {
      if (!sourceIds.has(id)) errors.push(`${label}: unknown source ${id}`);
    }
    const correct = normalized(question.correctAnswer);
    if (!question.acceptedAnswers.includes(question.correctAnswer)) {
      errors.push(`${label}: correctAnswer is missing from acceptedAnswers`);
    }
    if (
      question.questionType === 'expression' &&
      [...question.acceptedAnswers, question.correctAnswer].some((answer) =>
        /\d\s+\d/u.test(answer),
      )
    ) {
      errors.push(`${label}: expression answers must not separate digits with whitespace`);
    }
    if (question.questionType === 'numeric' || question.questionType === 'decimal') {
      const rawValues = [...question.acceptedAnswers, question.correctAnswer];
      const values = rawValues.map(normalized);
      const numberPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u;
      if (
        rawValues.some((answer) => /\s/u.test(answer.trim())) ||
        values.some((answer) => !numberPattern.test(answer) || !Number.isFinite(Number(answer)))
      ) {
        errors.push(`${label}: numeric acceptedAnswers must contain finite numbers`);
      } else if (values.some((answer) => canonicalDecimal(answer) !== canonicalDecimal(correct))) {
        errors.push(`${label}: numeric acceptedAnswers disagree with correctAnswer`);
      }
    }
    if (question.questionType === 'multiple_choice') {
      const choices = question.choices!;
      const ids = choices.map((choice) => choice.id);
      checkUnique(ids.map(normalized), `${label}.choices.id`, errors);
      checkUnique(
        choices.map((choice) => normalized(choice.text)),
        `${label}.choices.text`,
        errors,
      );
      if (
        !ids.includes(question.correctAnswer) ||
        question.acceptedAnswers.some((answer) => answer !== question.correctAnswer)
      ) {
        errors.push(`${label}: multiple-choice answers must use exactly one correct choice ID`);
      }
    }
  }
  if (errors.length) throw new Error(`Invalid question bank: ${errors.join('; ')}`);
  return bank;
}
