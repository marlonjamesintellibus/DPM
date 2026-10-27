# Meeting notes: BRAID log, roles and streams

**Source:** `Silver Slipper Plaza 3.m4a`, 15 min 41 s, recorded on or before 26 Oct 2026. Transcribed locally with Whisper (large-v3-turbo); the timestamped transcript is at the end.
**Who:** a lead speaker (not named in the recording) briefing Marlon; Marlon asks one question at 10:51.
**Transcript caveats:** Whisper heard "Braid Log. Lockers" for BRAID log, Blockers; "Karl" or "car" for Carl; "Ram Chundee" is a guessed spelling. 02:04 to 03:02 is mostly an app demo with no usable words.

## Synopsis

The lead speaker set out how project management should work inside Atlas. The core idea: **the BRAID log is generated from conversations, not typed into Excel**, and the hardest part is the rule for **who can report and who decides** each kind of entry.

1. **Check-in and check-out** (0:07). People check in ("this is what I'm working on") and check out at the end of the day ("this is what I did").
2. **Meetings are the main input** (0:24). One person opens the relevant project in Atlas and taps record; the Atlas notetaker produces the transcript for that project. Several meetings in one project can record at the same time. Feedback for Malik and Carl: name the meeting from its first sentences, tag the location automatically, and show attendees, location and topic on the saved recording and transcript screens.
3. **BRAID log** (3:02). Blockers, Risks, Assumptions, Issues, Dependencies and Decisions. Atlas pulls entries out of each meeting as they are said. Two views: per meeting (next to the transcript and summary) and consolidated per project. Alerts go to the right people automatically.
4. **Consolidation and conflicts** (4:05). Different groups have sidebar conversations, so the same risks and issues come up several times, and decisions can conflict. "The purpose of Atlas is human coordination": consolidation must dedupe repeats and surface conflicting decisions. Status changes ("is the blocker eliminated?") also come from conversation.
5. **Who can report, who decides** (5:09), called "the most important piece of the algorithm":

   | Entry | Who can report | Who decides |
   |---|---|---|
   | Blocker | Anyone | Atlas dedupes ("seven people reported the same blocker") |
   | Risk | Anyone can raise it | Only the PM or project lead puts it on the risk log |
   | Issue | Anyone | Not stated |
   | Decision | Anyone can propose | 1 or 2 people approve. Pending until someone explicitly approves. Options: approve, decline, or request more information |
   | Assumption, Dependency | Not stated | Not stated |

6. **Project roles in Atlas** (6:19). Projects need assigned roles from a standard set (lead, engineering lead, PM and so on), so nobody reinvents them. Roles decide the rights in point 5.
7. **No silent "no"** (7:52). For meeting invites at Intellibus the default is "accept" or "propose a new time"; decline is hidden and takes extra effort, because a decline with no reason leaves the organiser stuck. Some limit is needed after about three proposed times.
8. **Actions and goals** (8:49). Track who has which action, and tie everything back to goals and to the quarter by quarter and week by week plans. These are generated in Atlas from conversations rather than written in PowerPoint or Word first. They can be exported to PowerPoint or Google Docs; edits come back by uploading the file again.
9. **Not a separate app** (9:58). Project management is a default feature of every Atlas **stream** (group). The new "experience" is a **consolidated view across streams**, a group of groups: "a view of this BRAID log across these three streams".
10. **Data access and privacy** (10:51). Marlon asked whether personal group chats would flow into an Intellibus system. Answer: no. Data reaches a dashboard only when the **group owner authorizes** it through the Atlas API, and **you see only what you are authorized to see**. The product is for everyone, not only Intellibus.
11. **Organisation boundary** (12:26). An Atlas account can connect several email addresses. A group is tagged to one or more of them (organisation emails), and that company's dashboard then shows the group's data. **Within the company, only the people in the group see it. Nobody else.** This makes the model user centric (people own their data) while companies still operate. Feedback for Malik and Carl: connect several emails, and tag a group to an email when creating it.
12. **Keep the dashboard simple** (14:32). The open question is which actions can be taken from it.
13. **Talk to Malik, Carl and Ram** (14:42). Ram (spelling unconfirmed) worked on **Max**, built by the US team for engineering collaboration. Max has MCP integrations to Datadog, Splunk, Jira and others, and agents can trigger actions from them. The lead speaker will send a demo.

## How much it changes what we have

Short answer: the rules engine, the state machine work and the standalone app hold. **What gets captured, who may confirm what, and how visibility works all change.** The biggest change is visibility: it now follows group membership, not org role.

### Changes direction

| # | What changes | Affects |
|---|---|---|
| D1 | **Visibility comes from group membership, not org role.** "Who in the company should see the data? The people in the group. Nobody else." The KB's executive lens ("whole org, worst first") assumes the executive sees everything. In this model an executive sees only streams they belong to or that are tagged and authorized. | KB A7 (roles and lenses), P10, B3 overall status, every role's Today |
| D2 | **Atlas is where people talk; DPM is the base it builds on.** BRAID is a default feature of every stream, and the cross-stream consolidated view is the new experience. **Decided after the meeting (Marlon, 26 Oct): the standalone app stays**, because Atlas needs a base for this: DPM holds the projects, BRAID entries, roles, rules and statuses, and Atlas streams feed it through the Atlas API with group owner authorization. What changes in the build plan is the integration, not the app. | build-plan section 2, B1, B8; F11 |
| D3 | **Product scope is everyone, not Intellibus only.** Answers F1: a product, with Intellibus as one org. Organisations come from emails tagged to groups. | KB F1, Part B framing, A5.1 Org |
| D4 | **The first use case may be the wrong one.** The conversation names BRAID synthesis from meetings as "the most important thing", and who reports and who decides as "the most important piece of the algorithm". Use case 1 (one person's voice note updates their own work) is still valid, but it covers neither. | use-cases/01, build-plan phases |

### Changes the model

| # | What changes | Affects |
|---|---|---|
| M1 | **RAID becomes BRAID (B-RAID-D).** Blocker and Decision become log entry kinds. We now need clear lines between a Blocker entry, an Issue entry and a work item's Blocked state (C6). | KB A5.3, C8, A4.1 categories |
| M2 | **Permission per entry kind** (the table in point 5). This is a new guard layer: report vs decide, per kind, per project role. Risks and Decisions are Asks (proposed to approved); Blockers and Issues go straight to the log. | KB A7, C8, C5; machines doc M9 and M10 pattern |
| M3 | **Project roles** from a standard set, assigned in Atlas. Today the KB has org-level role templates only. This fits the map's Membership shape. | KB A5.1, A7.1 |
| M4 | **Confirmation is per kind, not per speaker.** In use case 1 the speaker confirms their own updates (A9.2). A meeting has many speakers, and "if we say this is a blocker, it gets noted": Blockers and Issues are recorded without one person's OK, while Risks and Decisions wait for an approver. This loosens P5 and A9.2 for report-only kinds. **Needs a decision.** | KB P5, A9.2, C1; capture model invariant `NothingAppliedWithoutConfirm` |
| M5 | **Dedup becomes semantic.** We dedupe the same message arriving twice (C14.5). Now we must merge different words from different meetings and chats into one entry that keeps every source, and flag conflicting Decisions. This is a new machine (proposed entry, then matched or new, then merged), and nothing in our models checks it yet. | machines doc E1, E2; capture model; new Consolidation model |
| M6 | **Decision lifecycle:** proposed, pending (forever until explicit approval), approved, declined, or more information requested. The KB has Decision only as an inbox item (A5.6). | KB A5.6, C4, C5 |
| M7 | **Captures are multi-speaker and concurrent.** A meeting capture has attendees, location, an auto title, a project, and possibly sibling recordings of the same project at the same time. | KB C1, A5.6 Capture; machines doc M1, M2 |

### Adds

| # | What is new | Affects |
|---|---|---|
| A1 | Check-out at the end of the day, beside check-in | KB C2 |
| A2 | Goals, quarterly and weekly plans generated from conversations; export to PowerPoint or Google Docs, round trip by re-upload (a new capture source: uploaded documents) | KB A5.3 Plan, A5.5 Goal |
| A3 | Alerts to the right people when a BRAID entry appears or changes | KB A8.2 inbox rules |
| A4 | Pattern: no "no" without a path forward (propose a new time; decisions need request-more-info, not just decline). Same spirit as P9 "a disagreement needs a reason" | KB A2 principles |
| A5 | Max (US team) has MCP integrations to Jira, Datadog and Splunk. Possibly the route for GitHub and Jira signals instead of building our own | KB F6, A10.3 signals |
| A6 | Feedback items for the Atlas team: meeting auto title, location, attendees on the transcript, multiple emails per account, tag a group to an email | Not DPM build work; dependencies |

### Still holds

- The core loop (A3): capture, extract with source words, confirm (for approval kinds), record, evaluate, present, act.
- Statuses from rules only, worst first, roll-up, set vs calculated with a reason. The TrackedStatus result from today (`when_done` plus `reason_stale`) still stands.
- Provenance on every entry (A11). Now even more important, since one BRAID entry can have seven sources.
- The state machine method: transition tables, model checks, planted bugs, edge cases.
- Inbox, Dashboard, Table and Chat as views of the same records. "Keep the dashboard simple" matches L4.

## Questions to take back

1. For report-only kinds (Blocker, Issue), is anything confirmed by a person before it shows on the project BRAID? Or is it shown as "reported" with its sources, and only resolved by a person? (M4)
2. Who decides for Issues, Assumptions and Dependencies? (point 5 gaps)
3. When two meetings produce conflicting Decisions, who is asked, and what does each meeting's BRAID show meanwhile? (M5)
4. Is the executive's "whole company" Today still a goal, given that visibility comes from group membership? (D1)
5. The standalone app stays as the base (D2). Which way does data flow: does DPM pull streams through the Atlas API, does Atlas push captures and extractions to DPM, or both? Who owns that contract: Malik, Carl? And does the BRAID panel inside an Atlas stream read from DPM?
6. Does a Blocker entry replace the work item's Blocked state, or link to it? (M1)
7. Is an assigned action a BRAID entry, a work item (C6), or both?
8. How does Max relate to Atlas: share integrations, merge, or stay separate? (A5)

---

## Transcript (timestamped, unedited Whisper output)

```
[00:00] Okay, all right, good. So, what did we ask Marlon to come here for? So, I just wanted to explain.
[00:07] We wanted a way for us to manage the projects more effectively, yeah? And we discussed the other day about the daily check-in and check-out experience, yes? Marlon?
[00:18] Yeah.
[00:18] People come in, they check in, hey, this is what I'm working on, and then they have to check out in the end, right?
[00:22] Yeah.
[00:22] Hey, this is what I did today, yeah?
[00:24] Now, ideally, if you use the Atlas in every meeting and you take the Atlas notetaker in every meeting, and instead of the today's notetaker tools, which is like, oh, let me go join the meeting, you just bring it up.
[00:40] You go to the relevant project that you're in, right?
[00:44] And you just tap there.
[00:45] So, not everybody needs to do it.
[00:47] One person does it, and the transcribe for that recording is there.
[00:51] now at the same time in that project four meetings may be happening these two guys are talking three
[00:56] three are talking so two three recordings will come at the same time what is missing now which
[01:00] is more of feedback for malik and car is intelligently a topic of the meeting should
[01:05] be put based on the first few sentences which are said because when people are starting there'll be
[01:09] some like oh this is what we're doing so then intelligently you can do that and the location
[01:14] should be tagged to the meeting automatically right now when i see the recording when it is
[01:19] saved when I go here I can see the previous recording but it doesn't show
[01:22] the name of the meeting you know some details who was there in the meeting like
[01:27] at least some information even if it's not directly visible here maybe I have
[01:31] to like you know swipe or tap or do something to see it immediately yeah so
[01:35] it should show me hey who are all the people in the meeting what was discussed
[01:40] and then of course there is a and I told them that in the audio like here in the
[01:44] transcript where you go and see right like here it says summary actions for
[01:47] audio that said here maybe here on this screen you can show right who are the
[01:51] attendees what is the location so maybe here on the transcript screen attendees
[01:54] and locations need to be put so that is just from the basic Atlas perspective
[01:59] yeah okay all right now
[02:04] Now, so that was just forward.
[02:11] Actually, no.
[02:14] Show more.
[02:15] Show less.
[02:16] Show more.
[02:18] Transcript.
[02:21] Summarize.
[02:34] I will .
[02:51] Oh, okay.
[02:53] So we have to just make that decision.
[02:56] Good boy.
[02:57] I think we can .
[03:02] Yeah, okay. All right. I think we got that. I was just sending it to the commerce group. Okay. Now we're going to talk about the project management aspect. So what we want to be able to do, we have this thing called the Braid Log. Lockers, risks, assumptions, issues, dependencies and decisions.
[03:28] Yeah. So that braid log should be auto-generated on the screen.
[03:33] The alert should be automatically sent to the right people.
[03:36] How will all that happen? Because as we are having a discussion, some action item is discussed, it gets pulled in.
[03:41] The decision is taken, it gets pulled in.
[03:43] So at the end of the meeting, the braid for that meeting, like I was saying earlier,
[03:50] that you can see the transcripts and the summary of the actions, but you can also see the full braid.
[03:58] dependency or position, right?
[04:00] And then that braid is then taken from that meeting.
[04:05] Because this could be, like three people could be discussing in four different conversations
[04:09] and maybe coming up with the same risks and same issues and maybe different decisions,
[04:14] conflicting decisions, right?
[04:16] Let's say you two guys decide to do one thing.
[04:18] These two guys decide to do something because you're having sidebar conversations.
[04:22] This is where the purpose of Atlas is human coordination.
[04:24] So get the coordination right.
[04:25] So when you do the braid generation, at the end of every meeting, you can then consolidate
[04:39] the braid across all the people in a given project.
[04:42] So when I go into the project here and I see, hey, in this project, what is the, like I
[04:49] can have a thing which says braid and then I can see, oh, blockers, etc, etc.
[04:53] the particular meeting I can go into the transcript view and see what are the blockers risks etc.
[04:59] So I will have two views one I will have at the transcript by transcript or meeting by meeting
[05:04] level what was discussed and then I'll have a consolidated across the project. The challenge
[05:09] becomes who decides. So what we had discussed last time and this is the most important piece
[05:15] of the algorithm to be written. Who can report and who decides, right? Who can write down
[05:24] a blocker? Anyone. So blockers are just a sum total deduplicated. Because seven people
[05:30] reported the same blocker, you dedupe. So how are you going from transcript by transcript
[05:34] to the consolidated view? And then even the status update of is the blocker eliminated?
[05:39] Right? No one should write down. Today we go, we create a bread log, we manually put
[05:43] it in Excel and we manage it. No reason whatsoever to do that. So what are we going to do? We're
[05:50] going to talk to Atlas. If we say this is a blocker, it gets noted. Three other people
[05:54] in their chats are saying the same thing. No problem, deduplicated. When you go to the project,
[05:58] I can see one braid, right? What are my blockers? Then I can see what are my risks. Then I can see
[06:04] what are my issues. Blocker can be reported by anyone. Atlas's job, deduplicate. So the risks
[06:10] can be reported by anyone but must be approved by a PM or a person. So at the project level
[06:19] right now we haven't assigned roles. So one of the things we need to be able to do in
[06:23] Atlas itself is assigned roles. So then you can go within Atlas and say, oh, this is the
[06:28] lead, this is the engineering leader, this is the PM, this is whatever. What those words
[06:33] mean as such they are just English but we can have some standard set of roles so everybody
[06:37] doesn't have to reinvent. And then those roles determine what happens, what rights you have.
[06:45] So if a risk has to be put on a risk law, only the person who's called the project manager
[06:51] or the project lead can put it. Not anyone can put it. Maybe have some guardrail like
[06:55] that. Issues anyone can report. Decisions, again, may be limited to one or two people.
[07:03] can be proposed by anyone so it will show there pending decision pending decision someone has to
[07:09] approve approve approve right yeah otherwise it will show you just pending decisions decision
[07:13] will be always in a pending state unless approved so this way someone takes explicit responsibility
[07:18] of making a decision yeah today in the world people have a discussion they send an email
[07:22] until someone explicitly says approved it's not a decision that has been taken so this simplifies
[07:28] decision today I get lots of messages also hey can you approve this can you prove this time sheet
[07:32] can you do this no then it just becomes an explicit approval yeah now what can you do to a decision you
[07:39] can either approve or you can of course decline right but I think it should be approved or there
[07:46] should be a request more information or something like that one of the things I wanted to do when
[07:52] it came to meeting scheduling this is I already discussed Malik people have accept and decline
[07:59] right they also have proposed new time right what I wanted to do switch the
[08:03] default you can in IntelliBus if someone is proposing a meeting you can either
[08:07] accept or propose new time you don't decline because what happens in decline
[08:13] is sometimes people will not put their reason then because frustrating for the
[08:17] person I'm asking a meeting it is declining it what do I do right yeah so
[08:23] accept or propose new time now maybe three times you know new times have been
[08:27] proposed then it's too much right then we have to figure out what to do. So maybe
[08:35] decline can still be an option that's just hidden or whatever right so people
[08:38] have to make extra effort to decline. So that is the and so the braid log is the
[08:44] most important thing to be able to synthesize and bring it up so at any
[08:47] point we know what the blockers are what's going on what's the progress.
[08:49] Similarly actions what are being assigned who has the action and then
[08:53] tying it all back to goals. So whenever a project is being discussed, goals have been decided,
[08:58] quarter by quarter plan has been decided, week by week plan has been decided. So it's all there
[09:03] already, except instead of it being in PowerPoints and all and being generated in a PowerPoint or a
[09:08] Word document in the first place, it is generated in Atlas based on conversations. Then it can be
[09:15] presented in a PowerPoint, generated a PowerPoint out of it or a Google Doc or whatever and you can
[09:19] see it, you can edit it there, then you have to upload that back here if you want all those edits
[09:23] to come here.
[09:25] Yeah?
[09:26] Yeah.
[09:27] And then that's essentially it.
[09:30] And that's sort of basically,
[09:31] and then of course,
[09:32] collaboration,
[09:32] we don't need to talk,
[09:33] it's already built in.
[09:35] I think there's one feature
[09:37] we're going to need in Atlas
[09:38] for this to be possible.
[09:39] Currently,
[09:40] how this would be done
[09:41] is for an Atlas experience
[09:42] in which, you know,
[09:44] someone goes on like
[09:45] Bookman bot and says,
[09:46] hey, this is what I've done today.
[09:47] But for a conversation,
[09:49] a bot,
[09:50] in Telegram,
[09:51] they call them bots,
[09:51] Atlas would have to be able to go in there and get the transcript and say hey I'm submitting this to
[09:58] so the way the way I see it working is this is a thing like when you have a stream this is a thing
[10:08] that is there by default in the stream every stream has it yeah so we don't need a separate
[10:14] experience called project management.
[10:16] So you just…
[10:17] It doesn't matter what group it is.
[10:21] The thing that will be the experience that I am talking about is a consolidated view
[10:26] across streams.
[10:28] So when you create an experience you can say hey I need a view of this braid log of this
[10:34] projects etc across these three streams.
[10:36] So then you will go and create an experience which is like a group of groups and then you
[10:42] will see the consolidated view over there.
[10:45] The reason that I was saying that we might need to be able to add it.
[10:49] Add what?
[10:50] Maybe I'm not following your point.
[10:51] So, because streams aren't going to always just be Intellibus-based streams, they'll
[10:56] also have eventually people using Atlas on a day-to-day basis, and we don't want to be
[11:01] collecting data from their groups, so I don't think it should be...
[11:03] No, what do you mean by collecting data from their groups?
[11:05] Nobody's collecting data from...
[11:05] Well, not collecting data, but like, when, let's say, I mean, I made a group chat with
[11:10] the energy because we're just talking having our conversations that technically shouldn't be sent to
[11:15] our system so okay okay i think i understand where your where your question is coming from
[11:23] you're thinking that whatever is being discussed in the group is automatically magically going
[11:27] into some intellibus dashboard no it is not it is a feature available on all groups that's default
[11:37] Now, how does that data from here get into the dashboard that you're making is a question of someone authorizing.
[11:44] Someone has to go there and who gets to authorize it? The group owner. That's it.
[11:51] So if I'm a group owner in Atlas, I go there, I have connected to the Atlas API, it shows me my groups.
[11:57] I say show me, show me, show me. That's it. If you're not authorized to view the group, you don't see the data.
[12:02] that's how it works.
[12:04] So when I log into there,
[12:05] it's not like an
[12:06] Intellibus thing,
[12:06] oh, all the Intellibus
[12:07] information is there.
[12:08] As a user,
[12:09] I'm seeing whatever data
[12:10] from my group says,
[12:11] that is the web address.
[12:14] So this is a system
[12:15] then that would be
[12:16] available to everyone?
[12:17] Of course,
[12:18] absolutely,
[12:18] right?
[12:19] Everybody.
[12:20] What do you see?
[12:21] You see what you're
[12:21] authorized to.
[12:22] End of story.
[12:23] We have built this idea
[12:24] of organization
[12:25] and all that.
[12:26] If organization wants
[12:28] to put an organization
[12:29] boundary,
[12:30] okay,
[12:30] make sure that
[12:31] the owner of the group is a person from the organization and it is linked to the organizational
[12:38] email. So now if my Atlas account is linked to my organizational email, I would have to,
[12:43] when I'm creating a group, pick which email it is typed to. Right now that is not an option.
[12:48] So that's another feedback for Malik or Karl to say, hey, when I create a group, I should
[12:53] be able to, A, first I should be able to connect my different email accounts. In Atlas, once
[12:58] Once I have connected my different email accounts, when I have a group I can tag it to a particular
[13:01] email.
[13:02] And when I tag it to the email, that company's dashboard, it starts to show on them.
[13:08] So you can take a group and tag it to two emails.
[13:13] Then both companies' dashboards will start to see that data.
[13:16] Who in the company should see the data?
[13:18] The people in the group.
[13:20] Nobody else.
[13:21] Right?
[13:22] That's it.
[13:24] This is what converges the traditional way of thinking everything is an org and makes
[13:32] it citizen or user centric and allows people to own their data while the corporation can
[13:37] still continue to operate.
[13:39] Alright.
[13:40] Yes?
[13:41] Yeah.
[13:42] You got it?
[13:43] Yeah, I get it.
[13:45] So basically all it is is that who, how do you get to have organizational control?
[13:51] If I run the organization, I create the group, I say everybody join this.
[13:55] Now, not to say that, and imagine if this was teams, just because you want to put an organization boundary, it doesn't make any sense, right?
[14:02] Because if you guys, four guys, want to still have a conversation outside your teams, you'll do it in WhatsApp anyway.
[14:07] Yeah.
[14:07] So what's the point?
[14:09] Right?
[14:09] Then, in fact, there is no visibility even.
[14:11] Right?
[14:12] So you'd rather go, this is why we create all our groups in WhatsApp.
[14:16] It's like, why bother?
[14:17] Because people will do it anyway.
[14:18] You just make it convenient for them to have a conversation here, so there's no outside of the organization conversation happening.
[14:23] Yeah.
[14:23] Do you follow me?
[14:24] Yeah.
[14:26] Okay.
[14:27] Yeah.
[14:29] So that's the core idea, right?
[14:32] And action items and comments and everything.
[14:34] And finally, like in the dashboard, make it simple, right?
[14:37] And then the only question becomes, what actions can you perform from there, right?
[14:41] Yeah.
[14:41] Can you pretty much get the...
[14:42] And if you're doing this, I would highly encourage you to talk to both Malik and Karl and also
[14:48] Ram.
[14:49] Ram Chundee, who has been working on, like we have built Atlas, we also built something
[14:56] called Max that was done by the US team.
[14:59] So Atlas was built in Jamaica, Max was built in America.
[15:03] Now I have asked him, and I can actually get you to see a demo of Max, what he has built.
[15:07] It was built for a very different purpose.
[15:09] it was more for engineering collaboration.
[15:13] Kind of similar to this, but it has integrations
[15:16] to where MCP servers, to Datadog, Splunk, Gira, everything.
[15:20] So in the enterprise context, it can go and have all
[15:23] the conversations with all those endpoints.
[15:25] And you can ask a question from Datadog,
[15:26] oh, what's happening?
[15:27] Oh, based on that, you can trigger a action
[15:30] so the agents can coordinate.
[15:31] So I'll actually send you guys the demo to watch it.
[15:35] All right.
[15:37] Okay.
[15:38] I think that's...
[15:39] Yep, that's pretty much it.
```
