import { useEffect, useRef, useState } from 'react';
import type { QuestionBank, StudentProfile } from '@shared/types';
import type { ContentPackage } from '@shared/content';
import {
  completeSession,
  getActiveSession,
  initializeDemo,
  listBanks,
  listProfiles,
  listResults,
  persistSession,
  startAdaptiveSession,
  listSkillStates,
  listRecentAttempts,
  listInstalledPackages,
  startBlueprintSession,
} from '../storage/repositories';
import { isExpired, type Result, type Session, type SessionMode } from '../domain/session';
import type { AttemptRecord, StudentSkillState } from '../domain/adaptive/types';

export type Section = 'library' | 'mastery' | 'history' | 'content' | 'settings';
const describeError = (error: unknown) =>
  error instanceof Error ? error.message : 'Ein unerwarteter Fehler ist aufgetreten.';

/** UI coordination only. Scoring, adaptation and transactions live outside React. */
export function useLearningApp() {
  const [profiles, setProfiles] = useState<StudentProfile[]>([]);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [skillStates, setSkillStates] = useState<StudentSkillState[]>([]);
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [savedSession, setSavedSession] = useState<Session | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [packages, setPackages] = useState<ContentPackage[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [section, setSection] = useState<Section>('library');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const finalizing = useRef(false);
  const starting = useRef(false);
  const autoAttempted = useRef<string | null>(null);
  const profileRef = useRef<StudentProfile | null>(null);
  const profileGeneration = useRef(0);

  useEffect(() => {
    let mounted = true;
    initializeDemo()
      .then(() => listProfiles())
      .then((items) => {
        if (mounted) setProfiles(items);
      })
      .catch((e) => {
        if (mounted) setError(describeError(e));
      })
      .finally(() => {
        if (mounted) setBusy(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function refresh(studentId: string, generation = profileGeneration.current) {
    const [available, previous, active, states, recent, installed] = await Promise.all([
      listBanks(studentId),
      listResults(studentId),
      getActiveSession(studentId),
      listSkillStates(studentId),
      Promise.all(
        (profileRef.current?.subjects ?? []).map((subject) =>
          listRecentAttempts(studentId, subject, 10),
        ),
      ).then((groups) => groups.flat()),
      listInstalledPackages(studentId),
    ]);
    if (generation !== profileGeneration.current || profileRef.current?.id !== studentId) return;
    setBanks(available);
    setPackages(installed.map((item) => item.package));
    setResults(previous);
    setSavedSession(active ?? null);
    setSkillStates(states);
    setAttempts(recent);
  }

  async function selectProfile(next: StudentProfile) {
    if (starting.current || sessionRef.current || finalizing.current) return;
    if (
      profileRef.current &&
      profileRef.current.id !== next.id &&
      savedSession?.mode === 'exam' &&
      !window.confirm('Deine Klassenarbeit läuft beim Profilwechsel weiter. Wirklich wechseln?')
    )
      return;
    const generation = ++profileGeneration.current;
    const previousProfile = profileRef.current;
    profileRef.current = next;
    starting.current = true;
    setBusy(true);
    setError('');
    try {
      await refresh(next.id, generation);
      if (generation !== profileGeneration.current) return;
      setProfile(next);
      setResult(null);
      setSection('library');
      setSaving(false);
      setSaveFailed(false);
      autoAttempted.current = null;
    } catch (e) {
      profileRef.current = previousProfile;
      setError(describeError(e));
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }

  function persist(next: Session) {
    sessionRef.current = next;
    setSession(next);
    setSaving(true);
    const operation = writes.current.catch(() => {}).then(() => persistSession(next));
    writes.current = operation;
    operation
      .then((stored) => {
        // A repository transaction may replace unvisited questions after a final answer.
        if (sessionRef.current === next) {
          sessionRef.current = stored;
          setSession(stored);
        }
        if (writes.current === operation) {
          setSaving(false);
          setSaveFailed(false);
          setError('');
        }
      })
      .catch((e) => {
        if (writes.current === operation) setSaving(false);
        setSaveFailed(true);
        setError(
          `Speichern fehlgeschlagen: ${describeError(e)} Deine Eingaben sind noch auf diesem Bildschirm. Bitte erneut speichern.`,
        );
      });
    return operation;
  }

  async function start(bank: QuestionBank, mode: SessionMode, sourceResult?: Result) {
    if (!profile || savedSession || sessionRef.current || starting.current || finalizing.current)
      return;
    starting.current = true;
    setBusy(true);
    setError('');
    try {
      const pkg = packages.find((item) => item.id === bank.id);
      if (pkg && mode !== 'error_training' && !pkg.modes.includes(mode))
        throw new Error('Dieser Modus ist für das Paket nicht freigegeben.');
      const next =
        pkg && mode === 'exam'
          ? await startBlueprintSession(pkg, pkg.tests[0].id, profile.id)
          : await startAdaptiveSession(
              bank,
              profile.id,
              mode,
              Date.now(),
              Math.random,
              sourceResult,
            );
      sessionRef.current = next;
      setSession(next);
      setSavedSession(null);
      setResult(null);
      setSaving(false);
      setSaveFailed(false);
      setNow(Date.now());
      setConfirmSubmit(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }

  async function finish(snapshot?: Session) {
    const requested = sessionRef.current ?? snapshot;
    if (
      !requested ||
      finalizing.current ||
      starting.current ||
      requested.studentId !== profileRef.current?.id
    )
      return;
    const generation = profileGeneration.current;
    finalizing.current = true;
    setBusy(true);
    try {
      await writes.current.catch(() => {});
      const current = sessionRef.current ?? snapshot;
      if (!current) return;
      const stored = await persistSession(current);
      const finished = await completeSession(stored);
      if (generation !== profileGeneration.current || finished.studentId !== profileRef.current?.id)
        return;
      sessionRef.current = null;
      setSession(null);
      setSavedSession(null);
      setResult(finished);
      setConfirmSubmit(false);
      setSaving(false);
      setSaveFailed(false);
      setError('');
      await refresh(finished.studentId);
    } catch (e) {
      setError(`Abgabe nicht gespeichert: ${describeError(e)} Bitte erneut versuchen.`);
    } finally {
      finalizing.current = false;
      setBusy(false);
    }
  }

  // The callback reads the current in-memory answer after all queued writes.
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const monitored = session ?? savedSession;
    if (!monitored || monitored.mode !== 'exam') return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      const active = sessionRef.current ?? monitored;
      if (
        !starting.current &&
        !finalizing.current &&
        active.studentId === profileRef.current?.id &&
        isExpired(active, time) &&
        autoAttempted.current !== active.id
      ) {
        autoAttempted.current = active.id;
        void finishRef.current(active);
      }
    };
    tick();
    const interval = window.setInterval(tick, 500);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [session?.id, savedSession?.id]);

  async function navigate(target: Section) {
    if (!profile || finalizing.current || starting.current) return;
    starting.current = true;
    setBusy(true);
    try {
      await writes.current.catch(() => {});
      if (sessionRef.current) {
        const stored = await persistSession(sessionRef.current);
        setSavedSession(stored);
        sessionRef.current = null;
        setSession(null);
      }
      await refresh(profile.id);
      setResult(null);
      setSection(target);
      setSaving(false);
      setSaveFailed(false);
      setError('');
    } catch (e) {
      setError(describeError(e));
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }
  function resume() {
    if (!savedSession || busy) return;
    if (isExpired(savedSession)) {
      void finish(savedSession);
      return;
    }
    sessionRef.current = savedSession;
    setSession(savedSession);
    setSavedSession(null);
    setResult(null);
    setNow(Date.now());
    setConfirmSubmit(false);
  }
  function switchProfile() {
    if (sessionRef.current || busy || starting.current || finalizing.current) return;
    profileGeneration.current += 1;
    profileRef.current = null;
    setProfile(null);
    setResult(null);
    setSavedSession(null);
    setError('');
    setSkillStates([]);
    setAttempts([]);
    setBanks([]);
    setPackages([]);
    setResults([]);
  }
  function trainErrors(source: Result) {
    if (source.studentId !== profileRef.current?.id) return;
    const bank = banks.find((item) => item.id === source.testId) ?? source.bankSnapshot;
    void start(bank, 'error_training', source);
  }
  async function reloadProfiles() {
    const items = await listProfiles();
    setProfiles(items);
    const selected = profileRef.current;
    if (selected) {
      const updated = items.find((item) => item.id === selected.id);
      if (!updated) {
        switchProfile();
        return;
      }
      profileRef.current = updated;
      setProfile(updated);
      await refresh(updated.id);
    }
  }
  async function refreshCurrent() {
    if (profileRef.current) await refresh(profileRef.current.id);
  }
  return {
    packages,
    reloadProfiles,
    refreshCurrent,
    profiles,
    profile,
    banks,
    results,
    skillStates,
    attempts,
    savedSession,
    session,
    result,
    section,
    busy,
    error,
    saving,
    saveFailed,
    now,
    confirmSubmit,
    setConfirmSubmit,
    selectProfile,
    persist,
    start,
    finish,
    navigate,
    resume,
    switchProfile,
    trainErrors,
    openResult: (item: Result) => {
      if (item.studentId === profileRef.current?.id) setResult(item);
    },
  };
}
