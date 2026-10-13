import { useEffect, useState } from 'react';
import type { StudentProfile } from '@shared/types';
import type { ContentPackage } from '@shared/content';
import { fetchCatalog, sameGrade } from '../services/contentClient';

/** Online discovery only; installation always requires the learner's button. */
export function useCatalogAvailability(
  profile: StudentProfile | null,
  installed: ContentPackage[],
) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!profile) return;
    let request: AbortController | undefined;
    const check = async () => {
      if (!navigator.onLine) return;
      request?.abort();
      const current = new AbortController();
      request = current;
      try {
        const catalog = await fetchCatalog(current.signal);
        if (current.signal.aborted) return;
        setCount(
          catalog.packages.filter(
            (entry) =>
              entry.studentIds.includes(profile.id) &&
              profile.subjects.includes(entry.subject) &&
              sameGrade(entry.grade, profile.grade) &&
              !installed.some((pkg) => pkg.id === entry.id && pkg.version >= entry.version),
          ).length,
        );
      } catch {
        /* Discovery failure never blocks a local learning round. Content view has explicit retry/errors. */
      }
    };
    void check();
    window.addEventListener('online', check);
    return () => {
      request?.abort();
      window.removeEventListener('online', check);
    };
  }, [profile, installed]);
  return count;
}
