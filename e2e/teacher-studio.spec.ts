import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ContentPackage } from '../shared/content';
import {
  answerCurrent,
  finish,
  installPackage,
  routePackages,
  selectProfile,
  startPackage,
  waitForOfflineShell,
} from './helpers';

test.use({ actionTimeout: 15_000 });
const teacher = 'http://127.0.0.1:8137';
const fixture = (name: string) => resolve('tests/fixtures', name);

test('Teacher JPG/PDF review publishes a real package that Max completes and shares offline', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(teacher);
  await expect(page.getByRole('heading', { name: 'Unterricht vorbereiten' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Schüler', exact: true }).selectOption('max');
  await page.getByLabel('Aufgaben pro Runde / Prüfung').fill('3');
  await page.getByRole('button', { name: 'Vorbereitung anlegen' }).click();
  await page
    .getByLabel('Dateien hinzufügen')
    .setInputFiles([
      fixture('teacher-demo-1.jpg'),
      fixture('teacher-demo-2.jpg'),
      fixture('teacher-demo.pdf'),
    ]);
  await expect(page.locator('.file-list li')).toHaveCount(3);
  await page.getByRole('button', { name: 'Unterlagen analysieren' }).click();
  await expect(page.getByRole('heading', { name: 'Das steckt in den Unterlagen' })).toBeVisible();
  await page
    .getByLabel('Lernziele 1', { exact: true })
    .fill('Bekannte Rechenregeln aus den DEMO-Unterlagen sicher anwenden.');
  await page.getByRole('button', { name: 'Korrekturen speichern' }).click();
  await page.getByRole('button', { name: 'Analyse bestätigen' }).click();
  await page
    .getByLabel('Lernziele 1', { exact: true })
    .fill('Geprüfte Rechenregeln aus den DEMO-Unterlagen anwenden.');
  await page.getByRole('button', { name: 'Aufgabenpool erzeugen', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Quellenkorrekturen zuerst speichern');
  await page.getByRole('button', { name: 'Korrekturen speichern' }).click();
  await page.getByRole('button', { name: 'Analyse bestätigen' }).click();
  await page.getByRole('button', { name: 'Aufgabenpool erzeugen', exact: true }).click();
  await expect(page.getByRole('heading', { name: '48 Aufgaben erstellt' })).toBeVisible();
  await page
    .locator('.question-list > li')
    .first()
    .getByRole('button', { name: 'Bearbeiten', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel('Erster Hinweis', { exact: true })
    .fill('Lies zuerst die bekannte Rechenregel aus deinem Unterricht.');
  await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Für Schüler veröffentlichen' })).toBeDisabled();
  await page.getByRole('button', { name: 'Aufgaben erneut validieren' }).click();
  await page.getByRole('combobox', { name: 'Dauer', exact: true }).selectOption('30');
  await page.getByRole('button', { name: 'Prüfungsplan speichern' }).click();
  await page
    .getByLabel('Ich habe Quellen, Aufgaben und Hinweise geprüft', { exact: false })
    .check();
  await page.getByRole('button', { name: 'Aufgaben freigeben' }).click();
  const publishedResponse = page.waitForResponse(
    (response) => response.url().endsWith('/publish') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Für Schüler veröffentlichen' }).click();
  const publication = await (await publishedResponse).json();
  await expect(page.getByRole('heading', { name: '✓ Lokal veröffentlicht' })).toBeVisible();
  const pkg = JSON.parse(
    await readFile(publication.published.packagePath, 'utf8'),
  ) as ContentPackage;
  expect(pkg.studentIds).toEqual(['max']);
  expect(pkg.tests[0].durationMinutes).toBe(30);
  expect(pkg.tests[0].questionIds).toHaveLength(3);
  await routePackages(context, [pkg]);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }),
  );
  await page.goto('/');
  await selectProfile(page, 'Max');
  await installPackage(page, pkg);
  await waitForOfflineShell(page);
  await context.setOffline(true);
  await startPackage(page, pkg, 'exam');
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: new RegExp(`^Aufgabe ${index + 1},`) }).click();
    await answerCurrent(page);
  }
  await finish(page);
  await expect(page.locator('.score-main strong')).toHaveText(/20(?:,0)?/);
  await page.getByRole('button', { name: 'Ergebnis teilen', exact: true }).click();
  await expect(page.getByLabel('Dein Ergebnis als Text')).toHaveValue(
    /Max – Mathematik[\s\S]*20,0 \/ 20/,
  );
  expect(errors).toEqual([]);
});

test('Teacher rejects an invalid upload batch without silently accepting partial files', async ({
  page,
}) => {
  await page.goto(teacher);
  await page.getByRole('button', { name: 'Vorbereitung anlegen' }).click();
  await page
    .getByLabel('Dateien hinzufügen')
    .setInputFiles([
      { name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') },
    ]);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.file-list li')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Unterlagen analysieren' })).toBeDisabled();
});
