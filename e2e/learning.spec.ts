import { test, expect, chromium, webkit } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activeSession,
  answerCurrent,
  finish,
  installPackage,
  makePackage,
  readStore,
  routePackages,
  selectProfile,
  startPackage,
  waitForOfflineShell,
  type Result,
  type StudentSkillState,
} from './helpers';

test('Lutz learns and his mastery changes once after a correct answer', async ({
  page,
  context,
}) => {
  const pkg = await makePackage('lutz');
  await routePackages(context, [pkg]);
  await page.goto('/');
  await selectProfile(page, 'Lutz');
  await installPackage(page, pkg);
  await startPackage(page, pkg, 'learn');
  const question = await answerCurrent(page);
  await expect(page.getByRole('heading', { name: 'Gut gemacht. Das stimmt!' })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await readStore<StudentSkillState>(page, 'studentSkillStates')).find(
          (state) => state.studentId === 'lutz' && state.skillId === question.skillIds[0],
        )?.mastery,
    )
    .toBeGreaterThan(0.5);
  const attempts = await readStore<{ studentId: string; questionId: string }>(
    page,
    'attemptRecords',
  );
  expect(
    attempts.filter((record) => record.questionId === question.id && record.studentId === 'lutz'),
  ).toHaveLength(1);
});

test('Max submits a class exam with /20 score and opens it in history', async ({
  page,
  context,
}) => {
  const pkg = await makePackage('max');
  await routePackages(context, [pkg]);
  await page.goto('/');
  await selectProfile(page, 'Max');
  await installPackage(page, pkg);
  await startPackage(page, pkg, 'exam');
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: new RegExp(`^Aufgabe ${index + 1},`) }).click();
    await answerCurrent(page);
  }
  await finish(page);
  await expect(page.locator('.score-main strong')).toHaveText('20,0');
  await page.getByRole('button', { name: 'Meine Ergebnisse', exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  await page.locator('.history-row').click();
  await expect(page.locator('.score-main strong')).toHaveText('20,0');
  const results = await readStore<Result>(page, 'results');
  expect(results).toHaveLength(1);
  expect(results[0].studentId).toBe('max');
  expect(results[0].score20).toBe(20);
});

test('mistakes lead to new question IDs within the same skill families', async ({
  page,
  context,
}) => {
  const pkg = await makePackage('max');
  await routePackages(context, [pkg]);
  await page.goto('/');
  await selectProfile(page, 'Max');
  await installPackage(page, pkg);
  await startPackage(page, pkg, 'exam');
  await answerCurrent(page, false);
  await finish(page);
  const source = (await readStore<Result>(page, 'results'))[0];
  const wrong = source.answers
    .filter((answer) => !answer.correct)
    .map((answer) => answer.questionId);
  const skills = new Set(
    pkg.questionBank.questions.filter((q) => wrong.includes(q.id)).flatMap((q) => q.skillIds),
  );
  await page.getByRole('button', { name: 'Meine Fehler trainieren', exact: true }).click();
  await expect(page.locator('.session-page')).toBeVisible();
  const training = await activeSession(page);
  expect(training.mode).toBe('error_training');
  expect(training.questionIds.length).toBeGreaterThan(0);
  for (const id of training.questionIds) {
    expect(wrong).not.toContain(id);
    const question = training.bankSnapshot.questions.find((q) => q.id === id)!;
    expect(question.skillIds.some((skill) => skills.has(skill))).toBe(true);
  }
});

test('installed content supports an entire exam and stored result offline', async ({
  page,
  context,
}) => {
  const pkg = await makePackage('max');
  await routePackages(context, [pkg]);
  await page.goto('/');
  await waitForOfflineShell(page);
  await selectProfile(page, 'Max');
  await installPackage(page, pkg);
  await context.setOffline(true);
  await expect(
    page.getByText('Offline – heruntergeladene Inhalte verfügbar', { exact: true }),
  ).toBeVisible();
  await startPackage(page, pkg, 'exam');
  await answerCurrent(page);
  await finish(page);
  const result = (await readStore<Result>(page, 'results'))[0];
  expect(result.studentId).toBe('max');
  expect(result.score20).toBeGreaterThan(0);
  await page.reload();
  await selectProfile(page, 'Max');
  await page.getByRole('button', { name: 'Meine Ergebnisse', exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(1);
  const cacheUrls = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (name) =>
          (await (await caches.open(name)).keys()).map((request) => request.url),
        ),
      )
    ).flat(),
  );
  expect(cacheUrls.some((url) => url.includes('index.html'))).toBe(true);
  expect(cacheUrls.some((url) => url.includes('/content/'))).toBe(false);
});

test('a reload restores answers, navigation and the original absolute deadline', async ({
  page,
  context,
}) => {
  const pkg = await makePackage('max');
  await routePackages(context, [pkg]);
  await page.goto('/');
  await selectProfile(page, 'Max');
  await installPackage(page, pkg);
  await startPackage(page, pkg, 'exam');
  await answerCurrent(page);
  await page.getByRole('button', { name: /^Aufgabe 2,/ }).click();
  const before = await activeSession(page);
  await page.reload();
  await selectProfile(page, 'Max');
  await page.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await expect(page.locator('.session-page')).toBeVisible();
  const after = await activeSession(page);
  expect(after.id).toBe(before.id);
  expect(after.deadlineAt).toBe(before.deadlineAt);
  expect(after.currentIndex).toBe(1);
  expect(after.answers[before.questionIds[0]].value).toBe(
    before.answers[before.questionIds[0]].value,
  );
});

test('Ben sees his own downloads and no results or mastery from Max', async ({ page, context }) => {
  const max = await makePackage('max'),
    ben = await makePackage('ben');
  await routePackages(context, [max, ben]);
  await page.goto('/');
  await selectProfile(page, 'Max');
  await installPackage(page, max);
  await startPackage(page, max, 'exam');
  await answerCurrent(page);
  await finish(page);
  await page.locator('.profile-switch').click();
  await selectProfile(page, 'Ben');
  await page.getByRole('button', { name: 'Meine Ergebnisse', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Deine erste Runde wartet.' })).toBeVisible();
  await page.getByRole('button', { name: 'Neue Inhalte', exact: true }).click();
  await expect(page.getByRole('heading', { name: max.title, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Meine Fächer', exact: true }).click();
  await installPackage(page, ben);
  const states = await readStore<StudentSkillState>(page, 'studentSkillStates');
  expect(states.filter((state) => state.studentId === 'max').length).toBeGreaterThan(0);
  expect(states.filter((state) => state.studentId === 'ben')).toHaveLength(0);
  await startPackage(page, ben, 'exam');
  await answerCurrent(page);
  await finish(page);
  const results = await readStore<Result>(page, 'results');
  expect(results.filter((result) => result.studentId === 'max')).toHaveLength(1);
  expect(results.filter((result) => result.studentId === 'ben')).toHaveLength(1);
});

test('a closed browser restarts offline from app shell and installed IndexedDB content', async ({
  browserName,
  baseURL,
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'ecole-pwa-e2e-'));
  const browserType = browserName === 'webkit' ? webkit : chromium;
  const options = {
    headless: true,
    viewport: { width: 1024, height: 768 },
    serviceWorkers: 'allow' as const,
  };
  let context = await browserType.launchPersistentContext(directory, options);
  try {
    const pkg = await makePackage('max');
    await routePackages(context, [pkg], baseURL);
    let page = await context.newPage();
    await page.goto(baseURL!);
    await waitForOfflineShell(page);
    await selectProfile(page, 'Max');
    await installPackage(page, pkg);
    await startPackage(page, pkg, 'exam');
    await answerCurrent(page);
    const before = await activeSession(page);
    await context.close();
    context = await browserType.launchPersistentContext(directory, { ...options, offline: true });
    page = await context.newPage();
    await page.goto(baseURL!);
    await expect(page.getByRole('heading', { name: 'Wer lernt heute?' })).toBeVisible();
    await selectProfile(page, 'Max');
    await page.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
    const after = await activeSession(page);
    expect(after.id).toBe(before.id);
    expect(after.deadlineAt).toBe(before.deadlineAt);
    expect(after.answers[before.questionIds[0]].value).toBe(
      before.answers[before.questionIds[0]].value,
    );
    await finish(page);
    await expect(page.locator('.score-main strong')).not.toHaveText(/^0(?:,0)?$/);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
