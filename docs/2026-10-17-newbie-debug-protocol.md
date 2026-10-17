# Newbie Open Debug Protocol

> Historical record: the debug page, its dedicated endpoints, services, schema,
> synthetic fixture JSON, and page-only tests were removed on 2026-10-17 after
> checking repository references. Implementation and verification sections below
> describe the former implementation, not currently available functionality.
> Protocol evidence is retained here for reference; ordinary activity and
> monthly-card services are unchanged.

## Source and Evidence

- Inspected on 2026-10-17, Asia/Shanghai.
- Official WeChat app: `wx5306c5978fdb76e4`, latest locally cached version `75`.
- Main package mtime: 2026-10-17 09:25:48 +08:00.
- Original package folder:
  `~/Library/Containers/com.tencent.xinWeChat/Data/Documents/app_data/radium/users/*/applet/packages/wx5306c5978fdb76e4/75/`.
- Read-only source copied to `/tmp/qq-farm-hire-inspect.GAlrqY`; decrypted
  packages, extracted files, and inspection scripts remain there.
- Unpacked `tsdk/tsdk.wasm`: 161133 bytes; extraction did not preserve the
  original entry mtime. Do not interpret extraction time as build time.
- Bundle: `subpackages/main/game.js`; protocol modules:
  `chunks:///_virtual/activitypb.ts`, `mallpb.ts`, and `corepb.ts`.
- The current complete QQ source was also located using the repository skill:
  `1112386029_3_3443f89042dffbf93d20ced1d652d031`,
  `tsdk/tsdk.wasm` modified 2026-10-16 03:14:56.796 UTC, 161054 bytes.
  The recovered protocol below is from WeChat, not this QQ bundle.
- Only loader/string-table setup and required generated protocol modules were
  executed in isolation. The game and business controllers were not started.

Enum names and message relationships: `official-generated-code`.
Field tags: `official-encoder-probe`.
Synthetic full messages: `official-encoder-reconstruction`.
The checked-in vectors are synthetic, not packet captures or account responses.

## Commands

| cmd | Official symbol | Action request | Action reply |
| --- | --- | --- | --- |
| 77 | NEWBIE_OPEN_SIGNIN_CLAIM | NewbieOpenSigninClaimReq | NewbieOpenSigninClaimRsp |
| 78 | NEWBIE_OPEN_MONTH_CARD_GRANT | NewbieOpenMonthCardGrantReq | NewbieOpenMonthCardGrantRsp |

Both action request messages are empty. Activity selection is the outer `id`.
There is no supported day, count, month-card ID, duration, or payment parameter
in these two request bodies.

## Confirmed Tags

All rows below are `official-encoder-probe`; the fixture JSON preserves the
semantic sentinel objects and encoded hex for nested state/list fields too.

| Message | Property | Field | Wire | Sentinel | Hex |
| --- | --- | --- | --- | --- | --- |
| OperateRequest | newbie_open_signin_claim | 175 | 2 | {} | fa0a00 |
| OperateRequest | newbie_open_month_card_grant | 176 | 2 | {} | 820b00 |
| OperateReply | newbie_open_signin_claim | 177 | 2 | {} | 8a0b00 |
| OperateReply | newbie_open_month_card_grant | 178 | 2 | {} | 920b00 |
| NewbieOpenSigninClaimRsp | claimed_days | 1 | 2, packed int32 | [7,19] | 0a020713 |
| NewbieOpenSigninClaimRsp | awards | 2 | 2 | Item(1001,19) | See fixture |
| NewbieOpenMonthCardGrantRsp | month_card_id | 1 | 0, int64 | 7 / 19 | 0807 / 0813 |
| NewbieOpenMonthCardGrantRsp | month_card_days | 2 | 0, int32 | 7 / 19 | 1007 / 1013 |
| ActivityData | newbie_open | 123 | 2 | view_type=7 / 19 | da07020807 / da07020813 |
| ActivityBodyNewbieOpen | view_type | 1 | 0 | 7 | 0807 |
| ActivityBodyNewbieOpen | participate_end_at | 2 | 0 | 7 | 1007 |
| ActivityBodyNewbieOpen | privilege_expire_at | 3 | 0 | 7 | 1807 |
| ActivityBodyNewbieOpen | signin_days | 4 | 2 | day=7 | 22020807 |
| MonthCardInfo | id | 1 | 0, int64 | 7 | 0807 |
| MonthCardInfo | remaining_days | 4 | 0, int64 | 7 | 2007 |
| MonthCardInfo | is_active | 7 | 0, bool | true | 3801 |

Official generated code also confirms ActivityType NEWBIE_OPEN=25,
ActivityStatus START=1, and sign-in CLAIMABLE=2.

## Synthetic Requests

`official-encoder-reconstruction` using a deliberately large synthetic activity
ID to verify int64 precision. This ID is not a discovered live activity ID.

```json
{"id":"9007199254740993","cmd":77,"newbie_open_signin_claim":{}}
```

- Outer field 1: `088180808080808010`.
- Outer field 2, cmd 77: `104d`.
- Empty request message, field 175: `fa0a00`.
- Complete: `088180808080808010104dfa0a00`.

```json
{"id":"9007199254740993","cmd":78,"newbie_open_month_card_grant":{}}
```

- Outer field 1: `088180808080808010`.
- Outer field 2, cmd 78: `104e`.
- Empty request message, field 176: `820b00`.
- Complete: `088180808080808010104e820b00`.

## Client Call Cross-Checks

- `NewbieSignInControl.requestSigninClaim(day)` checks the clicked day locally,
  then sends `{}` with cmd 77 and the Newbie activity ID. The day is NOT sent.
  Actual claimed days must be observed in `claimed_days`; do not assume exactly
  one day or an arbitrary user-selected day is claimed.
- `NewbiePrivilegeControl.requestMonthCardGrant()` sends `{}` with cmd 78,
  unless the current card is active with remaining days.
- A successful cmd 78 callback requests `MallService.GetMonthCardInfos`.
- `NewbieControl` checks the server activity validity and participant deadline.
- Existing local monthly-card parsing differs from the current WeChat schema.
  Debug uses an isolated read-only projection; ordinary monthly-card code is
  deliberately unchanged.
- No new HAR/WS, GetGroup/List capture, or live account action was performed.

## Implementation Boundaries

- Debug menu is visible again; previous farm-visit debugging remains.
- `/api/debug/newbie-open` accepts only `inspect` or an explicitly confirmed
  `operate` for cmd 77/78, authorized against the selected account.
- The user supplies an int64-positive activity ID manually. A server List result
  can suggest IDs but is not required before sending.
- Per the user's explicit debugging request, activity-list membership, activity
  time/status, sign-in eligibility, and existing month-card status do not block
  this dedicated debug operation. Eligibility is decided by the server.
- A confirmed action sends Operate first, without a prerequisite state read.
  The account authorization, cmd 77/78 whitelist, empty action body, explicit
  confirmation, positive-int64 ID validation, and concurrency guard remain.
- Activity time notes in optional snapshots are informational only. The ordinary
  activity services, paid-resource protection, and automation gates are unchanged.
- At most one Operate is sent per confirmed action. Rejection, timeout, or an
  unexpected response is not retried. A separate read refresh follows a sent
  write, since even a timed-out request might have reached the server.
- Operation success and post-action refresh success are independent. A refresh
  failure preserves the previous Operate result and manually entered ID.
- Direct operations have `before: null`; no fresh pre-operation snapshot is
  claimed when none was read.
- No automatic switch, background polling, paid purchase, or fund unlock was
  added.
- Diagnostic JSON is a sanitized projection of the confirmed protocol fields,
  not a full raw packet dump. Unrelated List data and credentials are omitted.

## Verification

- `core/test/newbie-open-debug.test.js`: fixed official request/reply/list/card
  vectors, whitelist, empty request bodies, direct sends despite unavailable
  activity or eligibility state, no retries, refresh failures, concurrency,
  ownership, and provider forwarding.
- `web/test/newbie-open-debug.test.mjs`: no automatic requests, confirmation,
  exact ID/cmd/account binding, manual int64 IDs without prior inspection,
  connection checks, concurrent click prevention, account switches, unmounts,
  partial failure, and bounded history.
- Full core suite: 750/750 passed.
- Full web suite after the direct-send update: 180/180 passed.
- `npm --prefix web run build`: vue-tsc and Vite production build passed.
- `git diff --check`: passed.
- Real-account validation: not performed; the user will test manually.
- Visual layout and real-account interaction remain for manual acceptance.
- Existing backend/account processes were not restarted.

Fixture provenance and all probes:
`core/src/activity-data/newbie-open-protocol-vectors.json`.
Temporary reproducibility scripts: `inspect.cjs --newbie` and
`newbie-vectors.cjs` in the retained work directory.
