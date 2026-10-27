// M2 as a job, with the decisions of 26 Oct on D1, D3 and D19 (use-cases/01-update-to-plan-machines.md,
// section 11). One capture, voice or text:
//   D1   a voice note that cannot be transcribed is retried, then fails and asks for a new voice note
//   D19  a read that never answers (the process stopped) is returned to retry by a timer
//   D3   a save that fails is retried with the same item IDs, then the author is told and may try again
// The read is three steps in the code (beginRead, the model call, proposeItems), so an answer can
// arrive after its attempt was given up; only the current attempt may store items.
import { clone } from '../lib.mjs';

const MAX = 3;

export default function CaptureJob({ Bug = null } = {}) {
  const set = (s, patch) => [Object.assign(clone(s), patch)];
  const fail = (s, step) => set(s, { st: 'failed', asked: step === 'transcribe' && Bug !== 'noResendAsk' ? 'new_voice_note' : 'try_again' });

  return {
    name: `CaptureJob${Bug ? ` (bug ${Bug})` : ''}`,
    init: () =>
      ['voice', 'text'].map((kind) => ({
        kind,
        st: 'received',
        tries: 0,
        // Read attempts still waiting for the model; a stopped process drops them
        inflight: [],
        stored: 0,
        storedFrom: 0,
        asked: null,
        // The database as written (saved) and the author's view of the save
        dbSaved: false,
        applied: 0,
        saveTries: 0,
        told: false,
      })),
    actions: [
      {
        name: 'Start',
        params: [[]],
        fair: true,
        step: (s) => (s.st !== 'received' ? [] : s.kind === 'voice' ? set(s, { st: 'transcribing', tries: 1 }) : set(s, { st: 'reading', tries: 1, inflight: [1] })),
      },
      { name: 'Transcribed', params: [[]], step: (s) => (s.st === 'transcribing' ? set(s, { st: 'reading', tries: 1, inflight: [1] }) : []) },
      { name: 'TranscribeFailed', params: [[]], step: (s) => (s.st === 'transcribing' ? set(s, { st: 'transcribe_wait' }) : []) },
      {
        name: 'RetryTranscribe',
        params: [[]],
        fair: true,
        step(s) {
          if (s.st !== 'transcribe_wait') return [];
          if (s.tries < MAX) return set(s, { st: 'transcribing', tries: s.tries + 1 });
          return fail(s, 'transcribe');
        },
      },
      {
        // The model answers for one attempt; only the attempt the capture is on may store items
        name: 'ReadAnswered',
        params: [[1], [2], [3]],
        fair: true,
        step(s, attempt) {
          if (!s.inflight.includes(attempt)) return [];
          const base = { inflight: s.inflight.filter((a) => a !== attempt) };
          const current = s.st === 'reading' && (attempt === s.tries || Bug === 'noAttemptCheck');
          if (!current) return set(s, base); // a late answer is dropped
          return ['proposed', 'nothing_to_update'].flatMap((st) => set(s, { ...base, st, stored: s.stored + 1, storedFrom: attempt }));
        },
      },
      {
        name: 'ReadFailed',
        params: [[1], [2], [3]],
        step: (s, attempt) => (s.st === 'reading' && attempt === s.tries && s.inflight.includes(attempt) ? set(s, { st: 'retry_wait', inflight: s.inflight.filter((a) => a !== attempt) }) : []),
      },
      // The process stops mid read: nothing will ever answer for the attempts in flight
      { name: 'Crash', params: [[]], step: (s) => (s.inflight.length ? set(s, { inflight: [] }) : []) },
      {
        // D19: a read or a transcription with no answer for 5 minutes goes back to retry. The model
        // check found the transcription half: without it a voice note waits in transcribing forever
        name: 'StaleTimer',
        params: [['reading'], ['transcribing']],
        fair: true,
        step(s, step) {
          if (s.st !== step) return [];
          if (Bug === 'noStaleTimer' || (Bug === 'noTranscribeTimer' && step === 'transcribing')) return [];
          return set(s, { st: step === 'reading' ? 'retry_wait' : 'transcribe_wait' });
        },
      },
      {
        name: 'RetryRead',
        params: [[]],
        fair: true,
        step(s) {
          if (s.st !== 'retry_wait') return [];
          if (s.tries < MAX) return set(s, { st: 'reading', tries: s.tries + 1, inflight: [...s.inflight, s.tries + 1].sort() });
          return fail(s, 'read');
        },
      },

      { name: 'OpenReview', params: [[]], step: (s) => (s.st === 'proposed' ? set(s, { st: 'reviewing' }) : []) },
      // The author presses Save, the first time or again after being told it failed
      { name: 'Save', params: [[]], step: (s) => (s.st === 'reviewing' && !s.dbSaved ? set(s, { st: 'saving', saveTries: 1, told: false }) : []) },
      {
        // One transaction: every confirmed item applies once per item ID, or nothing does
        name: 'SaveCommits',
        params: [['reply'], ['reply_lost']],
        fair: true,
        step(s, reply) {
          if (s.st !== 'saving' || s.dbSaved) return [];
          return set(s, { dbSaved: true, applied: s.applied + 1, st: reply === 'reply' ? 'saved' : 'saving' });
        },
      },
      // A database error: the transaction rolls back, nothing is written
      { name: 'SaveErrors', params: [[]], step: (s) => (s.st === 'saving' && !s.dbSaved ? set(s, { st: 'save_wait' }) : []) },
      {
        name: 'RetrySave',
        params: [[]],
        fair: true,
        step(s) {
          const lostReply = s.st === 'saving' && s.dbSaved;
          if (s.st !== 'save_wait' && !lostReply) return [];
          // The retry finds the capture already saved: the reply was lost, the save was not
          if (s.dbSaved) return Bug === 'retryReapplies' ? set(s, { st: 'saved', applied: s.applied + 1 }) : set(s, { st: 'saved' });
          if (s.saveTries < MAX) return set(s, { st: 'saving', saveTries: s.saveTries + 1 });
          return set(s, { st: 'reviewing', told: Bug !== 'silentGiveUp' });
        },
      },
    ],
    invariants: {
      TriesBounded: (s) => s.tries <= MAX && s.saveTries <= MAX,
      ItemsStoredOnce: (s) => s.stored <= 1,
      AppliedAtMostOnce: (s) => s.applied <= 1,
      SavedIsWritten: (s) => s.st !== 'saved' || s.dbSaved,
      // A failed capture always tells the author what to do next (E18, D1)
      FailureAsksTheAuthor: (s) => s.st !== 'failed' || s.asked !== null,
    },
    actionProperties: {
      // Items come only from the attempt the capture is on
      StoredFromCurrentAttempt: (s, t) => t.stored === s.stored || t.storedFrom === s.tries,
      // D3: when Save gives up, the author is told, and nothing was written
      GivingUpIsTold: (s, t) => !(['saving', 'save_wait'].includes(s.st) && t.st === 'reviewing') || (t.told && !t.dbSaved),
      // D1: a failed transcription asks for a new voice note, not just "try again"
      VoiceFailureAsksForNewNote: (s, t) => !(s.st === 'transcribe_wait' && t.st === 'failed') || t.asked === 'new_voice_note',
    },
    leadsTo: {
      // Nothing stays stuck: every capture reaches review, nothing to update, or failed
      ReadEnds: [{ label: 'capture', P: (s) => s.st === 'received', Q: (s) => ['proposed', 'nothing_to_update', 'failed'].includes(s.st) }],
      SaveEnds: [{ label: 'save', P: (s) => s.st === 'saving', Q: (s) => s.st === 'saved' || (s.st === 'reviewing' && s.told) }],
    },
  };
}

