import type { StudentProfile } from './types';
import { parseStudentProfile } from './validation';

export interface ManagedStudentProfile extends StudentProfile {
  createdAt: string;
  archived: boolean;
}
export const defaultSubjects = ['maths', 'english', 'french', 'svt', 'history_geography'];
const defaults: Record<string, { name: string; grade: string }> = {
  max: { name: 'Max', grade: '3eme' },
  lutz: { name: 'Lutz', grade: '5eme' },
  ben: { name: 'Ben', grade: 'CM1' },
};
/** Migration touches only absent metadata and the original unconfigured fixture grade. */
export function upgradeProfile(
  profile: StudentProfile,
  now = new Date().toISOString(),
): ManagedStudentProfile {
  parseStudentProfile(profile);
  const original = defaults[profile.id];
  return parseManagedProfile({
    ...profile,
    ...(original && profile.name === original.name && profile.grade === 'Noch nicht festgelegt'
      ? { grade: original.grade }
      : {}),
    createdAt: profile.createdAt ?? now,
    archived: profile.archived ?? false,
  });
}
export function parseManagedProfile(input: unknown): ManagedStudentProfile {
  const profile = parseStudentProfile(input);
  if (
    !profile.createdAt ||
    !Number.isFinite(Date.parse(profile.createdAt)) ||
    typeof profile.archived !== 'boolean' ||
    (profile.updatedAt !== undefined && !Number.isFinite(Date.parse(profile.updatedAt)))
  )
    throw new Error('Ungültige Profilmetadaten.');
  return profile as ManagedStudentProfile;
}
export function profileSlug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 80) || 'profil'
  );
}
