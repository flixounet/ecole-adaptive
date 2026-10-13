import type { StudentProfile } from '@shared/types';
import { canonicalFixtureSkillId } from '@shared/fixture-migrations';
import type { Result } from './session';
import { getResultRecommendations } from './adaptive/recommendations';
import { modeLabel, subjectLabel } from '../components/format';

export function resultShareText(result: Result, profile: StudentProfile): string {
  if (result.studentId !== profile.id)
    throw new Error('Dieses Ergebnis gehört zu einem anderen Profil.');
  const decimal = (value: number) => value.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  const score = result.score20.toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const lines = [
    `${profile.name} – ${subjectLabel(result.bankSnapshot.subject)}`,
    result.bankSnapshot.title,
    `${modeLabel(result.mode)} · ${new Date(result.date).toLocaleDateString('de-DE')}`,
    '',
    `${decimal(result.earnedPoints)} / ${decimal(result.maxPoints)} Punkte`,
    `${score} / 20`,
    `${decimal(result.percentage)} %`,
    '',
  ];
  for (const skill of result.bankSnapshot.skills) {
    const stats = result.skillPerformance?.[canonicalFixtureSkillId(result.testId, skill.id)];
    if (stats && stats.possible > 0)
      lines.push(`${skill.name}: ${decimal(stats.earned)}/${decimal(stats.possible)} Punkte`);
  }
  const weak = getResultRecommendations(result).filter(
    (item) => item.priority === 'high' || item.priority === 'medium',
  );
  if (weak.length) lines.push('', 'Zu üben:', ...weak.map((item) => `- ${item.name}`));
  if (result.bankSnapshot.isDemo) lines.push('', 'DEMO – künstliche Übungsaufgaben');
  return lines.join('\n');
}
