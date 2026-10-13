import Dexie, { type Table } from 'dexie';
import {
  parseContentPackage,
  verifyContentHash,
  validateBlueprint,
  canonicalJson,
  type ContentPackage,
} from '@shared/content';
import { upgradeProfile, defaultSubjects, type ManagedStudentProfile } from '@shared/profiles';
import type { QuestionBank, StudentProfile } from '@shared/types';
import { parseQuestionBank, parseStudentProfile } from '@shared/validation';
import { canonicalFixtureSkillId } from '@shared/fixture-migrations';
import demoSource from '@shared/fixtures/lutz-maths-demo.json';
import legacyDemoSource from '@shared/fixtures/lutz-maths-demo-v1.json';
import profileSource from '@shared/fixtures/profiles.json';
import { isCorrectAnswer } from '../domain/answers';
import {
  applyQuestionPlan,
  emptyAnswer,
  finishSession,
  protectedQuestionIds,
  resultSkillPerformance,
  type Result,
  type Session,
} from '../domain/session';
import {
  applyAttemptToSkills,
  createSkillState,
  validateSkillState,
  validateAttempt,
  classifyAttempt,
} from '../domain/adaptive/mastery';
import {
  scheduleErrorRecurrence,
  scheduleTrainingProgression,
} from '../domain/adaptive/scheduling';
import type { AttemptInput, AttemptRecord, StudentSkillState } from '../domain/adaptive/types';
import { adaptiveConfig } from '../domain/adaptive/config';

export interface InstalledPackage {
  studentId: string;
  packageId: string;
  installedAt: string;
  package: ContentPackage;
}

export interface QuestionHistory {
  id: string;
  studentId: string;
  subject: string;
  questionId: string;
  bankId: string;
  sessionId: string;
  mode: Session['mode'];
  shownAt: number;
}

const baseStores = {
  profiles: '&id',
  banks: '&id, *studentIds',
  sessions: '&id, studentId, status, [studentId+status], startedAt',
  results: '&id, studentId, date',
};

export class LearningDatabase extends Dexie {
  profiles!: Table<StudentProfile, string>;
  banks!: Table<QuestionBank, string>;
  sessions!: Table<Session, string>;
  results!: Table<Result, string>;
  studentSkillStates!: Table<StudentSkillState, [string, string, string]>;
  attemptRecords!: Table<AttemptRecord, string>;
  questionHistory!: Table<QuestionHistory, string>;
  installedPackages!: Table<InstalledPackage, [string, string]>;

  constructor(name = 'ecole-adaptive-v1') {
    super(name);
    this.version(1).stores(baseStores);
    // Additive migration: original rows and immutable bank snapshots remain untouched.
    this.version(2).stores({
      ...baseStores,
      studentSkillStates: '[studentId+subject+skillId], studentId, [studentId+subject]',
      attemptRecords: '&id, studentId, [studentId+subject], sessionId, timestamp',
      questionHistory: '&id, studentId, [studentId+subject], sessionId, shownAt',
    });
    this.version(3)
      .stores({
        ...baseStores,
        studentSkillStates: '[studentId+subject+skillId], studentId, [studentId+subject]',
        attemptRecords:
          '&id, studentId, [studentId+subject], sessionId, timestamp, [studentId+timestamp], [studentId+subject+timestamp]',
        questionHistory: '&id, studentId, [studentId+subject], sessionId, shownAt',
        installedPackages: '[studentId+packageId], studentId',
      })
      .upgrade(async (transaction) => {
        const now = new Date().toISOString();
        await transaction
          .table('profiles')
          .toCollection()
          .modify((profile) => {
            Object.assign(profile, upgradeProfile(profile, now));
          });
      });
  }
}

export const db = new LearningDatabase();

export function validateSession(value: Session): Session {
  if (!value || typeof value !== 'object') throw new Error('Ungültiger Lernstand.');
  const session = structuredClone(value);
  session.bankSnapshot = parseQuestionBank(session.bankSnapshot);
  const bank = session.bankSnapshot;
  const count = session.targetQuestionCount ?? bank.questionCount;
  if (
    session.packageContentHash !== undefined &&
    !/^[a-f0-9]{64}$/u.test(session.packageContentHash)
  )
    throw new Error('Ungültige Paketprüfsumme in der Sitzung.');
  if (session.blueprintSnapshot) {
    if (!session.packageContentHash)
      throw new Error('Der Prüfungsplan benötigt seine Paketprüfsumme.');
    validateBlueprint(session.blueprintSnapshot, bank);
    if (
      session.mode !== 'exam' ||
      canonicalJson(session.questionIds) !== canonicalJson(session.blueprintSnapshot.questionIds)
    )
      throw new Error('Die feste Prüfung wurde verändert.');
  }
  if (
    typeof session.id !== 'string' ||
    !session.id.trim() ||
    typeof session.studentId !== 'string' ||
    !bank.studentIds.includes(session.studentId) ||
    session.bankId !== bank.id ||
    session.bankVersion !== bank.version ||
    !['learn', 'exam', 'error_training'].includes(session.mode) ||
    !['active', 'completed'].includes(session.status) ||
    !Number.isFinite(session.startedAt) ||
    session.startedAt < 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > bank.questions.length ||
    !Array.isArray(session.questionIds) ||
    session.questionIds.length !== count ||
    new Set(session.questionIds).size !== session.questionIds.length ||
    !Number.isInteger(session.currentIndex) ||
    session.currentIndex < 0 ||
    session.currentIndex >= count ||
    !session.answers ||
    typeof session.answers !== 'object' ||
    Object.keys(session.answers).length !== count
  ) {
    throw new Error('Der gespeicherte Lernstand ist unvollständig oder ungültig.');
  }
  if (
    session.mode === 'exam'
      ? session.deadlineAt !==
        session.startedAt +
          (session.blueprintSnapshot?.durationMinutes ?? bank.durationMinutes) * 60_000
      : session.deadlineAt !== null
  )
    throw new Error('Ungültige Prüfungszeit.');
  if (
    session.status === 'completed' &&
    (typeof session.completedAt !== 'number' ||
      !Number.isFinite(session.completedAt) ||
      session.completedAt < session.startedAt ||
      (session.deadlineAt !== null && session.completedAt > session.deadlineAt))
  )
    throw new Error('Ungültiger Abschlusszeitpunkt.');
  if (session.status === 'active' && session.completedAt !== undefined)
    throw new Error('Eine aktive Sitzung darf keinen Abschlusszeitpunkt haben.');
  if (
    session.masteryBefore &&
    Object.values(session.masteryBefore).some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1,
    )
  )
    throw new Error('Ungültiger Lernstand vor der Runde.');
  const questionMap = new Map(bank.questions.map((question) => [question.id, question]));
  for (const id of session.questionIds) {
    const question = questionMap.get(id);
    const answer = session.answers[id];
    if (
      !question ||
      !answer ||
      typeof answer.value !== 'string' ||
      !Number.isInteger(answer.attempts) ||
      answer.attempts < 0 ||
      answer.attempts > 3 ||
      !Number.isInteger(answer.hintsUsed) ||
      answer.hintsUsed < 0 ||
      answer.hintsUsed > 2 ||
      typeof answer.resolved !== 'boolean' ||
      ![true, false, null].includes(answer.correct) ||
      (answer.correct === true &&
        (!answer.resolved || !isCorrectAnswer(question, answer.value) || answer.attempts === 0)) ||
      (answer.resolved && answer.correct === null) ||
      (answer.resolved && answer.correct === false && answer.attempts !== 3) ||
      (answer.attempts === 0 &&
        (answer.correct !== null || answer.resolved || answer.hintsUsed !== 0)) ||
      (answer.attempts > 0 && answer.correct === null) ||
      (answer.attempts === 3 && !answer.resolved) ||
      (answer.attempts > 0 &&
        answer.hintsUsed !==
          (answer.correct ? answer.attempts - 1 : Math.min(answer.attempts, 2))) ||
      (answer.firstViewedAt != null &&
        (!Number.isFinite(answer.firstViewedAt) || answer.firstViewedAt < session.startedAt)) ||
      (answer.lastViewedAt != null &&
        (!Number.isFinite(answer.lastViewedAt) || answer.lastViewedAt < session.startedAt)) ||
      (answer.finalizedAt !== undefined &&
        (!answer.resolved ||
          !Number.isFinite(answer.finalizedAt) ||
          answer.finalizedAt < (answer.firstViewedAt ?? session.startedAt))) ||
      (session.mode === 'exam' &&
        (answer.attempts !== 0 ||
          answer.hintsUsed !== 0 ||
          answer.resolved ||
          answer.correct !== null))
    ) {
      throw new Error('Ungültiger Antwortzustand.');
    }
  }
  return session;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export async function initializeDemo(database: LearningDatabase = db): Promise<void> {
  const profiles = profileSource.map((profile) =>
    upgradeProfile(
      { ...parseStudentProfile(profile), subjects: [...defaultSubjects] },
      '2026-10-10T00:00:00.000Z',
    ),
  );
  const bank = parseQuestionBank(demoSource);
  await database.transaction('rw', [database.profiles, database.banks], async () => {
    for (const profile of profiles)
      if (!(await database.profiles.get(profile.id))) await database.profiles.add(profile);
    const stored = await database.banks.get(bank.id);
    if (!stored) await database.banks.add(bank);
    else if (stored.version < bank.version && stableJson(stored) === stableJson(legacyDemoSource))
      await database.banks.put(bank);
  });
}

export async function listProfiles(
  includeArchived: boolean | LearningDatabase = false,
  database: LearningDatabase = db,
): Promise<ManagedStudentProfile[]> {
  if (includeArchived instanceof LearningDatabase) {
    database = includeArchived;
    includeArchived = false;
  }
  const ordering = ['max', 'lutz', 'ben'];
  return (await database.profiles.toArray())
    .map((profile) => upgradeProfile(profile))
    .filter((profile) => includeArchived || !profile.archived)
    .sort((a, b) => {
      const ai = ordering.indexOf(a.id),
        bi = ordering.indexOf(b.id);
      return (ai < 0 ? 3 : ai) - (bi < 0 ? 3 : bi) || a.name.localeCompare(b.name);
    });
}
export async function listBanks(
  studentId: string,
  database: LearningDatabase = db,
): Promise<QuestionBank[]> {
  const legacy = (await database.banks.where('studentIds').equals(studentId).toArray()).map(
    parseQuestionBank,
  );
  const installed = await database.installedPackages.where('studentId').equals(studentId).toArray();
  const banks = new Map(legacy.map((bank) => [bank.id, bank]));
  for (const row of installed) {
    const pkg = parseContentPackage(row.package);
    if (
      row.packageId !== pkg.id ||
      !pkg.studentIds.includes(studentId) ||
      !(await verifyContentHash(pkg))
    )
      throw new Error('Das installierte Paket ist beschädigt.');
    banks.set(pkg.id, pkg.questionBank);
  }
  return [...banks.values()];
}
export async function hasAnyActiveSession(database: LearningDatabase = db): Promise<boolean> {
  return Boolean(await database.sessions.where('status').equals('active').first());
}
export async function hasActiveExam(database: LearningDatabase = db): Promise<boolean> {
  return Boolean(
    await database.sessions
      .where('status')
      .equals('active')
      .and((session) => session.mode === 'exam')
      .first(),
  );
}
export async function listRecentAttempts(
  studentId: string,
  subject?: string,
  limit = 10,
  database: LearningDatabase = db,
): Promise<AttemptRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Ungültige Anzahl letzter Versuche.');
  const query = subject
    ? database.attemptRecords
        .where('[studentId+subject+timestamp]')
        .between([studentId, subject, Dexie.minKey], [studentId, subject, Dexie.maxKey])
    : database.attemptRecords
        .where('[studentId+timestamp]')
        .between([studentId, Dexie.minKey], [studentId, Dexie.maxKey]);
  const records = await query.reverse().limit(limit).toArray();
  records.forEach(validateStoredAttempt);
  return records;
}
export async function getActiveSession(
  studentId: string,
  database: LearningDatabase = db,
): Promise<Session | undefined> {
  const sessions = await database.sessions
    .where('[studentId+status]')
    .equals([studentId, 'active'])
    .toArray();
  const latest = sessions.sort((a, b) => b.startedAt - a.startedAt)[0];
  return latest ? validateSession(latest) : undefined;
}
export async function listSkillStates(
  studentId: string,
  subject?: string,
  database: LearningDatabase = db,
): Promise<StudentSkillState[]> {
  const states = await (
    subject
      ? database.studentSkillStates.where('[studentId+subject]').equals([studentId, subject])
      : database.studentSkillStates.where('studentId').equals(studentId)
  ).toArray();
  for (const state of states) validateSkillState(state);
  return states;
}
export function validateStoredAttempt(record: AttemptRecord): void {
  validateAttempt(record);
  if (
    record.outcome !== classifyAttempt(record) ||
    !validMasteryMap(record.masteryBefore) ||
    !validMasteryMap(record.masteryAfter)
  )
    throw new Error('Der gespeicherte Aufgabenversuch enthält ungültige Lernstandswerte.');
}
export async function listAttempts(
  studentId: string,
  subject?: string,
  database: LearningDatabase = db,
): Promise<AttemptRecord[]> {
  const records = await (
    subject
      ? database.attemptRecords.where('[studentId+subject]').equals([studentId, subject])
      : database.attemptRecords.where('studentId').equals(studentId)
  ).toArray();
  records.forEach(validateStoredAttempt);
  return records.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));
}
export async function getQuestionHistory(
  studentId: string,
  subject?: string,
  database: LearningDatabase = db,
): Promise<QuestionHistory[]> {
  return (
    await (
      subject
        ? database.questionHistory.where('[studentId+subject]').equals([studentId, subject])
        : database.questionHistory.where('studentId').equals(studentId)
    ).toArray()
  ).sort((a, b) => b.shownAt - a.shownAt || b.id.localeCompare(a.id));
}

export function masterySnapshot(
  bank: QuestionBank,
  studentId: string,
  states: readonly StudentSkillState[],
): Record<string, number> {
  const own = states.filter(
    (state) => state.studentId === studentId && state.subject === bank.subject,
  );
  return Object.fromEntries(
    bank.skills.map((skill) => {
      const id = canonicalFixtureSkillId(bank.id, skill.id);
      return [
        id,
        own.find((state) => state.skillId === id)?.mastery ??
          createSkillState(studentId, bank.subject, id).mastery,
      ];
    }),
  );
}

/** A canonical selection view is derived without mutating source/history snapshots. */
export function adaptiveBankView(bank: QuestionBank): QuestionBank {
  return {
    ...bank,
    skills: bank.skills.map((skill) => ({
      ...skill,
      id: canonicalFixtureSkillId(bank.id, skill.id),
    })),
    questions: bank.questions.map((question) => ({
      ...question,
      skillIds: Array.from(
        new Set(question.skillIds.map((id) => canonicalFixtureSkillId(bank.id, id))),
      ),
    })),
  };
}

function assertSameSession(stored: Session, incoming: Session): void {
  if (
    stored.studentId !== incoming.studentId ||
    stored.bankId !== incoming.bankId ||
    stored.bankVersion !== incoming.bankVersion ||
    stored.startedAt !== incoming.startedAt ||
    stored.mode !== incoming.mode ||
    stableJson(stored.blueprintSnapshot ?? null) !==
      stableJson(incoming.blueprintSnapshot ?? null) ||
    stored.packageContentHash !== incoming.packageContentHash ||
    stableJson(stored.bankSnapshot) !== stableJson(incoming.bankSnapshot)
  )
    throw new Error(
      'Die Sitzung gehört zu einem anderen Lernstand oder ihr Aufgabenpaket wurde verändert.',
    );
}

function mergeStoredPlan(incoming: Session, stored: Session): Session {
  const result = structuredClone(incoming);
  if (stored.masteryBefore) result.masteryBefore = stored.masteryBefore;
  if ((stored.planRevision ?? 0) > (incoming.planRevision ?? 0)) {
    const ids = [...stored.questionIds];
    // Queued edits created before a scheduling save must retain every viewed/edited answer.
    for (const id of protectedQuestionIds(incoming)) {
      if (ids.includes(id)) continue;
      const slot = ids.findIndex(
        (candidate) =>
          !protectedQuestionIds(stored).includes(candidate) &&
          !protectedQuestionIds(incoming).includes(candidate),
      );
      if (slot < 0)
        throw new Error('Die Runde wurde in einem anderen Tab verändert. Bitte neu laden.');
      ids[slot] = id;
    }
    const current = incoming.questionIds[incoming.currentIndex];
    result.questionIds = ids;
    result.currentIndex = Math.max(0, ids.indexOf(current));
    result.answers = Object.fromEntries(
      ids.map((id) => [id, incoming.answers[id] ?? stored.answers[id] ?? emptyAnswer()]),
    );
    result.planRevision = stored.planRevision;
  }
  for (const id of result.questionIds) {
    const previous = stored.answers[id];
    const incomingAnswer = result.answers[id];
    if (!previous) continue;
    // Stale autosaves may never refund an already used retry or undo a final answer.
    if (previous.resolved || previous.attempts > incomingAnswer.attempts)
      result.answers[id] = { ...previous };
    const firstViews = [previous.firstViewedAt, incomingAnswer.firstViewedAt].filter(
      (value): value is number => value != null,
    );
    const lastViews = [previous.lastViewedAt, incomingAnswer.lastViewedAt].filter(
      (value): value is number => value != null,
    );
    if (firstViews.length) result.answers[id].firstViewedAt = Math.min(...firstViews);
    if (lastViews.length) result.answers[id].lastViewedAt = Math.max(...lastViews);
  }
  return result;
}

async function recordPresentations(session: Session, database: LearningDatabase): Promise<void> {
  for (const questionId of session.questionIds) {
    const shownAt =
      session.answers[questionId].lastViewedAt ?? session.answers[questionId].firstViewedAt;
    const id = `${session.id}:${questionId}`;
    if (shownAt == null) continue;
    const previous = await database.questionHistory.get(id);
    if (previous && previous.shownAt >= shownAt) continue;
    await database.questionHistory.put({
      id,
      studentId: session.studentId,
      subject: session.bankSnapshot.subject,
      questionId,
      bankId: session.bankId,
      sessionId: session.id,
      mode: session.mode,
      shownAt,
    });
  }
}

async function recordFinalAttempts(
  session: Session,
  final: boolean,
  now: number,
  database: LearningDatabase,
): Promise<{ session: Session; records: AttemptRecord[] }> {
  const records: AttemptRecord[] = [];
  let states = await listSkillStates(session.studentId, session.bankSnapshot.subject, database);
  let updated = session;
  const chronologicalIds = [...session.questionIds].sort(
    (a, b) => (session.answers[a].finalizedAt ?? now) - (session.answers[b].finalizedAt ?? now),
  );
  for (const questionId of chronologicalIds) {
    const answer = session.answers[questionId];
    if (!final && (session.mode === 'exam' || !answer.resolved)) continue;
    const id = `${session.id}:${questionId}`;
    if (await database.attemptRecords.get(id)) continue;
    if (!updated.masteryBefore)
      updated = {
        ...updated,
        masteryBefore: masterySnapshot(session.bankSnapshot, session.studentId, states),
      };
    const question = session.bankSnapshot.questions.find((item) => item.id === questionId)!;
    const exam = session.mode === 'exam';
    const correct = exam
      ? isCorrectAnswer(question, answer.value)
      : answer.resolved && answer.correct === true;
    const skipped = exam ? !answer.value.trim() : !answer.resolved && answer.attempts === 0;
    const timestamp = exam ? now : Math.min(now, answer.finalizedAt ?? now);
    const input: AttemptInput = {
      id,
      sessionId: session.id,
      studentId: session.studentId,
      subject: session.bankSnapshot.subject,
      questionId,
      testId: session.bankId,
      mode: session.mode,
      timestamp,
      answer: answer.value,
      correct,
      attemptNumber: exam ? (skipped ? 0 : 1) : answer.attempts,
      hintsUsed: answer.hintsUsed,
      skipped,
      difficulty: question.difficulty,
      skillIds: Array.from(
        new Set(
          question.skillIds.map((skillId) => canonicalFixtureSkillId(session.bankId, skillId)),
        ),
      ),
      responseTimeMs:
        answer.firstViewedAt == null ? null : Math.max(0, timestamp - answer.firstViewedAt),
    };
    const applied = applyAttemptToSkills(states, input);
    if (applied.states.length) await database.studentSkillStates.bulkPut(applied.states);
    await database.attemptRecords.add(applied.record);
    const changedIds = new Set(applied.states.map((state) => state.skillId));
    states = [...states.filter((state) => !changedIds.has(state.skillId)), ...applied.states];
    records.push(applied.record);
  }
  return { session: updated, records };
}

function transactionTables(database: LearningDatabase) {
  return [
    database.profiles,
    database.sessions,
    database.results,
    database.studentSkillStates,
    database.attemptRecords,
    database.questionHistory,
    database.installedPackages,
  ];
}

export async function persistSession(
  value: Session,
  database: LearningDatabase = db,
): Promise<Session> {
  let session = validateSession(value);
  return database.transaction('rw', transactionTables(database), async () => {
    if (!(await database.profiles.get(session.studentId)))
      throw new Error('Dieses Profil existiert nicht.');
    const stored = await database.sessions.get(session.id);
    if (stored) assertSameSession(stored, session);
    if ((await database.results.get(session.id)) || stored?.status === 'completed')
      return stored ?? session;
    if (!stored && session.status === 'active') {
      const profile = await database.profiles.get(session.studentId);
      if (profile?.archived) throw new Error('Dieses Profil ist archiviert.');
      const installed = await database.installedPackages.get([session.studentId, session.bankId]);
      if (installed) {
        const pkg = parseContentPackage(installed.package);
        if (canonicalJson(pkg.questionBank) !== canonicalJson(session.bankSnapshot))
          throw new Error(
            'Das Paket wurde zwischenzeitlich aktualisiert. Bitte die Übersicht neu laden.',
          );
        if (session.mode === 'exam') {
          const blueprint = pkg.tests.find((test) => test.id === session.blueprintSnapshot?.id);
          if (
            !pkg.modes.includes('exam') ||
            !blueprint ||
            session.packageContentHash !== pkg.contentHash ||
            canonicalJson(blueprint) !== canonicalJson(session.blueprintSnapshot)
          )
            throw new Error('Für dieses Paket ist ein unveränderlicher Prüfungsplan erforderlich.');
        } else if (session.mode === 'learn' && !pkg.modes.includes('learn'))
          throw new Error('Dieses Paket enthält ausschließlich Klassenarbeiten.');
      } else if (session.packageContentHash || session.blueprintSnapshot)
        throw new Error('Das Prüfungspaket ist nicht installiert.');

      const active = await database.sessions
        .where('[studentId+status]')
        .equals([session.studentId, 'active'])
        .first();
      if (active)
        throw new Error(
          'Für dieses Profil läuft bereits eine Lernrunde oder Klassenarbeit. Öffne die Übersicht und setze sie fort.',
        );
    }
    if (stored) session = mergeStoredPlan(session, stored);
    await recordPresentations(session, database);
    const finalized = await recordFinalAttempts(session, false, Date.now(), database);
    session = finalized.session;
    if (session.adaptive && session.mode !== 'exam' && finalized.records.length) {
      const states = await listSkillStates(
        session.studentId,
        session.bankSnapshot.subject,
        database,
      );
      const attempts = await listAttempts(
        session.studentId,
        session.bankSnapshot.subject,
        database,
      );
      const history = await getQuestionHistory(
        session.studentId,
        session.bankSnapshot.subject,
        database,
      );
      for (const record of finalized.records) {
        const options = {
          questionIds: session.questionIds,
          questionBank: adaptiveBankView(session.bankSnapshot),
          completedQuestionIds: protectedQuestionIds(session),
          skillStates: states,
          recentAttempts: attempts,
          studentId: session.studentId,
          recentQuestionIds: history
            .slice(0, adaptiveConfig.avoidRecentQuestions)
            .map((item) => item.questionId),
          excludeQuestionIds: session.sourceMistakeQuestionIds,
          allowedSkillIds: session.mode === 'error_training' ? session.targetSkillIds : undefined,
        };
        const ids =
          record.outcome === 'INCORRECT'
            ? scheduleErrorRecurrence({
                ...options,
                failedQuestionId: record.questionId,
                failedIndex: session.questionIds.indexOf(record.questionId),
              })
            : session.mode === 'error_training' && record.correct
              ? scheduleTrainingProgression({
                  ...options,
                  questionId: record.questionId,
                  currentIndex: session.questionIds.indexOf(record.questionId),
                })
              : session.questionIds;
        session = applyQuestionPlan(session, ids);
      }
    }
    await database.sessions.put(validateSession(session));
    return session;
  });
}

/** Backward-compatible persistence API. UI uses persistSession to receive adaptive plan changes. */
export async function saveSession(value: Session, database: LearningDatabase = db): Promise<void> {
  await persistSession(value, database);
}

export async function completeSession(
  value: Session,
  now = Date.now(),
  database: LearningDatabase = db,
): Promise<Result> {
  let session = validateSession(value);
  if (!Number.isFinite(now) || now < session.startedAt)
    throw new Error('Ungültiger Abschlusszeitpunkt.');
  return database.transaction('rw', transactionTables(database), async () => {
    const existing = await database.results.get(session.id);
    if (existing) {
      if (existing.studentId !== session.studentId)
        throw new Error('Das Ergebnis gehört zu einem anderen Profil.');
      return normalizeResult(existing);
    }
    if (!(await database.profiles.get(session.studentId)))
      throw new Error('Dieses Profil existiert nicht.');
    const stored = await database.sessions.get(session.id);
    if (stored) {
      assertSameSession(stored, session);
      session = mergeStoredPlan(session, stored);
    }
    const completedAt =
      session.completedAt ??
      (session.deadlineAt === null ? now : Math.min(now, session.deadlineAt));
    const finalized = await recordFinalAttempts(session, true, completedAt, database);
    session = finalized.session;
    const completed: Session = { ...session, status: 'completed', completedAt };
    await recordPresentations(completed, database);
    const result = finishSession(completed, completedAt);
    const after = masterySnapshot(
      session.bankSnapshot,
      session.studentId,
      await listSkillStates(session.studentId, session.bankSnapshot.subject, database),
    );
    result.masteryAfter = after;
    result.skillsAfter = after;
    await database.sessions.put(completed);
    await database.results.add(result);
    return result;
  });
}

function boundedNumber(value: unknown, minimum: number, maximum = Infinity): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function validMasteryMap(value: unknown): value is Record<string, number> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((mastery) => boundedNumber(mastery, 0, 1))
  );
}

function validateResultNumbers(result: Result): void {
  const invalid = () => {
    throw new Error('Das gespeicherte Ergebnis enthält ungültige Werte.');
  };
  if (
    ![result.id, result.studentId, result.testId].every(
      (value) => typeof value === 'string' && value.trim(),
    ) ||
    !['learn', 'exam', 'error_training'].includes(result.mode) ||
    !boundedNumber(result.maxPoints, Number.MIN_VALUE) ||
    !boundedNumber(result.earnedPoints, 0, result.maxPoints) ||
    !boundedNumber(result.score20, 0, 20) ||
    !boundedNumber(result.percentage, 0, 100) ||
    !boundedNumber(result.date, 0) ||
    !boundedNumber(result.duration, 0) ||
    !Array.isArray(result.answers) ||
    result.answers.length === 0 ||
    new Set(result.answers.map((answer) => answer.questionId)).size !== result.answers.length
  )
    invalid();
  const questions = new Map(
    result.bankSnapshot.questions.map((question) => [question.id, question]),
  );
  for (const answer of result.answers) {
    if (
      !answer ||
      !questions.has(answer.questionId) ||
      typeof answer.value !== 'string' ||
      typeof answer.correct !== 'boolean' ||
      !boundedNumber(answer.maxPoints, Number.MIN_VALUE) ||
      !boundedNumber(answer.earnedPoints, 0, answer.maxPoints) ||
      !Number.isInteger(answer.attempts) ||
      !boundedNumber(answer.attempts, 0, 3) ||
      !Number.isInteger(answer.hintsUsed) ||
      !boundedNumber(answer.hintsUsed, 0, 2)
    )
      invalid();
  }
  for (const time of [result.startedAt, result.completedAt, result.durationSeconds]) {
    if (time !== undefined && !boundedNumber(time, 0)) invalid();
  }
  if (
    result.startedAt !== undefined &&
    result.completedAt !== undefined &&
    result.completedAt < result.startedAt
  )
    invalid();
  for (const mastery of [
    result.skillsBefore,
    result.skillsAfter,
    result.masteryBefore,
    result.masteryAfter,
  ]) {
    if (mastery !== undefined && !validMasteryMap(mastery)) invalid();
  }
  if (result.skillPerformance !== undefined) {
    if (
      !result.skillPerformance ||
      typeof result.skillPerformance !== 'object' ||
      Array.isArray(result.skillPerformance)
    )
      invalid();
    for (const performance of Object.values(result.skillPerformance)) {
      if (
        !performance ||
        !boundedNumber(performance.possible, Number.MIN_VALUE) ||
        !boundedNumber(performance.earned, 0, performance.possible) ||
        !boundedNumber(performance.percentage, 0, 100)
      )
        invalid();
    }
  }
  const mistakes = result.mistakeQuestionIds ?? result.mistakes;
  if (!Array.isArray(mistakes) || mistakes.some((id) => !questions.has(id))) invalid();
}

/** Read adapter for Phase-1 results; source records are not rewritten or assigned invented mastery. */
export function normalizeResult(value: Result): Result {
  const result = structuredClone(value);
  const bank = parseQuestionBank(result.bankSnapshot);
  validateResultNumbers(result);
  if (result.packageContentHash !== undefined && !/^[a-f0-9]{64}$/u.test(result.packageContentHash))
    throw new Error('Ungültige Paketprüfsumme im Ergebnis.');
  if (result.blueprintSnapshot) {
    validateBlueprint(result.blueprintSnapshot, bank);
    if (
      result.mode !== 'exam' ||
      !result.packageContentHash ||
      canonicalJson(result.blueprintSnapshot.questionIds) !==
        canonicalJson(result.answers.map((answer) => answer.questionId))
    )
      throw new Error('Der Prüfungsplan passt nicht zum Ergebnis.');
  }
  const mistakes = result.mistakeQuestionIds ?? result.mistakes;
  const normalized = {
    ...result,
    subject: result.subject ?? bank.subject,
    chapter: result.chapter ?? bank.chapter,
    startedAt: result.startedAt ?? result.date - result.duration * 1000,
    completedAt: result.completedAt ?? result.date,
    durationSeconds: result.durationSeconds ?? result.duration,
    skillPerformance: result.skillPerformance ?? resultSkillPerformance(bank, result.answers),
    masteryBefore: result.masteryBefore ?? result.skillsBefore ?? {},
    masteryAfter: result.masteryAfter ?? result.skillsAfter ?? {},
    mistakeQuestionIds: mistakes,
    mistakeSkillIds:
      result.mistakeSkillIds ??
      Array.from(
        new Set(
          mistakes
            .flatMap((id) => bank.questions.find((question) => question.id === id)?.skillIds ?? [])
            .map((id) => canonicalFixtureSkillId(bank.id, id)),
        ),
      ),
  };
  validateResultNumbers(normalized);
  return normalized;
}

export async function listResults(
  studentId: string,
  database: LearningDatabase = db,
): Promise<Result[]> {
  return (await database.results.where('studentId').equals(studentId).toArray())
    .map(normalizeResult)
    .sort((a, b) => b.date - a.date);
}
export async function loadResult(
  id: string,
  studentId: string,
  database: LearningDatabase = db,
): Promise<Result | undefined> {
  const result = await database.results.get(id);
  if (!result || result.studentId !== studentId) return undefined;
  return normalizeResult(result);
}
