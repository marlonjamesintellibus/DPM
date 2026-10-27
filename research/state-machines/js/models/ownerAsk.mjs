// Spec: OwnerAsk (use case 1, machines doc M37, section 20, U5 and U7; 27 Oct 2026)
// Kemar says something about a record he may not change ("Jodian finished #160", "Release 1 slips
// to the 3rd"), or about work with no record. Saving does not change anything: it asks the person
// with the right (the record's owner, or the PM and Leads for new work), who accepts, declines or
// lets it lapse. An accept is checked again when it runs: the right then, and the record still as
// Kemar saw it. Someone else getting there first makes the ask moot.
//
// Kind 'change': one record whose value Kemar saw as 'a' and asks to make 'b'; Jodian owns it.
// Kind 'new_work': no record yet; Alicia (PM) accepts, which creates it.
import { clone } from '../lib.mjs';

const ENDED = ['applied', 'declined', 'moot', 'withdrawn', 'expired'];
const EXPIRY = 2;

export default function OwnerAsk({ Kind = 'change', Bug = null } = {}) {
  const asked = Kind === 'change' ? 'jodian' : 'alicia';
  const mayAccept = (s, p) => s.inProject[p] && (p === asked || (Bug === 'authorAccepts' && p === 'kemar'));
  // C4: the item is in front of the person asked while the ask is live and they are on the project
  const sync = (t) => {
    // Planted bug keepItem: a declined ask leaves its item open
    t.inbox = (t.st === 'asked' && t.inProject[asked]) || (Bug === 'keepItem' && t.st === 'declined') ? ['owner_ask'] : [];
    return t;
  };
  const end = (t, st) => {
    t.st = st;
    if (st === 'declined' || st === 'expired') t.told = true;
    return sync(t);
  };

  return {
    name: `OwnerAsk (${Kind}${Bug ? `, bug ${Bug}` : ''})`,
    init: () => [{ st: 'none', record: Kind === 'change' ? 'a' : null, age: 0, appliedBy: null, told: false, inProject: { kemar: true, jodian: true, alicia: true }, inbox: [] }],
    actions: [
      {
        // Kemar saves the update: the ask is made, nothing is written
        name: 'Ask',
        params: [[]],
        step(s) {
          if (s.st !== 'none' || (Kind === 'change' && s.record !== 'a')) return [];
          const t = clone(s);
          t.st = 'asked';
          return [sync(t)];
        },
      },
      {
        // Someone else changes the record meanwhile (Kind change only)
        name: 'OtherWrite',
        params: [['b'], ['c']],
        step(s, v) {
          if (Kind !== 'change' || s.record === v) return [];
          const t = clone(s);
          t.record = v;
          return [sync(t)];
        },
      },
      {
        // Accept as asked ('b'), or with their own value ('c'): CHANGE then ACCEPT
        name: 'Accept',
        params: ['jodian', 'alicia', 'kemar'].flatMap((p) => [[p, 'b'], [p, 'c']]),
        step(s, p, v) {
          if (s.st !== 'asked' || !mayAccept(s, p)) return [];
          // The record must still be as Kemar saw it; planted bug blindAccept skips the check
          if (Kind === 'change' && s.record !== 'a' && Bug !== 'blindAccept') return [];
          const t = clone(s);
          t.record = v;
          t.appliedBy = p;
          return [end(t, 'applied')];
        },
      },
      {
        name: 'Decline',
        params: [['jodian'], ['alicia']],
        step(s, p) {
          if (s.st !== 'asked' || !mayAccept(s, p)) return [];
          return [end(clone(s), 'declined')];
        },
      },
      {
        // The record reached the asked value another way: nothing to do (checked on read and nightly)
        name: 'Moot',
        fair: true,
        params: [[]],
        step(s) {
          if (s.st !== 'asked' || Kind !== 'change' || s.record !== 'b') return [];
          return [end(clone(s), 'moot')];
        },
      },
      {
        name: 'Withdraw',
        params: [[]],
        step(s) {
          if (s.st !== 'asked') return [];
          return [end(clone(s), 'withdrawn')];
        },
      },
      {
        // OA9: Kemar or the person asked left the project; nobody vouches for it, or nobody can accept it
        name: 'TargetGone',
        fair: true,
        params: [[]],
        step(s) {
          if (s.st !== 'asked' || (s.inProject.kemar && s.inProject[asked])) return [];
          return [end(clone(s), 'withdrawn')];
        },
      },
      {
        name: 'Leave',
        params: [['kemar'], [asked]],
        step(s, p) {
          if (!s.inProject[p]) return [];
          const t = clone(s);
          t.inProject[p] = false;
          return [sync(t)];
        },
      },
      {
        // A day passes; after EXPIRY days the ask expires and Kemar is told. Planted bug noExpiry: it never does
        name: 'Tick',
        fair: true,
        params: [[]],
        step(s) {
          if (s.st !== 'asked') return [];
          if (s.age < EXPIRY) {
            const t = clone(s);
            t.age += 1;
            return [t];
          }
          return Bug === 'noExpiry' ? [] : [end(clone(s), 'expired')];
        },
      },
    ],
    invariants: {
      TypeOK: (s) => ['none', 'asked', ...ENDED].includes(s.st) && s.age <= EXPIRY,
      // The person asked has the item exactly while the ask is live (C4)
      ItemMatchesCause: (s) => s.inbox.includes('owner_ask') === (s.st === 'asked' && s.inProject[asked]),
      // A declined or expired ask is told to Kemar
      EndIsTold: (s) => !['declined', 'expired'].includes(s.st) || s.told,
    },
    actionProperties: {
      // Nothing is written by Kemar's save: only the person asked, holding the right at that moment
      AppliedOnlyByTheAsked: (s, t) => s.st === 'applied' || t.st !== 'applied' || (t.appliedBy === asked && s.inProject[asked]),
      // An accept never overwrites a value Kemar did not see
      NeverOverwriteUnseen: (s, t) => Kind !== 'change' || s.st !== 'asked' || t.st !== 'applied' || s.record === 'a',
      // A moot ask writes nothing
      MootWritesNothing: (s, t) => s.st !== 'asked' || t.st !== 'moot' || t.record === s.record,
    },
    leadsTo: {
      // Every ask ends: accepted, declined, moot, withdrawn or expired
      AskEnds: [{ label: 'ask', P: (s) => s.st === 'asked', Q: (s) => s.st !== 'asked' }],
    },
  };
}
