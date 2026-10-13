import { expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { ContentPackage, CatalogEntry } from '../shared/content';
import type { Question } from '../shared/types';
import type { Session, Result } from '../apps/student/src/domain/session';
import type { StudentSkillState } from '../apps/student/src/domain/adaptive/types';

function canonicalFixture(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalFixture).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalFixture((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('Invalid test fixture JSON');
  return json;
}
export async function makePackage(studentId: 'max' | 'lutz' | 'ben') {
  const bank = JSON.parse(
    readFileSync(new URL('../shared/fixtures/lutz-maths-demo.json', import.meta.url), 'utf8'),
  );
  Object.assign(bank, {
    id: `e2e-${studentId}-maths`,
    version: 1,
    studentIds: [studentId],
    grade: { max: '3eme', lutz: '5eme', ben: 'CM1' }[studentId],
    title: `DEMO E2E Mathematik ${studentId}`,
    questionCount: 3,
    durationMinutes: 30,
  });
  const pkg: ContentPackage = {
    packageVersion: 1,
    id: bank.id,
    version: bank.version,
    contentHash: '',
    createdAt: '2026-10-10T12:00:00Z',
    studentIds: bank.studentIds,
    subject: bank.subject,
    grade: bank.grade,
    chapter: bank.chapter,
    title: bank.title,
    modes: ['learn', 'exam'],
    questionBank: bank,
    tests: [
      {
        id: 'exam-3',
        title: 'Drei Testaufgaben',
        mode: 'exam',
        durationMinutes: 30,
        questionIds: bank.questions.slice(0, 3).map((q: Question) => q.id),
      },
    ],
  };
  const hashInput = { ...pkg } as Partial<ContentPackage>;
  delete hashInput.contentHash;
  pkg.contentHash = createHash('sha256').update(canonicalFixture(hashInput)).digest('hex');
  return pkg;
}
function entry(pkg: ContentPackage): CatalogEntry {
  return {
    id: pkg.id,
    version: pkg.version,
    contentHash: pkg.contentHash,
    createdAt: pkg.createdAt,
    studentIds: pkg.studentIds,
    subject: pkg.subject,
    grade: pkg.grade,
    chapter: pkg.chapter,
    title: pkg.title,
    modes: pkg.modes,
    url: `packages/${pkg.id}-v${pkg.version}.json`,
  };
}
export async function routePackages(
  context: BrowserContext,
  packages: ContentPackage[],
  baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4180/',
) {
  const response = await context.request.post(new URL('__e2e/packages', baseURL).href, {
    data: {
      catalog: {
        catalogVersion: 1,
        updatedAt: '2026-10-10T12:00:00Z',
        packages: packages.map(entry),
      },
      packages: Object.fromEntries(packages.map((pkg) => [entry(pkg).url, pkg])),
    },
  });
  if (!response.ok()) throw new Error('Isolated Student E2E server is unavailable');
  const { token } = (await response.json()) as { token: string };
  // Real network responses work with WebKit service workers; route interception does not.
  // Headers are intentional: production content fetches omit cookies/credentials.
  await context.setExtraHTTPHeaders({ 'X-Ecole-Test': token });
}
export async function selectProfile(page: Page, name: string) {
  await page
    .locator('.profile-card')
    .filter({ has: page.locator('.profile-name', { hasText: new RegExp(`^${name}$`) }) })
    .click();
  await expect(page.getByRole('heading', { name: new RegExp(`Hallo ${name}`) })).toBeVisible();
}
export async function installPackage(page: Page, pkg: ContentPackage) {
  await page.getByRole('button', { name: 'Neue Inhalte', exact: true }).click();
  const card = page
    .locator('article.package-card')
    .filter({ has: page.getByRole('heading', { name: pkg.title, exact: true }) });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Herunterladen', exact: true }).click();
  await expect(card.getByText('✓ Offline verfügbar', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Meine Fächer', exact: true }).click();
}
export async function startPackage(page: Page, pkg: ContentPackage, mode: 'learn' | 'exam') {
  const card = page
    .locator('article.chapter-card')
    .filter({ has: page.getByRole('heading', { name: pkg.title, exact: true }) });
  await card
    .getByRole('button', {
      name: mode === 'learn' ? 'Lernen' : 'Klassenarbeit starten',
      exact: true,
    })
    .click();
  await expect(page.locator('.session-page')).toBeVisible();
  await expect(page.getByText('Lokal gespeichert', { exact: true })).toBeVisible();
}
export async function readStore<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    async (storeName) =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open('ecole-adaptive-v1');
        request.onerror = () => reject(new Error('IndexedDB could not be opened'));
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(storeName, 'readonly');
          const read = transaction.objectStore(storeName).getAll();
          read.onsuccess = () => resolve(read.result);
          read.onerror = () => reject(read.error);
          transaction.oncomplete = () => database.close();
        };
      }),
    store,
  ) as Promise<T[]>;
}
export async function activeSession(page: Page): Promise<Session> {
  const sessions = await readStore<Session>(page, 'sessions');
  const session = sessions.find((item) => item.status === 'active');
  if (!session) throw new Error('Expected an active session');
  return session;
}
export async function answerCurrent(page: Page, correct = true) {
  const session = await activeSession(page);
  const question = session.bankSnapshot.questions.find(
    (q) => q.id === session.questionIds[session.currentIndex],
  )!;
  if (question.questionType === 'multiple_choice') {
    const choice = correct
      ? question.correctAnswer
      : question.choices!.find((item) => item.id !== question.correctAnswer)!.id;
    await page.locator(`input[type="radio"][value="${choice}"]`).check();
  } else {
    await page
      .getByLabel('Deine Antwort', { exact: true })
      .fill(correct ? question.correctAnswer : '999999');
  }
  await expect(page.getByText('Lokal gespeichert', { exact: true })).toBeVisible();
  if (session.mode !== 'exam') {
    await page.getByRole('button', { name: 'Antwort prüfen', exact: true }).click();
    await expect(page.getByText('Lokal gespeichert', { exact: true })).toBeVisible();
  }
  return question;
}
export async function finish(page: Page) {
  await page
    .getByRole('button', {
      name: /^(Lernrunde beenden|Klassenarbeit abgeben|Arbeit abgeben|Runde beenden|Abgeben)$/,
    })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Jetzt abgeben', exact: true })
    .click();
  await expect(page.locator('.result-page')).toBeVisible();
}
export async function waitForOfflineShell(page: Page) {
  await expect(page.getByText('· App offline bereit', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}
export type { Session, Result, StudentSkillState };
