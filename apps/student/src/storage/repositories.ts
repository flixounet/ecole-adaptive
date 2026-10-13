import type { QuestionBank } from '@shared/types';
import { canonicalFixtureSkillId } from '@shared/fixture-migrations';
import {
  createSession,
  emptyAnswer,
  type Result,
  type Session,
  type SessionMode,
} from '../domain/session';
import { selectQuestions } from '../domain/adaptive/selection';
import { createErrorTraining } from '../domain/adaptive/errorTraining';
import { getLearningRecommendations as recommend } from '../domain/adaptive/recommendations';
import type { LearningRecommendation } from '../domain/adaptive/types';
import {
  adaptiveBankView,
  db,
  getQuestionHistory,
  LearningDatabase,
  listAttempts,
  listBanks,
  listSkillStates,
  masterySnapshot,
  persistSession,
} from './database';

export {
  completeSession,
  getActiveSession,
  getQuestionHistory,
  initializeDemo,
  listAttempts,
  listBanks,
  listProfiles,
  listRecentAttempts,
  hasActiveExam,
  hasAnyActiveSession,
  listResults,
  listSkillStates,
  loadResult,
  persistSession,
  saveSession,
} from './database';

/** All selection, initial mastery, and persistence stay behind one repository boundary. */
export async function startAdaptiveSession(
  bank: QuestionBank,
  studentId: string,
  mode: SessionMode,
  now = Date.now(),
  random = Math.random,
  sourceResult?: Result,
  database: LearningDatabase = db,
): Promise<Session> {
  const profile = await database.profiles.get(studentId);
  if (!profile || profile.archived) throw new Error('Das Profil ist nicht verfügbar.');
  const installed = await database.installedPackages.get([studentId, bank.id]);
  if (installed && mode === 'learn' && !installed.package.modes.includes('learn'))
    throw new Error('Dieses Paket enthält ausschließlich Klassenarbeiten.');
  if (installed && mode === 'exam')
    throw new Error('Für dieses Paket bitte einen festen Prüfungsplan wählen.');
  const [skillStates, recentAttempts, history] = await Promise.all([
    listSkillStates(studentId, bank.subject, database),
    listAttempts(studentId, bank.subject, database),
    getQuestionHistory(studentId, bank.subject, database),
  ]);
  const options = {
    studentId,
    questionBank: adaptiveBankView(bank),
    skillStates,
    recentAttempts,
    recentQuestionIds: history.map((item) => item.questionId),
    random,
  };
  const training =
    mode === 'error_training'
      ? sourceResult
        ? createErrorTraining({
            ...options,
            sourceResult: {
              ...sourceResult,
              bankSnapshot: adaptiveBankView(sourceResult.bankSnapshot),
            },
          })
        : null
      : null;
  if (mode === 'error_training' && !training)
    throw new Error('Für Fehlertraining wird ein abgeschlossenes Ergebnis benötigt.');
  const questions =
    training?.questions ??
    selectQuestions({ ...options, mode, desiredQuestionCount: bank.questionCount });
  if (!questions.length) throw new Error('Es gibt keine passenden Aufgaben für diese Runde.');
  const questionIds = questions.map((question) => question.id);
  // IDs are selected above; the original snapshot remains exactly as authored.
  const base = createSession(bank, studentId, mode, now, () => 0);
  const session: Session = {
    ...base,
    questionIds,
    targetQuestionCount: questionIds.length,
    adaptive: true,
    planRevision: 0,
    masteryBefore: masterySnapshot(bank, studentId, skillStates),
    answers: Object.fromEntries(
      questionIds.map((id, index) => [id, emptyAnswer(index === 0 ? now : null)]),
    ),
    ...(training
      ? {
          targetSkillIds: training.targetSkillIds,
          sourceResultId: sourceResult!.id,
          sourceMistakeQuestionIds: training.originalQuestionIds,
        }
      : {}),
  };
  return persistSession(session, database);
}

export async function getLearningRecommendations(
  studentId: string,
  subject?: string,
  database: LearningDatabase = db,
): Promise<LearningRecommendation[]> {
  const [banks, skillStates, recentAttempts] = await Promise.all([
    listBanks(studentId, database),
    listSkillStates(studentId, subject, database),
    listAttempts(studentId, subject, database),
  ]);
  const subjects = new Set(
    banks.filter((bank) => !subject || bank.subject === subject).map((bank) => bank.subject),
  );
  return Array.from(subjects).flatMap((currentSubject) => {
    const skills = Array.from(
      new Map(
        banks
          .filter((bank) => bank.subject === currentSubject)
          .flatMap((bank) =>
            bank.skills.map((skill) => ({
              ...skill,
              id: canonicalFixtureSkillId(bank.id, skill.id),
            })),
          )
          .map((skill) => [skill.id, skill]),
      ).values(),
    );
    return recommend({ studentId, subject: currentSubject, skills, skillStates, recentAttempts });
  });
}

export { createProfile, saveProfile, archiveProfile } from './profileRepository';
export {
  listInstalledPackages,
  installContentPackage,
  startBlueprintSession,
  matchesCatalogEntry,
} from './contentRepository';
export type { InstalledPackage } from './database';
export type { ManagedStudentProfile } from '@shared/profiles';

export { exportBackup, importBackup, parseBackup } from './backupRepository';
export type { BackupDTO } from './backupRepository';
