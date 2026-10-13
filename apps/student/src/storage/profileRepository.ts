import type { StudentProfile } from '@shared/types';
import { parseStudentProfile } from '@shared/validation';
import {
  defaultSubjects,
  parseManagedProfile,
  profileSlug,
  upgradeProfile,
  type ManagedStudentProfile,
} from '@shared/profiles';
import { db, LearningDatabase } from './database';

export interface NewProfile {
  name: string;
  grade: string;
  preferredLanguage?: string;
  subjects?: string[];
}
export async function createProfile(
  input: NewProfile,
  database: LearningDatabase = db,
): Promise<ManagedStudentProfile> {
  return database.transaction('rw', database.profiles, async () => {
    const stem = profileSlug(input.name);
    let id = stem;
    let suffix = 2;
    while (await database.profiles.get(id)) id = `${stem}-${suffix++}`;
    const profile = parseManagedProfile({
      id,
      name: input.name.trim(),
      grade: input.grade.trim(),
      preferredLanguage: input.preferredLanguage ?? 'de',
      subjects: input.subjects ?? [...defaultSubjects],
      createdAt: new Date().toISOString(),
      archived: false,
    });
    await database.profiles.add(profile);
    return profile;
  });
}
export async function saveProfile(
  value: StudentProfile,
  database: LearningDatabase = db,
): Promise<ManagedStudentProfile> {
  const input = parseStudentProfile(structuredClone(value));
  return database.transaction('rw', database.profiles, async () => {
    const existing = await database.profiles.get(input.id);
    if (!existing)
      throw new Error('Profil nicht gefunden. Neue Profile bitte über Anlegen erstellen.');
    const profile = upgradeProfile({
      ...input,
      createdAt: existing.createdAt,
      archived: existing.archived ?? false,
      updatedAt: new Date().toISOString(),
    });
    await database.profiles.put(profile);
    return profile;
  });
}
export async function archiveProfile(
  studentId: string,
  archived = true,
  database: LearningDatabase = db,
): Promise<ManagedStudentProfile> {
  return database.transaction('rw', [database.profiles, database.sessions], async () => {
    const existing = await database.profiles.get(studentId);
    if (!existing) throw new Error('Profil nicht gefunden.');
    if (
      archived &&
      (await database.sessions.where('[studentId+status]').equals([studentId, 'active']).count())
    )
      throw new Error('Bitte die laufende Runde vor dem Archivieren abschließen.');
    const profile = upgradeProfile({ ...existing, archived, updatedAt: new Date().toISOString() });
    await database.profiles.put(profile);
    return profile;
  });
}
